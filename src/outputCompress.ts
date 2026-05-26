import { AnthropicRequest, AnthropicSystemBlock, Config } from "./types";

/**
 * Output Compression (Caveman-style)
 *
 * Injeta instrução no system prompt para que o modelo responda de forma
 * compacta, reduzindo tokens de output em 40-70% sem perder conteúdo técnico.
 *
 * Funciona em QUALQUER plano (API ou Pro/Max) — só modifica o prompt.
 */

const COMPRESSION_INSTRUCTIONS: Record<string, string> = {
  off: "",

  light: `\n\n[Output style: be concise. No preamble. No closing summary. Skip pleasantries.]`,

  medium: `\n\n[Output style: terse and dense.
- No preamble, no "Sure!", no "Here's...", no closing summary
- No restating the question
- Code-only when code is the answer
- Use bullets over prose when listing
- Skip obvious explanations of well-known concepts
- Max 1 short sentence per concept unless asked for detail]`,

  aggressive: `\n\n[Output style: maximum compression.
- ZERO preamble or closing remarks
- ZERO restating questions or summarizing your answer
- Answer in fewest words possible while staying technically accurate
- Code blocks only — no explanation unless asked
- Bullets for lists, not prose
- Omit articles where grammatically possible
- Use abbreviations: fn (function), var, ret (return), arr, obj
- No examples unless explicitly requested
- No "in summary" / "to summarize" / "let me know if..."]`,
};

export function injectOutputCompression(
  request: AnthropicRequest,
  config: Config
): AnthropicRequest {
  if (!config.output_compress?.enabled) return request;

  const level = config.output_compress.level || "medium";
  const instruction = COMPRESSION_INSTRUCTIONS[level];
  if (!instruction) return request;

  const result = { ...request };

  if (!result.system) {
    result.system = instruction.trim();
    return result;
  }

  if (typeof result.system === "string") {
    result.system = result.system + instruction;
    return result;
  }

  // array de blocos — adiciona no último bloco de texto
  const blocks = [...(result.system as AnthropicSystemBlock[])];
  const last = blocks[blocks.length - 1];
  if (last && last.type === "text") {
    blocks[blocks.length - 1] = { ...last, text: last.text + instruction };
  } else {
    blocks.push({ type: "text", text: instruction.trim() });
  }
  result.system = blocks;
  return result;
}
