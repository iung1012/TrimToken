import { Config, Usage } from "./types";

/**
 * Preços oficiais Anthropic (USD por 1M tokens), base input/output.
 * Cache (ephemeral 5min): escrita = 1.25x input, leitura = 0.10x input.
 *
 * Fonte: anthropic.com/pricing. Mantido como tabela editável; pode ser
 * sobrescrito via config.pricing. NÃO há nenhum número estimado aqui —
 * tudo é multiplicado pelos tokens REAIS retornados pela API.
 */
export interface ModelPrice {
  input: number;
  output: number;
}

const CACHE_WRITE_MULT = 1.25; // escrita de cache ephemeral (5 min)
const CACHE_READ_MULT = 0.1;   // leitura de cache

// Matchers por família — ordem importa (mais específico primeiro).
const TABLE: Array<{ test: (m: string) => boolean; price: ModelPrice }> = [
  { test: (m) => m.includes("opus"), price: { input: 15, output: 75 } },
  { test: (m) => m.includes("sonnet"), price: { input: 3, output: 15 } },
  // Haiku 4.x (mais novo) é mais caro que o 3.5
  { test: (m) => m.includes("haiku") && /haiku-4|4-5-haiku|haiku-4-5/.test(m), price: { input: 1, output: 5 } },
  { test: (m) => m.includes("haiku"), price: { input: 0.8, output: 4 } },
];

// Se o modelo for desconhecido, assume classe Sonnet (não infla economia).
const FALLBACK: ModelPrice = { input: 3, output: 15 };

export function priceFor(model: string, config?: Config): ModelPrice {
  const m = (model || "").toLowerCase();
  if (config?.pricing) {
    for (const key of Object.keys(config.pricing)) {
      if (m.includes(key.toLowerCase())) return config.pricing[key];
    }
  }
  for (const row of TABLE) if (row.test(m)) return row.price;
  return FALLBACK;
}

export interface CostBreakdown {
  /** O que você efetivamente pagou (com os descontos/sobretaxas de cache). */
  real: number;
  /** O que custaria se NÃO existisse cache nenhum (contrafactual honesto). */
  uncached: number;
}

/**
 * Calcula custo a partir do uso REAL. Nenhuma estimativa.
 *  - input_tokens: preço cheio
 *  - cache_creation_input_tokens: preço cheio x1.25 (sobretaxa de escrita)
 *  - cache_read_input_tokens: preço cheio x0.10 (desconto de leitura)
 *  - output_tokens: preço de output
 */
export function computeCost(model: string, u: Usage, config?: Config): CostBreakdown {
  const p = priceFor(model, config);
  const M = 1_000_000;

  const real =
    (u.input_tokens * p.input +
      u.cache_creation_input_tokens * p.input * CACHE_WRITE_MULT +
      u.cache_read_input_tokens * p.input * CACHE_READ_MULT +
      u.output_tokens * p.output) /
    M;

  const uncached =
    ((u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens) * p.input +
      u.output_tokens * p.output) /
    M;

  return { real, uncached };
}

/** Normaliza o objeto usage da API (campos podem faltar). */
export function normalizeUsage(raw: unknown): Usage {
  const u = (raw ?? {}) as Record<string, number | undefined>;
  return {
    input_tokens: u.input_tokens ?? 0,
    output_tokens: u.output_tokens ?? 0,
    cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
  };
}
