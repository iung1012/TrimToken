import https from "https";
import http from "http";
import express, { Express } from "express";
import { ensureCerts } from "./certs";
import { resolveUpstreamIP } from "./upstream";
import { Config } from "./types";

/**
 * Servidor HTTPS para interceptar tráfego do Claude Desktop App.
 *
 * Pré-requisitos (feitos pelo install-https.ps1):
 *  1. Root CA do ClaudeSave instalada no Windows trust store
 *  2. hosts file com `127.0.0.1 api.anthropic.com`
 *  3. Permissão admin pra bind em port 443
 *
 * Fluxo:
 *   Desktop App → DNS → 127.0.0.1:443 (nós)
 *               → TLS handshake (cert assinado pela nossa CA, App confia)
 *               → Decifra request
 *               → Pipeline ClaudeSave aplica otimizações
 *               → Reenvia pra IP real da Anthropic via SNI
 *               → Recebe resposta criptografada
 *               → Decifra
 *               → Re-criptografa pra App
 */

export interface HttpsProxyOptions {
  port: number;
  hostname: string;
  upstreamHost: string;
  forwardingApp: Express;
}

export async function startHttpsProxy(opts: HttpsProxyOptions): Promise<https.Server> {
  const { caCertPem, leafCertPem, leafKeyPem } = ensureCerts(opts.upstreamHost);

  // Pré-resolve upstream IP para falhar cedo se DNS está broken
  let upstreamIP: string;
  try {
    upstreamIP = await resolveUpstreamIP(opts.upstreamHost);
    console.log(`  Upstream ${opts.upstreamHost} → ${upstreamIP}`);
  } catch (err) {
    console.error(`⚠ Não foi possível resolver upstream: ${(err as Error).message}`);
    throw err;
  }

  // Wrapper Express que substitui o agent do axios pra forçar IP direto
  const wrapperApp = express();
  wrapperApp.use(express.json({ limit: "10mb" }));

  // Injeta o IP resolvido no env pra o axios usar
  process.env.CLAUDESAVE_UPSTREAM_IP = upstreamIP;
  process.env.CLAUDESAVE_UPSTREAM_HOST = opts.upstreamHost;

  wrapperApp.use(opts.forwardingApp);

  const server = https.createServer(
    {
      key: leafKeyPem,
      cert: leafCertPem,
      ca: caCertPem,
    },
    wrapperApp
  );

  return new Promise((resolve, reject) => {
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EACCES") {
        console.error(`✗ Sem permissão para bind em port ${opts.port}. Execute como Administrador.`);
      } else if (err.code === "EADDRINUSE") {
        console.error(`✗ Port ${opts.port} já está em uso.`);
      }
      reject(err);
    });

    server.listen(opts.port, () => {
      console.log(`✓ HTTPS proxy escutando em ${opts.port} (TLS termination)`);
      resolve(server);
    });
  });
}
