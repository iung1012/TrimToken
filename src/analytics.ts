import fs from "fs";
import path from "path";
import os from "os";
import { RequestStats } from "./types";

interface DbSchema {
  requests: RequestStats[];
}

const MAX_RECORDS = 50_000;

let dbPath = "";
let tmpPath = "";
let data: DbSchema = { requests: [] };
let persistTimer: NodeJS.Timeout | null = null;
let dirty = false;

export function initDb(): void {
  const dir = path.join(os.homedir(), ".trimtoken");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  dbPath = path.join(dir, "analytics.json");
  tmpPath = path.join(dir, "analytics.json.tmp");

  if (fs.existsSync(dbPath)) {
    try {
      data = JSON.parse(fs.readFileSync(dbPath, "utf8"));
      if (!Array.isArray(data.requests)) data = { requests: [] };
    } catch {
      data = { requests: [] };
    }
  }
}

// Persistência assíncrona com debounce — NUNCA bloqueia o event loop por request.
function schedulePersist(): void {
  dirty = true;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persist();
  }, 1500);
}

async function persist(): Promise<void> {
  if (!dirty || !dbPath) return;
  dirty = false;
  try {
    await fs.promises.writeFile(tmpPath, JSON.stringify(data), "utf8");
    await fs.promises.rename(tmpPath, dbPath); // escrita atômica
  } catch {
    dirty = true; // tenta de novo no próximo ciclo
  }
}

/** Garante que tudo foi gravado (chamar no shutdown). */
export async function flush(): Promise<void> {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  await persist();
}

export function logRequest(stats: RequestStats): void {
  data.requests.push(stats);
  if (data.requests.length > MAX_RECORDS) {
    data.requests = data.requests.slice(-MAX_RECORDS);
  }
  schedulePersist();
}

export interface Summary {
  total_requests: number;
  api_calls: number;
  response_cache_hits: number;

  // Dinheiro (real)
  real_cost_usd: number;              // o que você pagou
  trimtoken_savings_usd: number;      // economia ATRIBUÍVEL ao TrimToken (compressão + response cache + cache injetado por nós)
  compression_savings_usd: number;    // parte de compressão (proxy)
  response_cache_savings_usd: number; // parte de response cache (proxy)
  native_cache_savings_usd: number;   // economia do cache NATIVO do cliente (info — não é mérito do proxy)
  savings_pct: number;                // % economizado pelo TrimToken vs. sem TrimToken

  // Tokens (reais, processados pela API)
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  original_input_tokens: number;
  input_tokens_saved: number;

  measured_pct: number;
  model_breakdown: Record<string, { requests: number; cost_usd: number }>;
}

export function getSummary(days = 7): Summary {
  const since = Date.now() - days * 86_400_000;
  const rows = data.requests.filter((r) => r.timestamp >= since);

  let real = 0, compSav = 0, respSav = 0, proxySav = 0, nativeCacheSav = 0;
  let inTok = 0, outTok = 0, cacheRead = 0, cacheCreate = 0, origInTok = 0;
  let apiCalls = 0, respHits = 0, measuredCount = 0;
  const model_breakdown: Record<string, { requests: number; cost_usd: number }> = {};

  for (const r of rows) {
    real += r.real_cost_usd;
    compSav += r.compression_savings_usd;
    respSav += r.response_cache_savings_usd;
    proxySav += r.total_savings_usd + r.response_cache_savings_usd; // atribuível ao TrimToken
    if (r.client_cached) nativeCacheSav += r.cache_savings_usd;     // cache do próprio cliente (info)

    inTok += r.input_tokens;
    outTok += r.output_tokens;
    cacheRead += r.cache_read_tokens;
    cacheCreate += r.cache_creation_tokens;
    origInTok += r.original_input_tokens;

    if (r.response_cache_hit) respHits++; else apiCalls++;
    if (r.measured) measuredCount++;

    const mb = model_breakdown[r.model] ?? { requests: 0, cost_usd: 0 };
    mb.requests++;
    mb.cost_usd += r.real_cost_usd;
    model_breakdown[r.model] = mb;
  }

  // baseline sem TrimToken = o que você pagaria de fato sem o proxy.
  const withoutProxy = real + proxySav;
  const savings_pct = withoutProxy > 0 ? Math.max(-100, Math.min(100, (proxySav / withoutProxy) * 100)) : 0;
  const realInputSent = inTok + cacheRead + cacheCreate;

  return {
    total_requests: rows.length,
    api_calls: apiCalls,
    response_cache_hits: respHits,
    real_cost_usd: real,
    trimtoken_savings_usd: proxySav,
    compression_savings_usd: compSav,
    response_cache_savings_usd: respSav,
    native_cache_savings_usd: nativeCacheSav,
    savings_pct,
    input_tokens: inTok,
    output_tokens: outTok,
    cache_read_tokens: cacheRead,
    cache_creation_tokens: cacheCreate,
    original_input_tokens: origInTok,
    input_tokens_saved: Math.max(0, origInTok - realInputSent),
    measured_pct: rows.length > 0 ? (measuredCount / rows.length) * 100 : 0,
    model_breakdown,
  };
}

export function getRecentRequests(limit = 100): RequestStats[] {
  return [...data.requests].reverse().slice(0, limit);
}
