import { Request, Response } from "express";
import axios from "axios";
import { v4 as uuid } from "uuid";
import { Config, AnthropicRequest, RequestStats } from "./types";
import { classifyComplexity, selectModel, calcCost, getPricing } from "./router";
import { injectPromptCache } from "./promptCache";
import { hashRequest, getCached, setCached } from "./cache";
import { getSession, saveSession, extractSessionId } from "./session";
import { compressInput } from "./inputCompress";
import { compressCode } from "./codeCompress";
import { injectOutputCompression } from "./outputCompress";
import { logRequest } from "./analytics";
import { getUpstreamAgent, shouldUseUpstreamAgent } from "./upstreamAgent";

async function buildAxiosConfig(config: Config): Promise<{ httpsAgent?: import("https").Agent }> {
  if (!shouldUseUpstreamAgent(config)) return {};
  const agent = await getUpstreamAgent(config.https_mode.hostname);
  return { httpsAgent: agent };
}

export function createProxyHandler(config: Config) {
  return async (req: Request, res: Response): Promise<void> => {
    // Passa qualquer rota que não seja a API de mensagens sem modificar
    if (!req.path.startsWith("/v1/messages")) {
      const target = `${config.anthropic_api_url}${req.path}`;
      try {
        const extra = await buildAxiosConfig(config);
        const resp = await axios({
          method: req.method,
          url: target,
          data: req.body,
          headers: forwardHeaders(req.headers as Record<string, string>),
          validateStatus: () => true,
          ...extra,
        });
        res.status(resp.status).send(resp.data);
      } catch (err: unknown) {
        const error = err as { response?: { status: number; data: unknown }; message: string };
        const status = error.response?.status ?? 502;
        res.status(status).json(error.response?.data ?? { error: error.message });
      }
      return;
    }

    const start = Date.now();
    const body = req.body as AnthropicRequest;
    const originalModel = body.model;
    const headers = req.headers as Record<string, string | string[] | undefined>;

    // 1. Session memory
    if (config.session_memory.enabled && body.messages) {
      const sessionId = extractSessionId(headers, body.messages);
      saveSession(sessionId, body.messages, config);
    }

    // 2. INPUT COMPRESSION (RTK-style) — comprime whitespace/dedup
    const { request: compressedBody, stats: inputStats } = compressInput(body, config);

    // 2.5 SMART CODE COMPRESSION (codesight-inspired) — comprime function bodies
    const { request: codeCompressedBody, stats: codeStats } = compressCode(compressedBody, config);

    // 3. Smart routing — escolhe modelo pela complexidade (só se habilitado)
    const complexity = classifyComplexity(codeCompressedBody);
    const routedModel = config.routing.enabled
      ? selectModel(complexity, config)
      : body.model;
    const routedBody: AnthropicRequest = { ...codeCompressedBody, model: routedModel };

    // 4. OUTPUT COMPRESSION (Caveman) — instrui modelo a responder compacto
    const compressedOutput = injectOutputCompression(routedBody, config);

    // 5. Prompt cache — injeta cache_control
    const finalBody = injectPromptCache(compressedOutput, config);

    // 6. Response cache — retorna do cache se já vimos essa requisição
    const reqHash = hashRequest(finalBody);
    const cached = await getCached(reqHash);
    if (cached && config.response_cache.enabled && !body.stream) {
      const parsed = JSON.parse(cached);
      const inputTokens  = parsed.usage?.input_tokens  ?? 0;
      const outputTokens = parsed.usage?.output_tokens ?? 0;
      const totalSavedFromCompress = inputStats.tokens_saved + codeStats.tokens_saved;
      const origCost = calcCost(originalModel, inputTokens + totalSavedFromCompress, outputTokens);
      logRequest({
        id: uuid(), timestamp: Date.now(),
        original_model: originalModel, routed_model: routedModel,
        input_tokens: inputTokens, output_tokens: outputTokens, cached_tokens: inputTokens,
        input_tokens_saved: inputStats.tokens_saved,
        code_tokens_saved: codeStats.tokens_saved,
        output_tokens_saved_est: 0,
        original_cost_usd: origCost, actual_cost_usd: 0,
        savings_usd: origCost, savings_pct: 100,
        cache_hit: true, latency_ms: Date.now() - start,
      });
      res.status(200).json(parsed);
      return;
    }

    // 7. Encaminha para a API Anthropic
    try {
      const totalSavedFromCompress = inputStats.tokens_saved + codeStats.tokens_saved;
      if (body.stream) {
        await handleStreaming(req, res, finalBody, config, originalModel, routedModel, inputStats.tokens_saved, codeStats.tokens_saved, start);
      } else {
        await handleNormal(req, res, finalBody, config, originalModel, routedModel, inputStats.tokens_saved, codeStats.tokens_saved, reqHash, start);
      }
    } catch (err: unknown) {
      const error = err as { response?: { status: number; data: unknown }; message: string };
      const status = error.response?.status ?? 500;
      res.status(status).json(error.response?.data ?? { error: error.message });
    }
  };
}

async function handleNormal(
  req: Request, res: Response,
  body: AnthropicRequest, config: Config,
  originalModel: string, routedModel: string,
  inputTokensSaved: number,
  codeTokensSaved: number,
  reqHash: string, start: number
): Promise<void> {
  const extra = await buildAxiosConfig(config);
  const resp = await axios.post(
    `${config.anthropic_api_url}/v1/messages`,
    body,
    { headers: forwardHeaders(req.headers as Record<string, string>), ...extra }
  );

  const data = resp.data;
  const inputTokens  = data.usage?.input_tokens  ?? 0;
  const outputTokens = data.usage?.output_tokens ?? 0;
  const cachedTokens = data.usage?.cache_read_input_tokens ?? 0;

  // Custo "original" = se nada tivesse sido otimizado (modelo original + tokens não comprimidos)
  const origInput  = inputTokens + inputTokensSaved + codeTokensSaved;
  const outputSaveEst = estimateOutputSavings(outputTokens, config);
  const origOutput = outputTokens + outputSaveEst;

  const origCost   = calcCost(originalModel, origInput, origOutput);
  const actualCost = calcCost(routedModel,   inputTokens, outputTokens, cachedTokens);
  const savings    = Math.max(0, origCost - actualCost);
  const savingsPct = origCost > 0 ? (savings / origCost) * 100 : 0;

  const stats: RequestStats = {
    id: data.id ?? uuid(), timestamp: Date.now(),
    original_model: originalModel, routed_model: routedModel,
    input_tokens: inputTokens, output_tokens: outputTokens, cached_tokens: cachedTokens,
    input_tokens_saved: inputTokensSaved,
    code_tokens_saved: codeTokensSaved,
    output_tokens_saved_est: outputSaveEst,
    original_cost_usd: origCost, actual_cost_usd: actualCost,
    savings_usd: savings, savings_pct: savingsPct,
    cache_hit: false, latency_ms: Date.now() - start,
  };

  logRequest(stats);

  if (config.response_cache.enabled) {
    setCached(reqHash, JSON.stringify(data), config.response_cache.ttl_seconds);
  }

  res.status(resp.status).json(data);
}

/**
 * Estima quantos tokens de output o Caveman economizou.
 * Como não temos o "controle" sem caveman, usamos um fator empírico
 * baseado no nível de compressão.
 */
function estimateOutputSavings(actualOutputTokens: number, config: Config): number {
  if (!config.output_compress?.enabled) return 0;
  const factor: Record<string, number> = {
    off: 0,
    light: 0.20,      // ~20% economizado
    medium: 0.45,     // ~45% economizado
    aggressive: 0.65, // ~65% economizado
  };
  const f = factor[config.output_compress.level] ?? 0;
  if (f === 0) return 0;
  // se output real é X (já comprimido), original ≈ X / (1-f)
  // então economia = X / (1-f) - X
  return Math.round(actualOutputTokens * (f / (1 - f)));
}

async function handleStreaming(
  req: Request, res: Response,
  body: AnthropicRequest, config: Config,
  originalModel: string, routedModel: string,
  inputTokensSaved: number,
  codeTokensSaved: number,
  start: number
): Promise<void> {
  const extra = await buildAxiosConfig(config);
  const resp = await axios.post(
    `${config.anthropic_api_url}/v1/messages`,
    body,
    {
      headers: { ...forwardHeaders(req.headers as Record<string, string>), "accept": "text/event-stream" },
      responseType: "stream",
      validateStatus: () => true,
      ...extra,
    }
  );

  // Se erro HTTP, lê o body do stream e retorna JSON legível
  if (resp.status >= 400) {
    const errorBody = await new Promise<string>((resolve) => {
      let data = "";
      resp.data.on("data", (chunk: Buffer) => { data += chunk.toString(); });
      resp.data.on("end", () => resolve(data));
    });
    try { res.status(resp.status).json(JSON.parse(errorBody)); }
    catch { res.status(resp.status).send(errorBody); }
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.status(resp.status);

  let inputTokens = 0, outputTokens = 0, cachedTokens = 0;
  let sseBuffer = "";

  resp.data.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    res.write(text); // repassa imediatamente pro client

    // Parse SSE buffer linha-a-linha pra capturar usage corretamente
    sseBuffer += text;
    const lines = sseBuffer.split("\n");
    sseBuffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;

      try {
        const event = JSON.parse(payload);

        // message_start: vem com input_tokens e output_tokens inicial
        if (event.type === "message_start" && event.message?.usage) {
          const u = event.message.usage;
          if (u.input_tokens)            inputTokens  = u.input_tokens;
          if (u.output_tokens)           outputTokens = u.output_tokens;
          if (u.cache_read_input_tokens) cachedTokens = u.cache_read_input_tokens;
        }

        // message_delta: vem com output_tokens final
        if (event.type === "message_delta" && event.usage) {
          const u = event.usage;
          if (u.input_tokens)            inputTokens  = u.input_tokens;
          if (u.output_tokens)           outputTokens = u.output_tokens;
          if (u.cache_read_input_tokens) cachedTokens = u.cache_read_input_tokens;
        }
      } catch { /* JSON incompleto entre chunks, ignora */ }
    }
  });

  resp.data.on("end", () => {
    res.end();
    const outputSaveEst = estimateOutputSavings(outputTokens, config);
    const origInput  = inputTokens + inputTokensSaved + codeTokensSaved;
    const origOutput = outputTokens + outputSaveEst;
    const origCost   = calcCost(originalModel, origInput, origOutput);
    const actualCost = calcCost(routedModel,   inputTokens, outputTokens, cachedTokens);
    const savings    = Math.max(0, origCost - actualCost);
    logRequest({
      id: uuid(), timestamp: Date.now(),
      original_model: originalModel, routed_model: routedModel,
      input_tokens: inputTokens, output_tokens: outputTokens, cached_tokens: cachedTokens,
      input_tokens_saved: inputTokensSaved,
      code_tokens_saved: codeTokensSaved,
      output_tokens_saved_est: outputSaveEst,
      original_cost_usd: origCost, actual_cost_usd: actualCost,
      savings_usd: savings, savings_pct: origCost > 0 ? (savings / origCost) * 100 : 0,
      cache_hit: false, latency_ms: Date.now() - start,
    });
  });
}

function forwardHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  const allowed = ["x-api-key", "anthropic-version", "content-type", "anthropic-beta", "authorization"];
  for (const key of allowed) {
    const val = headers[key];
    if (val) result[key] = Array.isArray(val) ? val[0] : val;
  }
  return result;
}
