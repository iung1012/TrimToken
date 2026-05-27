import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { Config } from "./types";

const DEFAULTS: Config = {
  port: 8019,
  anthropic_api_url: "https://api.anthropic.com",
  routing: {
    enabled: true,
    cost_threshold: 0.3,
    models: {
      simple: "claude-3-5-haiku-20241022",
      standard: "claude-sonnet-4-5",
      complex: "claude-opus-4-5",
    },
  },
  prompt_cache: { enabled: true, min_tokens_to_cache: 1024 },
  session_memory: { enabled: true, ttl_seconds: 7200 },
  response_cache: { enabled: true, ttl_seconds: 3600, redis_url: "" },
  output_compress: { enabled: true, level: "medium" },
  input_compress: { enabled: true, level: "medium", preserve_last_message: true },
  code_compress: { enabled: true, level: "medium", preserve_last_message: true },
  dashboard: { enabled: true, port: 8019, path: "/dashboard" },
  https_mode: { enabled: false, port: 443, hostname: "api.anthropic.com" },
};

export function loadConfig(): Config {
  const locations = [
    path.join(process.cwd(), "config.yaml"),
    path.join(process.env.HOME || process.env.USERPROFILE || "", ".claudesave", "config.yaml"),
  ];

  for (const loc of locations) {
    if (fs.existsSync(loc)) {
      const raw = yaml.load(fs.readFileSync(loc, "utf8")) as Partial<Config>;
      return deepMerge(DEFAULTS, raw);
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
