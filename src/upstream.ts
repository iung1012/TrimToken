import dns from "dns/promises";

/**
 * Resolve api.anthropic.com BYPASS do hosts file.
 *
 * Quando o hosts file está hijackado pra apontar api.anthropic.com → 127.0.0.1,
 * o resolver padrão do Node também usa essa entrada e nosso forward iria pra
 * nós mesmos (loop infinito).
 *
 * Solução: usa o resolver dns/promises com servidor DNS público explícito.
 * Isso ignora /etc/hosts no Windows.
 */

let cachedIP: string | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

const PUBLIC_DNS_SERVERS = ["1.1.1.1", "8.8.8.8", "9.9.9.9"];

export async function resolveUpstreamIP(hostname = "api.anthropic.com"): Promise<string> {
  if (cachedIP && Date.now() < cacheExpiry) return cachedIP;

  const resolver = new dns.Resolver();
  resolver.setServers(PUBLIC_DNS_SERVERS);

  try {
    const addrs = await resolver.resolve4(hostname);
    if (!addrs || addrs.length === 0) {
      throw new Error(`No A records for ${hostname}`);
    }
    cachedIP = addrs[0];
    cacheExpiry = Date.now() + CACHE_TTL_MS;
    return cachedIP;
  } catch (err) {
    // Fallback final: tenta DNS do sistema (pode dar 127.0.0.1 se hosts está hijackado)
    if (cachedIP) return cachedIP;
    throw new Error(`Failed to resolve ${hostname}: ${(err as Error).message}`);
  }
}

export function invalidateCache(): void {
  cachedIP = null;
  cacheExpiry = 0;
}
