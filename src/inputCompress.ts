import { AnthropicMessage, AnthropicRequest, AnthropicContent, Config } from "./types";

/**
 * Input Compression (RTK-style)
 *
 * Comprime o conteúdo das mensagens antes de enviar para a Anthropic.
 * Reduz tokens de input em 30-70% preservando informação técnica.
 *
 * Heurísticas aplicadas:
 *  - Colapsa whitespace múltiplo (linhas em branco, espaços, tabs)
 *  - Deduplica linhas consecutivas idênticas
 *  - Trunca outputs de comando muito longos (logs, listings)
 *  - Remove blocos repetitivos típicos de ls/find/grep
 *  - Preserva blocos de código (```) intactos
 */

interface CompressResult {
  text: string;
  saved: number; // tokens estimados economizados
}

const TOKEN_RATIO = 4; // ~4 chars per token

function estimateTokens(s: string): number {
  return Math.ceil(s.length / TOKEN_RATIO);
}

function compressOutsideCode(text: string, aggressive: boolean): string {
  let out = text;

  // 1. Colapsa 3+ newlines em 2
  out = out.replace(/\n{3,}/g, "\n\n");

  // 2. Remove trailing whitespace
  out = out.replace(/[ \t]+$/gm, "");

  // 3. Colapsa runs de espaço (mas preserva indentação no início da linha)
  out = out.replace(/([^\n ])[ ]{2,}/g, "$1 ");

  // 4. Deduplica linhas consecutivas idênticas (típico em logs)
  out = out.replace(/^(.+)$\n(?:^\1$\n)+/gm, "$1\n");

  if (aggressive) {
    // 5. Trunca listas longas (ls/find output) — pega primeiras 20 e últimas 5
    out = out.replace(
      /((?:^[^\n]+\n){25,})/gm,
      (match) => {
        const lines = match.split("\n").filter(Boolean);
        if (lines.length < 30) return match;
        const head = lines.slice(0, 20).join("\n");
        const tail = lines.slice(-5).join("\n");
        const skipped = lines.length - 25;
        return `${head}\n... [${skipped} linhas similares omitidas] ...\n${tail}\n`;
      }
    );

    // 6. Remove linhas em branco dentro de logs
    out = out.replace(/(\n\s*){2,}/g, "\n");
  }

  return out;
}

/**
 * Comprime preservando blocos de código.
 * Divide o texto em segmentos (texto / código / texto / código...) e
 * só aplica compressão nos segmentos de texto.
 */
function compressPreservingCode(text: string, aggressive: boolean): CompressResult {
  const original = text;
  const parts = text.split(/(```[\s\S]*?```)/g);
  const compressed = parts
    .map((part, i) => {
      if (i % 2 === 1) return part; // bloco de código, preservar
      return compressOutsideCode(part, aggressive);
    })
    .join("");

  return {
    text: compressed,
    saved: estimateTokens(original) - estimateTokens(compressed),
  };
}

function compressMessageContent(
  msg: AnthropicMessage,
  aggressive: boolean
): { msg: AnthropicMessage; saved: number } {
  if (typeof msg.content === "string") {
    const r = compressPreservingCode(msg.content, aggressive);
    return { msg: { ...msg, content: r.text }, saved: r.saved };
  }

  let totalSaved = 0;
  const newContent: AnthropicContent[] = msg.content.map((block) => {
    if (block.type !== "text" || !block.text) return block;
    const r = compressPreservingCode(block.text, aggressive);
    totalSaved += r.saved;
    return { ...block, text: r.text };
  });

  return { msg: { ...msg, content: newContent }, saved: totalSaved };
}

export interface InputCompressionStats {
  tokens_saved: number;
  original_tokens: number;
  compressed_tokens: number;
}

export function compressInput(
  request: AnthropicRequest,
  config: Config
): { request: AnthropicRequest; stats: InputCompressionStats } {
  if (!config.input_compress?.enabled) {
    return {
      request,
      stats: { tokens_saved: 0, original_tokens: 0, compressed_tokens: 0 },
    };
  }

  const aggressive = config.input_compress.level === "aggressive";
  // Por padrão NÃO comprime a última mensagem do usuário (é o que ele acabou de pedir)
  const preserveLast = config.input_compress.preserve_last_message !== false;

  const originalSize = JSON.stringify(request.messages).length;

  let totalSaved = 0;
  const lastIdx = request.messages.length - 1;
  const newMessages = request.messages.map((m, i) => {
    if (preserveLast && i === lastIdx) return m;
    const r = compressMessageContent(m, aggressive);
    totalSaved += r.saved;
    return r.msg;
  });

  const result = { ...request, messages: newMessages };
  const compressedSize = JSON.stringify(result.messages).length;

  return {
    request: result,
    stats: {
      tokens_saved: totalSaved,
      original_tokens: estimateTokens(JSON.stringify(request.messages)),
      compressed_tokens: estimateTokens(JSON.stringify(result.messages)),
    },
  };
}
