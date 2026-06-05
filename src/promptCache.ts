import {
  AnthropicRequest,
  AnthropicSystemBlock,
  AnthropicContentBlock,
  Config,
} from "./types";

/**
 * Injeção SEGURA de cache_control (lossless).
 *
 * Regra de ouro: se o cliente já mandou QUALQUER cache_control (o Claude Code
 * faz isso nativamente), não tocamos em nada — mexer poderia estourar o limite
 * de 4 breakpoints da API e causar erro 400 (o famoso "deixa de responder").
 *
 * Só injetamos quando o cliente NÃO usa cache (ex.: app próprio via API crua,
 * outro cliente sem caching). Aí marcamos no máximo 2 breakpoints estáveis:
 *   1. system prompt (quase sempre repetido)
 *   2. último bloco do histórico estável (tudo menos a mensagem atual)
 *
 * Isso é o que de fato reduz tokens de verdade SEM perder qualidade.
 */

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Detecta se já existe cache_control em qualquer lugar da requisição.
 *  (true = o cliente, ex. Claude Code, já gerencia o próprio prompt cache.) */
export function hasCacheControl(req: AnthropicRequest): boolean {
  if (Array.isArray(req.system)) {
    if (req.system.some((b) => b && b.cache_control)) return true;
  }
  for (const msg of req.messages ?? []) {
    if (Array.isArray(msg.content)) {
      if (msg.content.some((b) => b && (b as AnthropicContentBlock).cache_control)) return true;
    }
  }
  return false;
}

export function injectPromptCache(request: AnthropicRequest, config: Config): AnthropicRequest {
  if (!config.prompt_cache.enabled) return request;
  // Cliente já gerencia o próprio cache — não interferir.
  if (hasCacheControl(request)) return request;

  const minTokens = config.prompt_cache.min_tokens_to_cache;
  const result: AnthropicRequest = { ...request };

  // 1. System prompt
  if (result.system) {
    if (typeof result.system === "string") {
      if (estimateTokens(result.system) >= minTokens) {
        result.system = [
          { type: "text", text: result.system, cache_control: { type: "ephemeral" } },
        ] as AnthropicSystemBlock[];
      }
    } else if (Array.isArray(result.system) && result.system.length > 0) {
      const blocks = [...result.system];
      const last = blocks[blocks.length - 1];
      if (last && last.type === "text" && estimateTokens(last.text) >= minTokens) {
        blocks[blocks.length - 1] = { ...last, cache_control: { type: "ephemeral" } };
        result.system = blocks;
      }
    }
  }

  // 2. Histórico estável: marca o último bloco da penúltima mensagem
  //    (a última mensagem é a pergunta atual — muda sempre, não cacheia).
  if (Array.isArray(result.messages) && result.messages.length >= 3) {
    const messages = [...result.messages];
    const idx = messages.length - 2; // penúltima
    const msg = messages[idx];

    if (typeof msg.content === "string") {
      if (estimateTokens(msg.content) >= minTokens) {
        messages[idx] = {
          ...msg,
          content: [
            { type: "text", text: msg.content, cache_control: { type: "ephemeral" } },
          ],
        };
      }
    } else if (Array.isArray(msg.content) && msg.content.length > 0) {
      const content = [...msg.content];
      const lastBlock = content[content.length - 1];
      const blockText = lastBlock?.text ?? "";
      if (estimateTokens(blockText) >= minTokens) {
        content[content.length - 1] = { ...lastBlock, cache_control: { type: "ephemeral" } };
        messages[idx] = { ...msg, content };
      }
    }

    result.messages = messages;
  }

  return result;
}
