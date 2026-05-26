import crypto from "crypto";
import NodeCache from "node-cache";
import { AnthropicRequest, Config } from "./types";

let redisClient: import("ioredis").Redis | null = null;
const memCache = new NodeCache({ useClones: false });

export async function initCache(config: Config): Promise<void> {
  if (config.response_cache.redis_url) {
    const { default: Redis } = await import("ioredis");
    redisClient = new Redis(config.response_cache.redis_url);
    redisClient.on("error", () => { redisClient = null; }); // fallback pra memória se Redis cair
  }
}

export function hashRequest(request: AnthropicRequest): string {
  const key = JSON.stringify({
    model: request.model,
    messages: request.messages,
    system: request.system ?? null,
    temperature: request.temperature ?? 1,
  });
  return crypto.createHash("sha256").update(key).digest("hex");
}

export async function getCached(hash: string): Promise<string | null> {
  if (redisClient) {
    const val = await redisClient.get(`cs:${hash}`);
    return val;
  }
  return memCache.get<string>(hash) ?? null;
}

export async function setCached(hash: string, response: string, ttlSeconds: number): Promise<void> {
  if (redisClient) {
    await redisClient.setex(`cs:${hash}`, ttlSeconds, response);
    return;
  }
  memCache.set(hash, response, ttlSeconds);
}
