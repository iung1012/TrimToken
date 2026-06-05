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

  if (request.model.includes("opus")) return "complex";
  if (request.model.includes("haiku")) return "simple";

  if (COMPLEX_PATTERNS.some((p) => p.test(text))) return "complex";

  let score = 0;
  if (tokens > 2000) score += 3;
  else if (tokens > 500) score += 1;
  if (codeBlocks > 2) score += 2;
  else if (codeBlocks > 0) score += 1;
  if (historyLength > 10) score += 2;
  else if (historyLength > 5) score += 1;
  if (/implement|build|create|fix|debug|refactor|optimize/i.test(text)) score += 2;
  if (/test|spec|unit test|coverage/i.test(text)) score += 1;

  if (SIMPLE_PATTERNS.some((p) => p.test(text.trim()))) score -= 3;

  if (score >= 5) return "complex";
  if (score >= 2) return "standard";
  return "simple";
}

/**
 * Decide o modelo final de forma SEGURA.
 *
 * Em modo safe_only (padrão), só faz downgrade para o modelo "simple" quando:
 *   - não há tools na requisição (não é um turno agêntico), E
 *   - há no máximo 1 mensagem (não estamos no meio de uma conversa).
 * Caso contrário, mantém o modelo original — assim a qualidade nunca cai
 * inesperadamente no meio de uma sessão do Claude Code.
 *
 * Retorna o nome do modelo a usar (igual ao original se nada mudar).
 */
export function selectModel(request: AnthropicRequest, config: Config): string {
  if (!config.routing.enabled) return request.model;

  const hasTools = Array.isArray(request.tools) && (request.tools as unknown[]).length > 0;
  const hasHistory = request.messages.length > 1;

  if (config.routing.safe_only && (hasTools || hasHistory)) {
    return request.model; // contexto agêntico → não arrisca
  }

  const complexity = classifyComplexity(request);
  if (complexity === "simple") return config.routing.models.simple;
  // standard/complex: preserva o modelo escolhido pelo cliente (evita 404 e
  // nunca faz "upgrade" não solicitado).
  return request.model;
}
