import { Router } from "express";
import { Config } from "./types";
import { getSummary, getRecentRequests } from "./analytics";

export function createDashboardRouter(config: Config): Router {
  const router = Router();
  const base = config.dashboard.path;

  router.get("/", (_req, res) => res.send(renderDashboard(base)));
  router.get("/api/summary", (req, res) => {
    const days = Math.max(1, Math.min(90, Number(req.query.days) || 7));
    res.json(getSummary(days));
  });
  router.get("/api/requests", (_req, res) => res.json(getRecentRequests(100)));

  return router;
}

function renderDashboard(base: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TrimToken — Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f1117; color: #e2e8f0; min-height: 100vh; }
    header { padding: 24px 32px; border-bottom: 1px solid #1e2535; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    header h1 { font-size: 20px; font-weight: 700; color: #fff; letter-spacing: -0.02em; }
    header .tagline { color: #64748b; font-size: 13px; margin-left: auto; }
    .badge { background: #10b981; color: #fff; font-size: 11px; padding: 2px 8px; border-radius: 99px; font-weight: 600; }
    .note { background: #11203a; color: #93c5fd; font-size: 12px; padding: 8px 32px; border-bottom: 1px solid #1e2535; }
    .note b { color: #bfdbfe; }

    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; padding: 24px 32px 8px; }
    .card { background: #1a1f2e; border: 1px solid #2d3448; border-radius: 12px; padding: 20px; }
    .card .label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 8px; font-weight: 600; }
    .card .value { font-size: 28px; font-weight: 700; color: #fff; letter-spacing: -0.02em; }
    .card .sub { font-size: 12px; color: #64748b; margin-top: 6px; }
    .savings .value { color: #10b981; }
    .spent .value { color: #f87171; }
    .tokens .value { color: #38bdf8; }
    .hits .value { color: #818cf8; }

    .layers { padding: 8px 32px 16px; }
    .layers h2 { font-size: 13px; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 12px; }
    .layer-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
    .layer { background: #1a1f2e; border: 1px solid #2d3448; border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 4px; }
    .layer .name { font-size: 12px; color: #94a3b8; font-weight: 500; }
    .layer .amount { font-size: 18px; font-weight: 700; color: #fff; }
    .layer .desc { font-size: 11px; color: #64748b; }

    table { width: calc(100% - 64px); margin: 0 32px 32px; border-collapse: collapse; background: #1a1f2e; border-radius: 12px; overflow: hidden; border: 1px solid #2d3448; }
    th { text-align: left; padding: 12px 16px; font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: .05em; border-bottom: 1px solid #2d3448; font-weight: 600; }
    td { padding: 10px 16px; font-size: 12px; border-bottom: 1px solid #1e2535; font-family: ui-monospace, SFMono-Regular, monospace; }
    tr:last-child td { border-bottom: none; }
    .haiku { color: #818cf8; } .sonnet { color: #38bdf8; } .opus { color: #f59e0b; }
    .hit { color: #10b981; } .miss { color: #64748b; }
    .est { color: #f59e0b; font-size: 10px; }
    .section-title { padding: 8px 32px 12px; font-size: 13px; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: .05em; }
    .empty { color: #475569; text-align: center; padding: 24px; }
  </style>
</head>
<body>
  <header>
    <h1>TrimToken</h1>
    <span class="badge">LIVE</span>
    <span class="tagline">Economia de tokens — números reais da API</span>
  </header>
  <div class="note" id="note">Carregando…</div>

  <div class="grid" id="cards">
    <div class="card"><div class="label">Carregando…</div></div>
  </div>

  <div class="layers">
    <h2>De onde vem a economia (medido)</h2>
    <div class="layer-grid" id="layers"></div>
  </div>

  <div class="section-title">Últimas requisições</div>
  <table>
    <thead>
      <tr>
        <th>Horário</th>
        <th>Modelo</th>
        <th>Input real</th>
        <th>Cache read</th>
        <th>Output</th>
        <th>Tokens economizados</th>
        <th>Custo real</th>
        <th>Você teria pago</th>
        <th>Economia</th>
      </tr>
    </thead>
    <tbody id="rows"><tr><td colspan="9" class="empty">Sem requisições ainda — configure ANTHROPIC_BASE_URL=http://localhost:8019</td></tr></tbody>
  </table>

  <script>
    const BASE = ${JSON.stringify(base)};
    function fmtTok(n) {
      if (!n) return '0';
      if (Math.abs(n) >= 1e6) return (n/1e6).toFixed(2)+'M';
      if (Math.abs(n) >= 1e3) return (n/1e3).toFixed(1)+'k';
      return Math.round(n).toString();
    }
    function usd(n) { return '$' + (n || 0).toFixed(4); }
    function shortModel(m){ if(!m) return '—'; if(m.includes('haiku'))return'Haiku'; if(m.includes('sonnet'))return'Sonnet'; if(m.includes('opus'))return'Opus'; return m; }
    function modelClass(m){ if(!m)return''; if(m.includes('haiku'))return'haiku'; if(m.includes('sonnet'))return'sonnet'; if(m.includes('opus'))return'opus'; return ''; }

    async function load() {
      const [s, requests] = await Promise.all([
        fetch(BASE+'/api/summary').then(r=>r.json()),
        fetch(BASE+'/api/requests').then(r=>r.json()),
      ]);

      document.getElementById('note').innerHTML =
        '🔒 Todos os números vêm do campo <b>usage</b> real da API Anthropic. ' +
        'Economia <b>medida</b> em ' + (s.measured_pct||0).toFixed(0) + '% das requisições via count_tokens (tokenizer oficial). ' +
        'Nada estimado às cegas.';

      document.getElementById('cards').innerHTML = \`
        <div class="card spent">
          <div class="label">Gasto real (7 dias)</div>
          <div class="value">\${usd(s.real_cost_usd)}</div>
          <div class="sub">o que você efetivamente pagou</div>
        </div>
        <div class="card savings">
          <div class="label">Economia total (real)</div>
          <div class="value">\${usd(s.total_savings_usd)}</div>
          <div class="sub">vs. \${usd(s.baseline_cost_usd)} sem otimização</div>
        </div>
        <div class="card">
          <div class="label">% economizado</div>
          <div class="value">\${(s.savings_pct||0).toFixed(1)}%</div>
          <div class="sub">medido, não estimado</div>
        </div>
        <div class="card tokens">
          <div class="label">Tokens de input poupados</div>
          <div class="value">\${fmtTok(s.input_tokens_saved)}</div>
          <div class="sub">de \${fmtTok(s.original_input_tokens)} originais</div>
        </div>
        <div class="card hits">
          <div class="label">Requisições</div>
          <div class="value">\${s.total_requests||0}</div>
          <div class="sub">\${s.response_cache_hits||0} servidas do cache</div>
        </div>
      \`;

      document.getElementById('layers').innerHTML = \`
        <div class="layer">
          <div class="name">Compressão de input/código</div>
          <div class="amount">\${usd(s.compression_savings_usd)}</div>
          <div class="desc">tokens removidos do request</div>
        </div>
        <div class="layer">
          <div class="name">Prompt cache</div>
          <div class="amount">\${usd(s.cache_savings_usd)}</div>
          <div class="desc">leitura a 10% (real)</div>
        </div>
        <div class="layer">
          <div class="name">Response cache</div>
          <div class="amount">\${usd(s.response_cache_savings_usd)}</div>
          <div class="desc">\${s.response_cache_hits||0} respostas idênticas</div>
        </div>
        <div class="layer">
          <div class="name">Tokens reais processados</div>
          <div class="amount">\${fmtTok(s.input_tokens + s.output_tokens)}</div>
          <div class="desc">in \${fmtTok(s.input_tokens)} · out \${fmtTok(s.output_tokens)} · cache \${fmtTok(s.cache_read_tokens)}</div>
        </div>
        <div class="layer">
          <div class="name">Modelos</div>
          <div class="amount" style="font-size:13px">\${Object.entries(s.model_breakdown||{}).map(([m,v])=>shortModel(m)+': '+v.requests).join(' · ')||'—'}</div>
          <div class="desc">requisições por modelo</div>
        </div>
      \`;

      document.getElementById('rows').innerHTML = requests.length === 0
        ? '<tr><td colspan="9" class="empty">Sem requisições ainda</td></tr>'
        : requests.map(r => {
          const saved = (r.total_savings_usd||0) + (r.response_cache_savings_usd||0);
          const tokSaved = Math.max(0, (r.original_input_tokens||0) - (r.input_tokens + r.cache_read_tokens + r.cache_creation_tokens));
          return \`
          <tr>
            <td>\${new Date(r.timestamp).toLocaleTimeString('pt-BR')}</td>
            <td class="\${modelClass(r.model)}">\${shortModel(r.model)}\${r.response_cache_hit?' <span class="hit">⚡cache</span>':''}</td>
            <td>\${fmtTok(r.input_tokens)}</td>
            <td>\${r.cache_read_tokens?fmtTok(r.cache_read_tokens):'—'}</td>
            <td>\${fmtTok(r.output_tokens)}</td>
            <td class="hit">\${tokSaved?'-'+fmtTok(tokSaved):'—'} \${r.measured?'':'<span class="est">est</span>'}</td>
            <td>\${usd(r.real_cost_usd)}</td>
            <td class="miss">\${usd(r.baseline_cost_usd)}</td>
            <td class="hit">\${usd(saved)}</td>
          </tr>\`;
        }).join('');
    }

    load();
    setInterval(load, 5000);
  </script>
</body>
</html>`;
}
