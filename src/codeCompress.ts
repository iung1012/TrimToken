import { AnthropicMessage, AnthropicRequest, AnthropicContent, Config } from "./types";

/**
 * Smart Code Compression (codesight-inspired)
 *
 * Detecta blocos de código nas mensagens e comprime function bodies em
 * assinaturas, mantendo imports/types/exports intactos.
 *
 * Quando o Claude Code lê um arquivo (`cat foo.ts`, ferramenta Read, @file),
 * o conteúdo bruto vai pro contexto. Em arquivos grandes, isso pode ser 80%+
 * de tokens só com implementação detalhada que o LLM nem precisa.
 *
 * Esta camada substitui:
 *
 *   function longFunction(a: string, b: number): boolean {
 *     const x = computeSomething(a);
 *     for (const item of x) { ... 25 linhas ... }
 *     return result;
 *   }
 *
 * Por:
 *
 *   function longFunction(a: string, b: number): boolean { /* 28 lines */ /*}
 *
 * Reduz 30-90% em prompts com código bruto pesado.
 */

interface CodeBlock {
  fence: string;          // ``` ou ```ts
  lang: string;           // typescript, python, go, etc
  body: string;
  fullMatch: string;      // o bloco completo no texto original
  start: number;
  end: number;
}

const FENCE_RE = /^```(\w*)\n([\s\S]*?)```$/gm;
const TOKEN_RATIO = 4;

function estimateTokens(s: string): number {
  return Math.ceil(s.length / TOKEN_RATIO);
}

/**
 * Saldo de chaves { } numa linha IGNORANDO strings ('...', "...", `...`) e
 * comentários de linha (//). Evita corromper a profundidade com chaves
 * literais, tipo  const x = "{ }";  — antes isso quebrava a compressão.
 */
function netBraces(line: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote && line[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === "/" && line[i + 1] === "/") break; // comentário de linha
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
  }
  return depth;
}

function extractCodeBlocks(text: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(FENCE_RE.source, "gm");
  while ((m = re.exec(text)) !== null) {
    blocks.push({
      fence: "```" + m[1],
      lang: m[1].toLowerCase(),
      body: m[2],
      fullMatch: m[0],
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return blocks;
}

/**
 * Para JS/TS: comprime corpos de função/método > N linhas em comentários.
 * Preserva: imports, exports, types, interfaces, enums, const/let de uma linha,
 * funções curtas (< minLines).
 */
function compressJsTs(body: string, minLines: number): { body: string; saved: number } {
  const original = body;
  const lines = body.split("\n");
  const out: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Detecta início de função/método com corpo em `{`
    // Padrões: function name(..), const name = (..) =>, name(..) {, async name(..)
    const fnStart = /^(\s*)(?:export\s+(?:default\s+)?|async\s+|static\s+|public\s+|private\s+|protected\s+)*((?:function\s+\w+|(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>|\w+\s*\([^)]*\))[^{]*)\{/.exec(line);

    if (fnStart && !trimmed.endsWith("}")) {
      const signature = line;
      // Acha o `}` correspondente (contagem de chaves ciente de strings)
      let depth = netBraces(line);
      const bodyStart = i;
      i++;
      while (i < lines.length && depth > 0) {
        depth += netBraces(lines[i]);
        i++;
      }
      const bodyEnd = i; // exclusive
      const innerLines = bodyEnd - bodyStart - 1;

      if (innerLines >= minLines) {
        // Comprime: mantém assinatura + comentário + fecha
        out.push(`${signature} /* ${innerLines} lines */ }`);
        // pula linhas internas + linha de fechamento
      } else {
        // Preserva — copia tudo
        for (let k = bodyStart; k < bodyEnd; k++) out.push(lines[k]);
      }
      continue;
    }

    out.push(line);
    i++;
  }

  const compressed = out.join("\n");
  return {
    body: compressed,
    saved: estimateTokens(original) - estimateTokens(compressed),
  };
}

/**
 * Para Python: comprime corpos de def/class > N linhas.
 * Detecta indentação para achar o fim do bloco.
 */
function compressPython(body: string, minLines: number): { body: string; saved: number } {
  const original = body;
  const lines = body.split("\n");
  const out: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const defMatch = /^(\s*)(async\s+def|def|class)\s+(\w+)[^:]*:\s*$/.exec(line);

    if (defMatch) {
      const baseIndent = defMatch[1].length;
      const signature = line;
      const bodyStart = i + 1;
      let j = bodyStart;
      // Avança enquanto a linha está indentada mais que a definição (ou é vazia)
      while (j < lines.length) {
        const l = lines[j];
        if (l.trim() === "") { j++; continue; }
        const indent = (l.match(/^\s*/)?.[0].length) ?? 0;
        if (indent <= baseIndent) break;
        j++;
      }
      const bodyEnd = j;
      const innerLines = bodyEnd - bodyStart;

      if (innerLines >= minLines) {
        out.push(signature);
        out.push(`${" ".repeat(baseIndent + 4)}...  # ${innerLines} lines`);
        i = bodyEnd;
      } else {
        for (let k = i; k < bodyEnd; k++) out.push(lines[k]);
        i = bodyEnd;
      }
      continue;
    }

    out.push(line);
    i++;
  }

  const compressed = out.join("\n");
  return {
    body: compressed,
    saved: estimateTokens(original) - estimateTokens(compressed),
  };
}

/**
 * Para Go: comprime corpos de func > N linhas.
 */
function compressGo(body: string, minLines: number): { body: string; saved: number } {
  const original = body;
  const lines = body.split("\n");
  const out: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fnMatch = /^(\s*)func\s+(?:\([^)]*\)\s+)?(\w+)\s*\([^)]*\)[^{]*\{/.exec(line);

    if (fnMatch && !line.trim().endsWith("}")) {
      const signature = line;
      let depth = netBraces(line);
      const bodyStart = i;
      i++;
      while (i < lines.length && depth > 0) {
        depth += netBraces(lines[i]);
        i++;
      }
      const bodyEnd = i;
      const innerLines = bodyEnd - bodyStart - 1;

      if (innerLines >= minLines) {
        out.push(`${signature} /* ${innerLines} lines */ }`);
      } else {
        for (let k = bodyStart; k < bodyEnd; k++) out.push(lines[k]);
      }
      continue;
    }

    out.push(line);
    i++;
  }

  const compressed = out.join("\n");
  return {
    body: compressed,
    saved: estimateTokens(original) - estimateTokens(compressed),
  };
}

function compressByLang(body: string, lang: string, minLines: number): { body: string; saved: number } {
  if (lang === "typescript" || lang === "ts" || lang === "tsx" ||
      lang === "javascript" || lang === "js" || lang === "jsx") {
    return compressJsTs(body, minLines);
  }
  if (lang === "python" || lang === "py") {
    return compressPython(body, minLines);
  }
  if (lang === "go" || lang === "golang") {
    return compressGo(body, minLines);
  }
  // Fallback: aplica JS/TS (funciona razoavelmente para Java/C#/Rust)
  if (lang === "java" || lang === "kotlin" || lang === "cs" || lang === "rust" || lang === "rs") {
    return compressJsTs(body, minLines);
  }
  return { body, saved: 0 };
}

/**
 * Threshold para ativar compressão num bloco: tem que ter mais que N linhas
 * E ter um número mínimo de linhas comprimíveis.
 */
const MIN_BLOCK_LINES = 20;

function compressTextSegment(
  text: string,
  level: "light" | "medium" | "aggressive"
): { text: string; saved: number } {
  const minLines = level === "aggressive" ? 8 : level === "medium" ? 15 : 30;
  const blocks = extractCodeBlocks(text);
  if (blocks.length === 0) return { text, saved: 0 };

  let out = "";
  let cursor = 0;
  let totalSaved = 0;

  for (const block of blocks) {
    // texto antes do bloco
    out += text.slice(cursor, block.start);
    const lineCount = block.body.split("\n").length;

    if (lineCount < MIN_BLOCK_LINES) {
      out += block.fullMatch;
    } else {
      const r = compressByLang(block.body, block.lang, minLines);
      totalSaved += r.saved;
      // Garante newline antes do fence de fechamento (senão cola a última
      // linha do código no ``` e corrompe o bloco).
      const safeBody = r.body.endsWith("\n") ? r.body : r.body + "\n";
      out += `${block.fence}\n${safeBody}\`\`\``;
    }
    cursor = block.end;
  }
  out += text.slice(cursor);
  return { text: out, saved: totalSaved };
}

function compressMessage(
  msg: AnthropicMessage,
  level: "light" | "medium" | "aggressive"
): { msg: AnthropicMessage; saved: number } {
  if (typeof msg.content === "string") {
    const r = compressTextSegment(msg.content, level);
    return { msg: { ...msg, content: r.text }, saved: r.saved };
  }

  let totalSaved = 0;
  const newContent: AnthropicContent[] = msg.content.map((block) => {
    if (block.type !== "text" || !block.text) return block;
    const r = compressTextSegment(block.text, level);
    totalSaved += r.saved;
    return { ...block, text: r.text };
  });
  return { msg: { ...msg, content: newContent }, saved: totalSaved };
}

export interface CodeCompressionStats {
  tokens_saved: number;
  blocks_compressed: number;
}

export function compressCode(
  request: AnthropicRequest,
  config: Config
): { request: AnthropicRequest; stats: CodeCompressionStats } {
  if (!config.code_compress?.enabled || config.code_compress.level === "off") {
    return { request, stats: { tokens_saved: 0, blocks_compressed: 0 } };
  }

  const level = config.code_compress.level;
  const preserveLast = config.code_compress.preserve_last_message !== false;
  const lastIdx = request.messages.length - 1;

  let totalSaved = 0;
  const newMessages = request.messages.map((m, i) => {
    if (preserveLast && i === lastIdx) return m;
    const r = compressMessage(m, level);
    totalSaved += r.saved;
    return r.msg;
  });

  return {
    request: { ...request, messages: newMessages },
    stats: { tokens_saved: totalSaved, blocks_compressed: 0 },
  };
}
