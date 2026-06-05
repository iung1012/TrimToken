// Tipos compartilhados.
//
// Filosofia: reduzir tokens DE VERDADE (compressão + cache) e medir a economia
// com o tokenizer REAL da Anthropic (endpoint count_tokens), nunca com chute.

export type CompressionLevel = "off" | "light" | "medium" | "aggressive";

export interface Config {
  port: number;
  anthropic_api_url: string;

  routing: {
    enabled: boolean;
    // Só roteia para um modelo mais barato quando é SEGURO (sem tools, sem
    // histórico) — assim nunca quebra uma sessão do Claude Code no meio.
    safe_only: boolean;
    models: { simple: string; standard: string; complex: string };
  };

  prompt_cache: {
    enabled: boolean;
    min_tokens_to_cache: number;
  };

  response_cache: {
    enabled: boolean;
    ttl_seconds: number;
    redis_url: string;
  };

  output_compress: {
    enabled: boolean;
    level: CompressionLevel;
  };

  input_compress: {
    enabled: boolean;
    level: CompressionLevel;
    preserve_last_message: boolean;
  };

  code_compress: {
    enabled: boolean;
    level: "off" | "light" | "medium" | "aggressive";
    preserve_last_message: boolean;
  };

  // Mede a economia real chamando count_tokens no request original.
  // É grátis e roda DEPOIS da resposta (não adiciona latência pro usuário).
  measure_savings: boolean;

  dashboard: {
    enabled: boolean;
    path: string;
  };

  https_mode: {
    enabled: boolean;
    port: number;
    hostname: string;
  };

  pricing?: Record<string, { input: number; output: number }>;
}

/** Uso real reportado pela API Anthropic (ground truth). */
export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export interface AnthropicContentBlock {
  type: string;
  text?: string;
  cache_control?: { type: "ephemeral" };
  [k: string]: unknown;
}

// Alias de compatibilidade (usado por input/codeCompress).
export type AnthropicContent = AnthropicContentBlock;

export interface AnthropicMessage {
  role: string;
  content: string | AnthropicContentBlock[];
}

export interface AnthropicSystemBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

export interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string | AnthropicSystemBlock[];
  tools?: unknown;
  tool_choice?: unknown;
  max_tokens?: number;
  stream?: boolean;
  temperature?: number;
  [k: string]: unknown;
}

export type Complexity = "simple" | "standard" | "complex";

/**
 * Estatística por requisição. Tokens e custo são REAIS (da API).
 * `original_input_tokens` vem do count_tokens real quando measure_savings=true.
 */
export interface RequestStats {
  id: string;
  timestamp: number;
  model: string;

  // Uso REAL da API (0 em response-cache hit, pois a API não foi chamada)
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;

  // Medição da compressão
  original_input_tokens: number; // count_tokens do request ORIGINAL (real) ou estimado
  measured: boolean;             // true = veio de count_tokens (real), false = estimado

  // Dinheiro
  real_cost_usd: number;            // pago de fato
  baseline_cost_usd: number;        // request original, sem cache nem compressão
  compression_savings_usd: number;  // economia por remover tokens do input
  cache_savings_usd: number;        // economia por prompt cache
  total_savings_usd: number;        // soma das economias vs. baseline

  response_cache_hit: boolean;
  response_cache_savings_usd: number;

  latency_ms: number;
}
