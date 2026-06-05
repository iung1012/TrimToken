import { Request, Response } from "express";
import axios from "axios";
import { v4 as uuid } from "uuid";
import { Config, AnthropicRequest, Usage, RequestStats } from "./types";
import { computeCost, priceFor, normalizeUsage } from "./pricing";
import { selectModel } from "./router";
import { injectPromptCache } from "./promptCache";
import { hashRequest, getCached, setCached, CachedResponse } from "./cache";
import { compressInput } from "./inputCompress";
import { compressCode } from "./codeCompress";
import { injectOutputCompression } from "./outputCompress";
import { logRequest } from "./analytics";
import { getUpstreamAgent, shouldUseUpstreamAgent } from "./upstreamAgent";

const M = 1_000_000;

// Headers que NÃO devem ser repassados (hop-by-hop + os que o axios recalcula).
const SKIP_HEADERS = new Set([
  "host", "content-length", "connection", "accept-encoding",
  "transfer-encoding", "keep-alive", "proxy-authenticate",
  "proxy-authorization", "te", "trailer", "upgrade",
]);

/**
 * Repassa TODOS os headers do cliente (fiel), exceto hop-by-hop. Isso conserta
 * o bug antigo que dropava anthropic-beta extra e quebrava features.
 */
function forwardHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(headers)) {
    if (val == null) continue;
    if (SKIP_HEADERS.has(key.toLowerCase())) continue;
    out[key] = Array.isArray(val) ? val.join(", ") : String(val);
  }
  return out;
}

function copyResponseHeaders(src: Record<string, unknown>, res: Response): void {
  for (const [key, val] of Object.entries(src)) {
    if (SKIP_HEADERS.has(key.toLowerCase())) continue;
    if (key.toLowerCase() === "content-length") continue;
    if (val != null) res.setHeader(key, val as string | string[]);
  }
}

async function buildAxiosConfig(config: Config): Promise<{ httpsAgent?: import("https").Agent }> {
  if (!shouldUseUpstreamAgent(config)) return {};
  const agent = await getUpstreamAgent(config.https_mode.hostname);
  return { httpsAgent: agent };
}

function sendError(res: Response, err: unknown): void {
  const e = err as { response?: { status: number; data: unknown }; message?: string };
  const status = e.response?.status ?? 502;
  if (!res.headersSent) {
    res.status(status).json(e.response?.data ?? { error: { type: "proxy_error", message: e.message ?? "proxy error" } });
  } else if (!res.writableEnded) {
    res.end();
  }
}

export function createProxyHandler(config: Config) {
  return async (req: Request, res: Response): Promise<void> => {
    // Só POST /v1/messages passa pelo pipeline. Todo o resto (count_tokens,
    // models, etc.) é repassado fielmente, sem nenhuma modificação.
    if (req.method !== "POST" || req.path !== "/v1/messages") {
      await passthrough(req, res, config);
      return;
    }
    await handleMessages(req, res, config);
  };
}

/** Passthrough 100% fiel, via stream, com tratamento de erro e abort. */
async function passthrough(req: Request, res: Response, config: Config): Promise<void> {
  const method = req.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  try {
    const extra = await buildAxiosConfig(config);
    const resp = await axios({
      method,
      url: `${config.anthropic_api_url}${req.originalUrl}`,
      data: hasBody ? req.body : undefined,
      headers: forwardHeaders(req.headers as Record<string, string>),
      responseType: "stream",
      validateStatus: () => true,
      maxRedirects: 0,
      ...extra,
    });
    res.status(resp.status);
    copyResponseHeaders(resp.headers as Record<string, unknown>, res);
    const stream = resp.data as NodeJS.ReadableStream & { destroy?: () => void; destroyed?: boolean };
    stream.on("error", () => { if (!res.writableEnded) res.end(); });
    res.on("close", () => { if (stream.destroy && !stream.destroyed) stream.destroy(); });
    stream.pipe(res);
  } catch (err) {
    sendError(res, err);
  }
}

async function handleMessages(req: Request, res: Response, config: Config): Promise<void> {
  const start = Date.now();
  const original = req.body as AnthropicRequest;
  if (!original || !Array.isArray(original.messages)) {
    await passthrough(req, res, config);
    return;
  }
  const originalModel = original.model;
  const headers = forwardHeaders(req.headers as Record<string, string>);

  // ── Pipeline de redução de tokens ──────────────────────────────
  // 1. Input compression (whitespace/dedup/trunca logs) — preserva última msg
  const { request: c1 } = compressInput(original, config);
  // 2. Code compression (colapsa corpos de função no histórico)
  const { request: c2 } = compressCode(c1, config);
  // 3. Roteamento seguro (só troca modelo quando não quebra a sessão)
  const routedModel = selectModel(c2, config);
  const routed: AnthropicRequest = routedModel === c2.model ? c2 : { ...c2, model: routedModel };
  // 4. Output compression (instrução de concisão no system)
  const withOut = injectOutputCompression(routed, config);
  // 5. Prompt cache seguro (só injeta se o cliente não usa cache_control)
  const finalBody = injectPromptCache(withOut, config);

  // 6. Response cache — resposta idêntica servida do cache (lossless)
  const key = hashRequest(finalBody);
  if (config.response_cache.enabled) {
    const hit = await getCached(key);
    if (hit) {
      serveFromCache(res, hit, start);
      return;
    }
  }

  try {
    if (finalBody.stream) {
      await handleStreaming(res, original, finalBody, headers, originalModel, key, start, config);
    } else {
      await handleNormal(res, original, finalBody, headers, originalModel, key, start, config);
    }
  } catch (err) {
    sendError(res, err);
  }
}

function serveFromCache(res: Response, hit: CachedResponse, start: number): void {
  const s = hit.stat;
  logRequest({
    id: uuid(),
    timestamp: Date.now(),
    model: s.model,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    original_input_tokens: s.original_input_tokens,
    measured: s.measured,
    real_cost_usd: 0,
    baseline_cost_usd: s.baseline_cost_usd,
    compression_savings_usd: s.compression_savings_usd,
    cache_savings_usd: s.cache_savings_usd,
    total_savings_usd: s.baseline_cost_usd, // vs. não otimizar nada
    response_cache_hit: true,
    response_cache_savings_usd: s.real_cost_usd, // o que deixou de pagar agora
    latency_ms: Date.now() - start,
  });

  if (hit.kind === "stream") {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.status(200).send(hit.payload);
  } else {
    res.status(200).json(JSON.parse(hit.payload));
  }
}

async function handleNormal(
  res: Response, original: AnthropicRequest, finalBody: AnthropicRequest,
  headers: Record<string, string>, originalModel: string, key: string,
  start: number, config: Config,
): Promise<void> {
  const extra = await buildAxiosConfig(config);
  const resp = await axios.post(`${config.anthropic_api_url}/v1/messages`, finalBody, {
    headers,
    validateStatus: () => true,
    ...extra,
  });

  if (resp.status >= 400) {
    res.status(resp.status).json(resp.data); // erro: repassa, não cacheia, não loga sucesso
    return;
  }

  const data = resp.data;
  res.status(resp.status).json(data); // serve o cliente IMEDIATAMENTE

  // Medição + log + cache acontecem DEPOIS de responder (sem latência pro user)
  const usage = normalizeUsage(data.usage);
  const model = (data.model as string) || finalBody.model;
  await finalizeStats({ original, usage, model, originalModel, headers, key, start, config, payload: JSON.stringify(data), kind: "json" });
}

async function handleStreaming(
  res: Response, original: AnthropicRequest, finalBody: AnthropicRequest,
  headers: Record<string, string>, originalModel: string, key: string,
  start: number, config: Config,
): Promise<void> {
  const extra = await buildAxiosConfig(config);
  const resp = await axios.post(`${config.anthropic_api_url}/v1/messages`, finalBody, {
    headers: { ...headers, accept: "text/event-stream" },
    responseType: "stream",
    validateStatus: () => true,
    ...extra,
  });

  const stream = resp.data as NodeJS.ReadableStream & { destroy?: () => void; destroyed?: boolean };

  if (resp.status >= 400) {
    const body = await readStream(stream);
    try { res.status(resp.status).json(JSON.parse(body)); }
    catch { res.status(resp.status).send(body); }
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.status(resp.status);

  const usage: Usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  let model = finalBody.model;
  let sseBuffer = "";
  const chunks: string[] = [];
  let aborted = false;

  res.on("close", () => {
    aborted = true;
    if (stream.destroy && !stream.destroyed) stream.destroy();
  });

  stream.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    res.write(text);
    chunks.push(text);

    sseBuffer += text;
    const lines = sseBuffer.split("\n");
    sseBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const ev = JSON.parse(payload);
        if (ev.type === "message_start" && ev.message) {
          if (ev.message.model) model = ev.message.model;
          mergeUsage(usage, ev.message.usage);
        } else if (ev.type === "message_delta" && ev.usage) {
          mergeUsage(usage, ev.usage);
        }
      } catch { /* JSON parcial entre chunks */ }
    }
  });

  // FIX crítico: sem isto, qualquer soluço no upstream travava o cliente p/ sempre.
  stream.on("error", () => { if (!res.writableEnded) res.end(); });

  stream.on("end", () => {
    if (!res.writableEnded) res.end();
    if (aborted) return;
    void finalizeStats({ original, usage, model, originalModel, headers, key, start, config, payload: chunks.join(""), kind: "stream" });
  });
}

interface FinalizeArgs {
  original: AnthropicRequest;
  usage: Usage;
  model: string;
  originalModel: string;
  headers: Record<string, string>;
  key: string;
  start: number;
  config: Config;
  payload: string;
  kind: "json" | "stream";
}

/** Mede economia real (count_tokens), calcula custos reais, loga e cacheia. */
async function finalizeStats(a: FinalizeArgs): Promise<void> {
  try {
    const { usage, model, originalModel, config } = a;
    const actualInput = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens;

    // Tokens do request ORIGINAL (antes de qualquer compressão), medidos pela
    // própria Anthropic via count_tokens (grátis). Sem isso, não inventamos.
    let originalInput = actualInput;
    let measured = false;
    if (config.measure_savings) {
      const counted = await countOriginalTokens(a.original, a.headers, config);
      if (counted != null) { originalInput = counted; measured = true; }
    }

    const priceActual = priceFor(model, config);
    const priceOrig = priceFor(originalModel, config);

    const real = computeCost(model, usage, config).real;
    // baseline = request original, no modelo original, SEM cache nem compressão
    const baseline = (originalInput * priceOrig.input + usage.output_tokens * priceOrig.output) / M;

    const compressionSavings = ((originalInput - actualInput) * priceOrig.input) / M;
    const cacheSavings =
      ((usage.cache_read_input_tokens * 0.9 - usage.cache_creation_input_tokens * 0.25) * priceActual.input) / M;
    const totalSavings = baseline - real;

    const stat: RequestStats = {
      id: uuid(),
      timestamp: Date.now(),
      model,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_read_tokens: usage.cache_read_input_tokens,
      cache_creation_tokens: usage.cache_creation_input_tokens,
      original_input_tokens: originalInput,
      measured,
      real_cost_usd: real,
      baseline_cost_usd: baseline,
      compression_savings_usd: compressionSavings,
      cache_savings_usd: cacheSavings,
      total_savings_usd: totalSavings,
      response_cache_hit: false,
      response_cache_savings_usd: 0,
      latency_ms: Date.now() - a.start,
    };
    logRequest(stat);

    if (config.response_cache.enabled) {
      const envelope: CachedResponse = { kind: a.kind, payload: a.payload, stat };
      await setCached(a.key, envelope, config.response_cache.ttl_seconds);
    }
  } catch {
    // Medição/log nunca podem derrubar o fluxo principal.
  }
}

/** Conta os tokens do request original usando o tokenizer real da Anthropic. */
async function countOriginalTokens(
  original: AnthropicRequest, headers: Record<string, string>, config: Config,
): Promise<number | null> {
  try {
    const payload: Record<string, unknown> = {
      model: original.model,
      messages: original.messages,
    };
    if (original.system) payload.system = original.system;
    if (original.tools) payload.tools = original.tools;
    if (original.tool_choice) payload.tool_choice = original.tool_choice;

    const extra = await buildAxiosConfig(config);
    const resp = await axios.post(`${config.anthropic_api_url}/v1/messages/count_tokens`, payload, {
      headers,
      validateStatus: () => true,
      timeout: 8000,
      ...extra,
    });
    if (resp.status === 200 && typeof resp.data?.input_tokens === "number") {
      return resp.data.input_tokens as number;
    }
    return null;
  } catch {
    return null;
  }
}

function mergeUsage(target: Usage, u: Record<string, number | undefined> | undefined): void {
  if (!u) return;
  if (typeof u.input_tokens === "number") target.input_tokens = u.input_tokens;
  if (typeof u.output_tokens === "number") target.output_tokens = u.output_tokens;
  if (typeof u.cache_read_input_tokens === "number") target.cache_read_input_tokens = u.cache_read_input_tokens;
  if (typeof u.cache_creation_input_tokens === "number") target.cache_creation_input_tokens = u.cache_creation_input_tokens;
}

function readStream(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    stream.on("data", (c: Buffer) => { data += c.toString(); });
    stream.on("end", () => resolve(data));
    stream.on("error", () => resolve(data));
  });
}
