import NodeCache from "node-cache";
import { AnthropicMessage, Config } from "./types";

const sessions = new NodeCache({ useClones: false });

export function getSession(sessionId: string): AnthropicMessage[] {
  return sessions.get<AnthropicMessage[]>(sessionId) ?? [];
}

export function saveSession(sessionId: string, messages: AnthropicMessage[], config: Config): void {
  if (!config.session_memory.enabled) return;
  sessions.set(sessionId, messages, config.session_memory.ttl_seconds);
}

/**
 * Extrai um session ID da requisição. Usa o header x-session-id ou
 * deriva um hash estável das primeiras mensagens como fallback.
 */
export function extractSessionId(headers: Record<string, string | string[] | undefined>, messages: AnthropicMessage[]): string {
  const header = headers["x-session-id"];
  if (header && typeof header === "string") return header;

  // fallback: hash das primeiras 2 mensagens (identifica a conversa)
  const seed = JSON.stringify(messages.slice(0, 2));
  const { createHash } = require("crypto");
  return createHash("md5").update(seed).digest("hex");
}
