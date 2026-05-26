# ClaudeSave

> **Otimização invisível para Claude Code.** Mesma experiência, até **80% menos tokens**.

ClaudeSave é um proxy local que se instala entre o Claude Code (ou qualquer cliente da API Anthropic) e os servidores da Anthropic. Aplica 6 camadas de otimização automática para reduzir custos (plano API) ou estender sua cota (plano Pro/Max).

```
┌──────────────┐     ┌─────────────────┐     ┌──────────────────┐
│ Claude Code  │ ──> │ ClaudeSave      │ ──> │ api.anthropic.com│
└──────────────┘     │ localhost:8019  │     └──────────────────┘
                     └─────────────────┘
                            │
                            ▼
                     Dashboard com
                     economia em tempo real
```

---

## Funciona com plano Pro/Max?

**Sim — dois modos disponíveis:**

| Modo | Funciona com | Setup |
|------|-------------|-------|
| **HTTP local** (padrão) | Claude Code via npm + API key OU `/login` | Set `ANTHROPIC_BASE_URL=http://localhost:8019` |
| **HTTPS interception** | Claude Desktop App + Pro/Max | `install-https.ps1` (admin) |

### Economia em dois eixos

| Plano | O que economiza |
|-------|----------------|
| **API key (pay-per-token)** | Dinheiro real ($) — 40-80% de redução nos gastos |
| **Pro / Max (assinatura)** | Cota semanal — faça 2-5x mais antes do rate limit |

### Como o HTTPS Interception funciona (modo Desktop App)

Quando você ativa esse modo (com `install-https.ps1` como admin):

1. **Hosts file** redireciona `api.anthropic.com` → `127.0.0.1`
2. **Root CA local** é instalada no trust store do Windows
3. **ClaudeSave** escuta em port 443 com cert assinado pela CA local
4. O **Claude Desktop App** conecta em "api.anthropic.com" (que agora é o proxy)
5. ClaudeSave **decifra**, aplica as 7 camadas, **re-cifra** e encaminha pra Anthropic real

**Importante:** afeta TODOS os apps que falam com `api.anthropic.com` na máquina.
Para reverter: `uninstall-https.ps1`.

---

## Instalação

### Windows
```powershell
.\install.ps1
```

### macOS / Linux
```bash
./install.sh
```

### Manual
```bash
npm install
npm run build
node dist/index.js
```

---

## Uso

1. **Inicie o proxy:**
   ```bash
   claudesave
   ```

2. **Aponte o Claude Code para o proxy:**

   **Windows (PowerShell):**
   ```powershell
   $env:ANTHROPIC_BASE_URL='http://localhost:8019'
   ```

   **macOS / Linux:**
   ```bash
   export ANTHROPIC_BASE_URL=http://localhost:8019
   ```

3. **Use o Claude Code normalmente.** Veja a economia em tempo real:
   ```
   http://localhost:8019/dashboard
   ```

---

## As 7 camadas de otimização

| # | Camada | O que faz | Economia | Funciona em |
|---|--------|-----------|----------|-------------|
| 1 | **Response Cache** | Pergunta idêntica = resposta do cache local | até 100% | qualquer plano |
| 2 | **Input Compression** (RTK) | Comprime whitespace, dedup, trunca logs | 30-70% input | qualquer plano |
| 3 | **Smart Code Compression** (codesight) | Colapsa function bodies em assinaturas | 30-90% em código | qualquer plano |
| 4 | **Smart Routing** | Tarefas simples → Haiku, complexas → Opus | 40-75% | API + Pro/Max |
| 5 | **Output Compression** (Caveman) | Instrui modelo a responder compacto | 40-65% output | qualquer plano |
| 6 | **Prompt Cache** (cache_control) | `cache_control` injection automática | 90% nos repetidos | API key |
| 7 | **Session Memory** | Reduz reenvio de contexto | 20-40% | qualquer plano |

**Economia composta empilhada: 15-95% dependendo do workload.**

### Como funciona Smart Code Compression

Quando o Claude Code lê um arquivo (`cat`, ferramenta Read, ou `@file.ts`),
o conteúdo bruto vai pro contexto. Em arquivos grandes, isso pode ser 80%+
de tokens só com implementação detalhada que o LLM nem precisa.

Esta camada (inspirada em [codesight](https://github.com/Houseofmvps/codesight))
substitui:

```typescript
function authenticate(user: User, password: string): Promise<Token> {
  if (!user || !password) throw new Error("Missing credentials");
  const hash = await bcrypt.hash(password, 10);
  const stored = await db.users.findOne({ email: user.email });
  // ... 25 linhas ...
  return jwt.sign({ id: stored.id }, process.env.JWT_SECRET);
}
```

Por:

```typescript
function authenticate(user: User, password: string): Promise<Token> { /* 28 lines */ }
```

Suporta: **TypeScript, JavaScript, Python, Go, Java, Rust**. Preserva imports,
types, exports, e funções curtas.

---

## Configuração

Edite `~/.claudesave/config.yaml` para customizar cada camada:

```yaml
output_compress:
  enabled: true
  level: "medium"     # off | light | medium | aggressive

input_compress:
  enabled: true
  level: "medium"
  preserve_last_message: true

code_compress:
  enabled: true
  level: "medium"     # light (>30 lines) | medium (>15) | aggressive (>8)
  preserve_last_message: true

routing:
  enabled: true
  models:
    simple: "claude-haiku-3-5-20241022"
    standard: "claude-sonnet-4-5"
    complex: "claude-opus-4-5"

response_cache:
  enabled: true
  ttl_seconds: 3600
  redis_url: ""   # opcional, fallback em memória
```

Veja [config.yaml](config.yaml) para todas as opções.

---

## Privacidade

- 🔒 **100% local** — proxy roda na sua máquina
- 🚫 **Não logamos prompts ou respostas** — só metadados (tokens, latência, modelo)
- 📊 **Dashboard local** em `localhost:8019/dashboard`
- 🗄️ **Dados em `~/.claudesave/analytics.json`** — você controla

---

## Arquitetura

```
src/
├── index.ts              # Entry point
├── proxy.ts              # HTTP proxy + pipeline de otimização
├── router.ts             # Smart routing (classificador de complexidade)
├── inputCompress.ts      # RTK-style input compression
├── codeCompress.ts       # Smart code compression (codesight-style)
├── outputCompress.ts     # Caveman output compression
├── promptCache.ts        # cache_control injection
├── cache.ts              # Response cache (memória / Redis)
├── session.ts            # Session memory
├── analytics.ts          # Tracking de economia
├── dashboard.ts          # Dashboard web
├── config.ts             # YAML loader
└── types.ts              # Tipos compartilhados
```

---

## Desenvolvimento

```bash
npm install
npm run dev        # ts-node, hot reload
npm run build      # compila TS para dist/
npm start          # roda o build
```

---

## Por que existe?

O Claude Code é incrível, mas tokens custam caro — seja em $$ (API) ou em rate limit (Pro/Max).
ClaudeSave aplica otimizações que a Anthropic já documenta na API + truques de compressão
para que você obtenha o máximo do seu plano sem mudar nada no seu workflow.

---

## License

MIT
