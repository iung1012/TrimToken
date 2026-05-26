import { AnthropicRequest, AnthropicSystemBlock, AnthropicContent, Config } from "./types";

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Injeta cache_control nos lugares certos da requisição.
 *
 * Estratégia:
 *  1. System prompt (quase sempre repetido entre requests) → sempre cacheia
 *  2. Primeiras mensagens do histórico (contexto antigo) → cacheia se longo
 *  3. Última mensagem do usuário → nunca cacheia (é sempre nova)
 */
export function injectPromptCache(request: AnthropicRequest, config: Config): AnthropicRequest {
  if (!config.prompt_cache.enabled) return request;

  const minTokens = config.prompt_cache.min_tokens_to_cache;
  const result = { ...request };

  // 1. System prompt
  if (result.system) {
    if (typeof result.system === "string") {
      if (estimateTokens(result.system) >= minTokens) {
        result.system = [
          { type: "text", text: result.system, cache_control: { type: "ephemeral" } },
        ] as AnthropicSystemBlock[];
      }
    } else {
      // Já é array — adiciona cache_control no último bloco de texto longo
      const blocks = result.system as AnthropicSystemBlock[];
      const last = blocks[blocks.length - 1];
      if (last && estimateTokens(last.text) >= minTokens) {
        blocks[blocks.length - 1] = { ...last, cache_control: { type: "ephemeral" } };
      }
    }
  }

  // 2. Histórico de mensagens (tudo exceto a última)
  if (result.messages.length > 2) {
    const messages = [...result.messages];
    const historyEnd = messages.length - 1; // exclui última

    // Cacheia no breakpoint do meio do histórico para maximizar hits
    const breakpoint = Math.floor(historyEnd / 2);

    const msg = messages[breakpoint];
    const content = msg.content;

    if (typeof content === "string" && estimateTokens(content) >= minTokens) {
      messages[breakpoint] = {
        ...msg,
        content: [
          { type: "text", text: content, cache_control: { type: "ephemeral" } } as AnthropicContent,
        ],
      };
    } else if (Array.isArray(content) && content.length > 0) {
      const lastBlock = content[content.length - 1];
      const blockText = lastBlock.text ?? "";
      if (estimateTokens(blockText) >= minTokens) {
        const newContent = [...content];
        newContent[newContent.length - 1] = { ...lastBlock, cache_control: { type: "ephemeral" } };
        messages[breakpoint] = { ...msg, content: newContent };
      }
    }

    result.messages = messages;
  }

  return result;
}
