import crypto from "crypto";
import NodeCache from "node-cache";
import { AnthropicRequest, Config, RequestStats } from "./types";

let redisClient: import("ioredis").Redis | null = null;
const memCache = new NodeCache({ useClones: false });

export async function initCache(config: Config): Promise<void> {
  if (config.response_cache.redis_url) {
    try {
      const { default: Redis } = await import("ioredis");
      redisClient = new Redis(config.response_cache.redis_url, { lazyConnect: false });
      redisClient.on("error", () => { redisClient = null; }); // fallback p/ memória
    } catch {
      redisClient = null;
    }
  }
}

/**
 * Envelope guardado no cache de resposta. Guardamos o payload bruto (JSON ou
 * SSE) + o usage real, para creditar a economia correta no cache-hit.
 */
export interface CachedResponse {
  kind: "json" | "stream";
  payload: string; // corpo JSON serializado OU o stream SSE bruto
  stat: RequestStats; // snapshot pra creditar a economia correta no hit
}

/** Hash determinístico do corpo inteiro = "requisição idêntica". */
export function hashRequest(request: AnthropicRequest): string {
  return crypto.createHash("sha256").update(JSON.stringify(request)).digest("hex");
}

export async function getCached(hash: string): Promise<CachedResponse | null> {
  let raw: string | null | undefined;
  if (redisClient) {
    raw = await redisClient.get(`tt:${hash}`);
  } else {
    raw = memCache.get<string>(hash);
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CachedResponse;
  } catch {
    return null;
  }
}

export async function setCached(hash: string, value: CachedResponse, ttlSeconds: number): Promise<void> {
  const raw = JSON.stringify(value);
  if (redisClient) {
    await redisClient.setex(`tt:${hash}`, ttlSeconds, raw);
    return;
  }
  memCache.set(hash, raw, ttlSeconds);
}
