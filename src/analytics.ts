import fs from "fs";
import path from "path";
import os from "os";
import { RequestStats } from "./types";

interface DbSchema {
  requests: RequestStats[];
}

let dbPath: string;
let data: DbSchema = { requests: [] };

export function initDb(): void {
  const dir = path.join(os.homedir(), ".claudesave");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  dbPath = path.join(dir, "analytics.json");

  if (fs.existsSync(dbPath)) {
    try {
      data = JSON.parse(fs.readFileSync(dbPath, "utf8"));
    } catch {
      data = { requests: [] };
    }
  }
}

function persist() {
  // Mantém apenas os últimos 10.000 registros para não crescer infinitamente
  if (data.requests.length > 10_000) {
    data.requests = data.requests.slice(-10_000);
  }
  fs.writeFileSync(dbPath, JSON.stringify(data), "utf8");
}

export function logRequest(stats: RequestStats): void {
  data.requests.push(stats);
  persist();
}

export function getSummary(days = 7): {
  total_requests: number;
  total_original_cost: number;
  total_actual_cost: number;
  total_savings: number;
  avg_savings_pct: number;
  cache_hits: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_input_tokens_saved: number;
  total_code_tokens_saved: number;
  total_output_tokens_saved: number;
  total_cached_tokens: number;
  model_breakdown: Record<string, number>;
} {
  const since = Date.now() - days * 86400_000;
  const rows = data.requests.filter((r) => r.timestamp >= since);

  const total_original_cost = rows.reduce((s, r) => s + r.original_cost_usd, 0);
  const total_actual_cost   = rows.reduce((s, r) => s + r.actual_cost_usd, 0);
  const total_savings       = rows.reduce((s, r) => s + r.savings_usd, 0);
  // % real = economia total / custo original total (não média de percentuais por request)
  const avg_savings_pct     = total_original_cost > 0 ? Math.min(100, (total_savings / total_original_cost) * 100) : 0;
  const cache_hits          = rows.filter((r) => r.cache_hit).length;

  const total_input_tokens        = rows.reduce((s, r) => s + r.input_tokens, 0);
  const total_output_tokens       = rows.reduce((s, r) => s + r.output_tokens, 0);
  const total_input_tokens_saved  = rows.reduce((s, r) => s + (r.input_tokens_saved ?? 0), 0);
  const total_code_tokens_saved   = rows.reduce((s, r) => s + (r.code_tokens_saved ?? 0), 0);
  const total_output_tokens_saved = rows.reduce((s, r) => s + (r.output_tokens_saved_est ?? 0), 0);
  const total_cached_tokens       = rows.reduce((s, r) => s + r.cached_tokens, 0);

  const model_breakdown: Record<string, number> = {};
  for (const r of rows) {
    model_breakdown[r.routed_model] = (model_breakdown[r.routed_model] ?? 0) + 1;
  }

  return {
    total_requests: rows.length,
    total_original_cost,
    total_actual_cost,
    total_savings,
    avg_savings_pct,
    cache_hits,
    total_input_tokens,
    total_output_tokens,
    total_input_tokens_saved,
    total_code_tokens_saved,
    total_output_tokens_saved,
    total_cached_tokens,
    model_breakdown,
  };
}

export function getRecentRequests(limit = 50): RequestStats[] {
  return [...data.requests].reverse().slice(0, limit);
}
