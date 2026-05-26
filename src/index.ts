import express from "express";
import { loadConfig } from "./config";
import { createProxyHandler } from "./proxy";
import { dashboardRouter } from "./dashboard";
import { initCache } from "./cache";
import { initDb } from "./analytics";
import { startHttpsProxy } from "./httpsProxy";

function buildApp(config: ReturnType<typeof loadConfig>) {
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  // Health
  app.get("/", (_req, res) => {
    res.json({
      service: "claudesave",
      status: "ok",
      version: "1.1.0",
      dashboard: `http://localhost:${config.port}${config.dashboard.path}`,
      https_mode: config.https_mode.enabled,
    });
  });
  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  if (config.dashboard.enabled) {
    app.use(config.dashboard.path, dashboardRouter);
  }

  app.use("/", createProxyHandler(config));
  return app;
}

async function main() {
  const config = loadConfig();

  initDb();
  await initCache(config);

  // 1. Servidor HTTP local (sempre)
  const httpApp = buildApp(config);
  httpApp.listen(config.port, "127.0.0.1", () => {
    console.log(`\n✓ ClaudeSave HTTP em http://localhost:${config.port}`);
    console.log(`  Dashboard: http://localhost:${config.port}${config.dashboard.path}`);
  });

  // 2. Servidor HTTPS (opcional, requer admin)
  if (config.https_mode.enabled) {
    try {
      const httpsApp = buildApp(config);
      await startHttpsProxy({
        port: config.https_mode.port,
        hostname: "0.0.0.0",
        upstreamHost: config.https_mode.hostname,
        forwardingApp: httpsApp,
      });
      console.log(`\n  Modo HTTPS ATIVO — interceptando ${config.https_mode.hostname}`);
      console.log(`  Claude Desktop App agora passa pelo proxy.\n`);
    } catch (err) {
      console.error(`\n✗ HTTPS mode falhou: ${(err as Error).message}`);
      console.error(`  Continuando só em modo HTTP.\n`);
    }
  } else {
    console.log(`\n  Configure no Claude Code:`);
    console.log(`  ANTHROPIC_BASE_URL=http://localhost:${config.port}\n`);
  }
}

main().catch((err) => {
  console.error("Erro ao iniciar ClaudeSave:", err);
  process.exit(1);
});
