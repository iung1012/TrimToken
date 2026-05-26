import { Router } from "express";
import { getSummary, getRecentRequests } from "./analytics";

export const dashboardRouter = Router();

dashboardRouter.get("/", (_req, res) => {
  res.send(renderDashboard());
});

dashboardRouter.get("/api/summary", (_req, res) => {
  res.json(getSummary(7));
});

dashboardRouter.get("/api/requests", (_req, res) => {
  res.json(getRecentRequests(100));
});

function renderDashboard(): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ClaudeSave — Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f1117; color: #e2e8f0; min-height: 100vh; }
    header { padding: 24px 32px; border-bottom: 1px solid #1e2535; display: flex; align-items: center; gap: 12px; }
    header h1 { font-size: 20px; font-weight: 700; color: #fff; letter-spacing: -0.02em; }
    header .tagline { color: #64748b; font-size: 13px; margin-left: auto; }
    .badge { background: #10b981; color: #fff; font-size: 11px; padding: 2px 8px; border-radius: 99px; font-weight: 600; }

    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; padding: 24px 32px 8px; }
    .card { background: #1a1f2e; border: 1px solid #2d3448; border-radius: 12px; padding: 20px; }
    .card .label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 8px; font-weight: 600; }
    .card .value { font-size: 28px; font-weight: 700; color: #fff; letter-spacing: -0.02em; }
    .card .sub { font-size: 12px; color: #64748b; margin-top: 6px; }
    .savings .value { color: #10b981; }
    .tokens .value { color: #38bdf8; }
    .hits .value { color: #818cf8; }

    .layers { padding: 8px 32px 16px; }
    .layers h2 { font-size: 13px; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 12px; }
    .layer-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
    .layer { background: #1a1f2e; border: 1px solid #2d3448; border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 4px; }
    .layer .name { font-size: 12px; color: #94a3b8; font-weight: 500; display: flex; align-items: center; gap: 6px; }
    .layer .dot { width: 8px; height: 8px; border-radius: 99px; background: #10b981; }
    .layer .dot.off { background: #475569; }
    .layer .amount { font-size: 18px; font-weight: 700; color: #fff; }
    .layer .desc { font-size: 11px; color: #64748b; }

    table { width: calc(100% - 64px); margin: 0 32px 32px; border-collapse: collapse; background: #1a1f2e; border-radius: 12px; overflow: hidden; border: 1px solid #2d3448; }
    th { text-align: left; padding: 12px 16px; font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: .05em; border-bottom: 1px solid #2d3448; font-weight: 600; }
    td { padding: 10px 16px; font-size: 12px; border-bottom: 1px solid #1e2535; font-family: ui-monospace, SFMono-Regular, monospace; }
    tr:last-child td { border-bottom: none; }
    .haiku { color: #818cf8; } .sonnet { color: #38bdf8; } .opus { color: #f59e0b; }
    .hit { color: #10b981; } .miss { color: #64748b; }
    .section-title { padding: 8px 32px 12px; font-size: 13px; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: .05em; }
    .empty { color: #475569; text-align: center; padding: 24px; }
  </style>
</head>
<body>
  <header>
    <h1>ClaudeSave</h1>
    <span class="badge">LIVE</span>
    <span class="tagline">Otimização invisível para Claude Code</span>
  </header>

  <div class="grid" id="cards">
    <div class="card"><div class="label">Carregando…</div></div>
  </div>

  <div class="layers">
    <h2>Economia por camada</h2>
    <div class="layer-grid" id="layers">
      <div class="layer"><div class="name">Carregando…</div></div>
    </div>
  </div>

  <div class="section-title">Últimas requisições</div>
  <table>
    <thead>
      <tr>
        <th>Horário</th>
        <th>Modelo original</th>
        <th>Roteado para</th>
        <th>Input tok.</th>
        <th>Output tok.</th>
        <th>Input econ.</th>
        <th>Code econ.</th>
        <th>Output econ.</th>
        <th>Cache</th>
        <th>Economia</th>
      </tr>
    </thead>
    <tbody id="rows"><tr><td colspan="10" class="empty">Sem requisições ainda — configure ANTHROPIC_BASE_URL=http://localhost:8019</td></tr></tbody>
  </table>

  <script>
    function fmtTokens(n) {
      if (!n) return '0';
      if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
      if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
      return n.toString();
    }

    function shortModel(m) {
      if (!m) return '—';
      if (m.includes('haiku')) return 'Haiku';
      if (m.includes('sonnet')) return 'Sonnet';
      if (m.includes('opus')) return 'Opus';
      return m.split('-').slice(0, 2).join('-');
    }

    function modelClass(m) {
      if (!m) return '';
      if (m.includes('haiku')) return 'haiku';
      if (m.includes('sonnet')) return 'sonnet';
      if (m.includes('opus')) return 'opus';
      return '';
    }

    async function load() {
      const [summary, requests] = await Promise.all([
        fetch('/dashboard/api/summary').then(r => r.json()),
        fetch('/dashboard/api/requests').then(r => r.json()),
      ]);

      const totalTokensSaved = (summary.total_input_tokens_saved || 0) +
                              (summary.total_code_tokens_saved || 0) +
                              (summary.total_output_tokens_saved || 0) +
                              (summary.total_cached_tokens || 0);

      document.getElementById('cards').innerHTML = \`
        <div class="card savings">
          <div class="label">Economia total (7 dias)</div>
          <div class="value">$\${(summary.total_savings || 0).toFixed(4)}</div>
          <div class="sub">de $\${(summary.total_original_cost || 0).toFixed(4)} sem ClaudeSave</div>
        </div>
        <div class="card tokens">
          <div class="label">Tokens economizados</div>
          <div class="value">\${fmtTokens(totalTokensSaved)}</div>
          <div class="sub">cota estendida</div>
        </div>
        <div class="card">
          <div class="label">Taxa média de economia</div>
          <div class="value">\${(summary.avg_savings_pct || 0).toFixed(1)}%</div>
          <div class="sub">por requisição</div>
        </div>
        <div class="card">
          <div class="label">Requisições</div>
          <div class="value">\${summary.total_requests || 0}</div>
          <div class="sub">últimos 7 dias</div>
        </div>
        <div class="card hits">
          <div class="label">Cache hits</div>
          <div class="value">\${summary.cache_hits || 0}</div>
          <div class="sub">respostas instantâneas</div>
        </div>
      \`;

      document.getElementById('layers').innerHTML = \`
        <div class="layer">
          <div class="name"><span class="dot"></span> Input Compression</div>
          <div class="amount">\${fmtTokens(summary.total_input_tokens_saved || 0)} tok</div>
          <div class="desc">RTK-style — whitespace + dedup</div>
        </div>
        <div class="layer">
          <div class="name"><span class="dot"></span> Smart Code Compression</div>
          <div class="amount">\${fmtTokens(summary.total_code_tokens_saved || 0)} tok</div>
          <div class="desc">codesight-style — collapse fn bodies</div>
        </div>
        <div class="layer">
          <div class="name"><span class="dot"></span> Output Compression</div>
          <div class="amount">\${fmtTokens(summary.total_output_tokens_saved || 0)} tok</div>
          <div class="desc">Caveman — resposta compacta</div>
        </div>
        <div class="layer">
          <div class="name"><span class="dot"></span> Prompt Cache</div>
          <div class="amount">\${fmtTokens(summary.total_cached_tokens || 0)} tok</div>
          <div class="desc">cache_control nativo (10%)</div>
        </div>
        <div class="layer">
          <div class="name"><span class="dot"></span> Response Cache</div>
          <div class="amount">\${summary.cache_hits || 0} hits</div>
          <div class="desc">respostas idênticas</div>
        </div>
        <div class="layer">
          <div class="name"><span class="dot"></span> Smart Routing</div>
          <div class="amount">\${Object.entries(summary.model_breakdown || {}).map(([m,n]) => shortModel(m)+': '+n).join(' · ') || '—'}</div>
          <div class="desc">Haiku/Sonnet/Opus auto</div>
        </div>
      \`;

      document.getElementById('rows').innerHTML = requests.length === 0
        ? '<tr><td colspan="10" class="empty">Sem requisições ainda</td></tr>'
        : requests.map(r => \`
          <tr>
            <td>\${new Date(r.timestamp).toLocaleTimeString('pt-BR')}</td>
            <td class="sonnet">\${shortModel(r.original_model)}</td>
            <td class="\${modelClass(r.routed_model)}">\${shortModel(r.routed_model)}</td>
            <td>\${fmtTokens(r.input_tokens)}</td>
            <td>\${fmtTokens(r.output_tokens)}</td>
            <td class="hit">\${r.input_tokens_saved ? '-'+fmtTokens(r.input_tokens_saved) : '—'}</td>
            <td class="hit">\${r.code_tokens_saved ? '-'+fmtTokens(r.code_tokens_saved) : '—'}</td>
            <td class="hit">\${r.output_tokens_saved_est ? '-'+fmtTokens(r.output_tokens_saved_est) : '—'}</td>
            <td class="\${r.cache_hit ? 'hit' : 'miss'}">\${r.cache_hit ? '✓ hit' : '—'}</td>
            <td class="hit">-\${(r.savings_pct || 0).toFixed(1)}%</td>
          </tr>
        \`).join('');
    }

    load();
    setInterval(load, 5000);
  </script>
</body>
</html>`;
}
