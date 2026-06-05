#!/usr/bin/env node
import express from "express";
import { loadConfig } from "./config";
import { createProxyHandler } from "./proxy";
import { createDashboardRouter } from "./dashboard";
import { initCache } from "./cache";
import { initDb, flush } from "./analytics";
import { startHttpsProxy } from "./httpsProxy";

function buildApp(config: ReturnType<typeof loadConfig>) {
  const app = express();
  app.use(express.json({ limit: "32mb" }));

  app.get("/", (_req, res) => {
    res.json({
      service: "trimtoken",
      status: "ok",
      version: "2.0.0",
      dashboard: `http://localhost:${config.port}${config.dashboard.path}`,
      https_mode: config.https_mode.enabled,
    });
  });
  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  if (config.dashboard.enabled) {
    app.use(config.dashboard.path, createDashboardRouter(config));
  }

  app.use("/", createProxyHandler(config));
  return app;
}

async function main() {
  const config = loadConfig();

  initDb();
  await initCache(config);

  const httpApp = buildApp(config);
  httpApp.listen(config.port, "127.0.0.1", () => {
    console.log(`\n✓ TrimToken em http://localhost:${config.port}`);
    console.log(`  Dashboard: http://localhost:${config.port}${config.dashboard.path}`);
  });

  if (config.https_mode.enabled) {
    try {
      const httpsApp = buildApp(config);
      await startHttpsProxy({
        port: config.https_mode.port,
        hostname: "0.0.0.0",
        upstreamHost: config.https_mode.hostname,
        forwardingApp: httpsApp,
      });
      console.log(`\n  Modo HTTPS ATIVO — interceptando ${config.https_mode.hostname}\n`);
    } catch (err) {
      console.error(`\n✗ HTTPS mode falhou: ${(err as Error).message}`);
      console.error(`  Continuando só em modo HTTP.\n`);
    }
  } else {
    console.log(`\n  Configure no Claude Code:`);
    console.log(`  ANTHROPIC_BASE_URL=http://localhost:${config.port}\n`);
  }

  // Grava analytics pendentes ao encerrar.
  const shutdown = async () => { await flush(); process.exit(0); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Erro ao iniciar TrimToken:", err);
  process.exit(1);
});
