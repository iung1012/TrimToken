import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { Config } from "./types";

const DEFAULTS: Config = {
  port: 8019,
  anthropic_api_url: "https://api.anthropic.com",

  // Roteamento SEGURO: por padrão só troca de modelo quando não há tools nem
  // histórico (ou seja, nunca quebra uma sessão de Claude Code no meio).
  routing: {
    enabled: false,
    safe_only: true,
    models: {
      simple: "claude-haiku-4-5",
      standard: "claude-sonnet-4-5",
      complex: "claude-opus-4-5",
    },
  },

  // Prompt cache: só injeta cache_control quando o cliente NÃO mandou nenhum
  // (o Claude Code já faz isso; nesse caso não tocamos pra não estourar o limite).
  prompt_cache: { enabled: true, min_tokens_to_cache: 1024 },

  // Response cache: serve resposta idêntica do cache. 100% lossless.
  response_cache: { enabled: true, ttl_seconds: 3600, redis_url: "" },

  // Compressão de output: instrui o modelo a ser conciso (system prompt).
  output_compress: { enabled: true, level: "medium" },

  // Compressão de input: remove whitespace redundante, dedup, trunca logs.
  input_compress: { enabled: true, level: "medium", preserve_last_message: true },

  // Compressão de código: colapsa corpos de função no HISTÓRICO (preserva a
  // última mensagem). Reduz muito em prompts com código relido.
  code_compress: { enabled: true, level: "medium", preserve_last_message: true },

  // Medição real via count_tokens (grátis, roda após a resposta).
  measure_savings: true,

  // NÃO comprime clientes que já cacheiam (Claude Code) por padrão — evita
  // furar o cache nativo e sair mais caro. Compressão fica para API crua.
  compress_cached_clients: false,

  dashboard: { enabled: true, path: "/dashboard" },

  https_mode: { enabled: false, port: 443, hostname: "api.anthropic.com" },
};

export function loadConfig(): Config {
  const locations = [
    path.join(process.cwd(), "config.yaml"),
    path.join(process.env.HOME || process.env.USERPROFILE || "", ".trimtoken", "config.yaml"),
    path.join(process.env.HOME || process.env.USERPROFILE || "", ".claudesave", "config.yaml"),
  ];

  for (const loc of locations) {
    if (fs.existsSync(loc)) {
      try {
        const raw = yaml.load(fs.readFileSync(loc, "utf8")) as Partial<Config>;
        return deepMerge(DEFAULTS, raw ?? {});
      } catch {
        return DEFAULTS;
      }
    }
  }

  return DEFAULTS;
}

function deepMerge<T>(base: T, override: Partial<T>): T {
  const result = { ...base };
  for (const key in override) {
    const val = override[key];
    if (val && typeof val === "object" && !Array.isArray(val)) {
      result[key] = deepMerge(result[key] as object, val as object) as T[typeof key];
    } else if (val !== undefined) {
      result[key] = val as T[typeof key];
    }
  }
  return result;
}
