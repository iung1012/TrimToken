import { AnthropicMessage, AnthropicRequest, Complexity, Config } from "./types";

// Keywords que indicam tarefas complexas (Opus)
const COMPLEX_PATTERNS = [
  /architect/i, /design system/i, /refactor entire/i, /analyze (the )?entire/i,
  /security audit/i, /performance audit/i, /system design/i, /rewrite/i,
];

// Keywords que indicam tarefas simples (Haiku)
const SIMPLE_PATTERNS = [
  /^(what|where|when|who|how|why) (is|are|was|were|do|does|did)\b/i,
  /^(explain|describe|define|list|show|tell me about)\b/i,
  /syntax (of|for)/i, /what does .{0,40} mean/i, /give me an? example/i,
  /^(yes|no|ok|sure|thanks|got it)/i, /\bquick question\b/i,
];

function extractText(messages: AnthropicMessage[]): string {
  const last = messages[messages.length - 1];
  if (!last) return "";
  if (typeof last.content === "string") return last.content;
  return last.content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join(" ");
}

function estimateTokens(text: string): number {
  // ~4 chars per token (boa aproximação para inglês/código)
  return Math.ceil(text.length / 4);
}

function countCodeBlocks(text: string): number {
  return (text.match(/```/g) ?? []).length / 2;
}

export function classifyComplexity(request: AnthropicRequest): Complexity {
  const text = extractText(request.messages);
  const tokens = estimateTokens(text);
  const codeBlocks = countCodeBlocks(text);
  const historyLength = request.messages.length;

  // Forçar modelo específico se já foi roteado pelo usuário
  if (request.model.includes("opus")) return "complex";
  if (request.model.includes("haiku")) return "simple";

  // Padrões explícitos de complexidade alta
  if (COMPLEX_PATTERNS.some((p) => p.test(text))) return "complex";

  // Score de complexidade (0-10)
  let score = 0;
  if (tokens > 2000) score += 3;
  else if (tokens > 500) score += 1;
  if (codeBlocks > 2) score += 2;
  else if (codeBlocks > 0) score += 1;
  if (historyLength > 10) score += 2;
  else if (historyLength > 5) score += 1;
  if (/implement|build|create|fix|debug|refactor|optimize/i.test(text)) score += 2;
  if (/test|spec|unit test|coverage/i.test(text)) score += 1;

  // Padrões explícitos de simplicidade
  if (SIMPLE_PATTERNS.some((p) => p.test(text.trim()))) score -= 3;

  if (score >= 5) return "complex";
  if (score >= 2) return "standard";
  return "simple";
}

export function selectModel(complexity: Complexity, config: Config): string {
  if (!config.routing.enabled) return config.routing.models.standard;
  return config.routing.models[complexity];
}

// Custo por 1M tokens (input/output) em USD
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-haiku-3-5-20241022": { input: 0.80, output: 4.00 },
  "claude-sonnet-4-5":         { input: 3.00, output: 15.00 },
  "claude-opus-4-5":           { input: 15.00, output: 75.00 },
  // fallback genérico por família
  "haiku":  { input: 0.80, output: 4.00 },
  "sonnet": { input: 3.00, output: 15.00 },
  "opus":   { input: 15.00, output: 75.00 },
};

export function getPricing(model: string): { input: number; output: number } {
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  if (model.includes("haiku"))  return MODEL_PRICING["haiku"];
  if (model.includes("sonnet")) return MODEL_PRICING["sonnet"];
  if (model.includes("opus"))   return MODEL_PRICING["opus"];
  return MODEL_PRICING["sonnet"];
}

export function calcCost(model: string, inputTokens: number, outputTokens: number, cachedTokens = 0): number {
  const p = getPricing(model);
  const billableInput = inputTokens - cachedTokens;
  const cachedCost = (cachedTokens / 1_000_000) * p.input * 0.1; // cache = 10%
  const inputCost  = (billableInput  / 1_000_000) * p.input;
  const outputCost = (outputTokens   / 1_000_000) * p.output;
  return cachedCost + inputCost + outputCost;
}
