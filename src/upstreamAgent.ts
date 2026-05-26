import https from "https";
import { resolveUpstreamIP } from "./upstream";

/**
 * Custom https.Agent que conecta direto no IP real da Anthropic,
 * bypassando o hosts file que aponta o hostname pra localhost.
 *
 * Mantém o SNI correto (api.anthropic.com) pra o handshake TLS
 * com o servidor real funcionar normalmente.
 */

let cachedAgent: https.Agent | null = null;
let cachedIP: string | null = null;

export async function getUpstreamAgent(hostname = "api.anthropic.com"): Promise<https.Agent> {
  const ip = await resolveUpstreamIP(hostname);
  if (cachedAgent && cachedIP === ip) return cachedAgent;

  cachedIP = ip;
  cachedAgent = new https.Agent({
    keepAlive: true,
    // Quando axios for conectar, sobrescrevemos o lookup pra retornar o IP real
    lookup: (_host, _opts, cb) => {
      cb(null, ip, 4);
    },
    // SNI continua sendo o hostname pra TLS funcionar
    servername: hostname,
  } as https.AgentOptions);

  return cachedAgent;
}

export function shouldUseUpstreamAgent(config: { https_mode?: { enabled?: boolean } }): boolean {
  return !!config.https_mode?.enabled;
}
