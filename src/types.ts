export type CompressionLevel = "off" | "light" | "medium" | "aggressive";

export interface Config {
  port: number;
  anthropic_api_url: string;
  routing: {
    enabled: boolean;
    cost_threshold: number;
    models: { simple: string; standard: string; complex: string };
  };
  prompt_cache: {
    enabled: boolean;
    min_tokens_to_cache: number;
  };
  session_memory: {
    enabled: boolean;
    ttl_seconds: number;
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
    level: "light" | "medium" | "aggressive";
    preserve_last_message: boolean;
  };
  dashboard: {
    enabled: boolean;
    port: number;
    path: string;
  };
  https_mode: {
    enabled: boolean;
    port: number;
    hostname: string;
  };
}

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContent[];
}

export interface AnthropicContent {
  type: string;
  text?: string;
  cache_control?: { type: "ephemeral" };
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
  max_tokens?: number;
  stream?: boolean;
  temperature?: number;
  [key: string]: unknown;
}

export interface RequestStats {
  id: string;
  timestamp: number;
  original_model: string;
  routed_model: string;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  input_tokens_saved: number;   // economia da camada input_compress
  code_tokens_saved: number;    // economia da camada code_compress
  output_tokens_saved_est: number; // estimativa da camada output_compress
  original_cost_usd: number;
  actual_cost_usd: number;
  savings_usd: number;
  savings_pct: number;
  cache_hit: boolean;
  latency_ms: number;
}

export type Complexity = "simple" | "standard" | "complex";
