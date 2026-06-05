# TrimToken

> Proxy local que **reduz o consumo de tokens** do Claude Code / API Anthropic e mostra a economia **real, medida pelo tokenizer oficial** — sem inventar número e sem rebaixar a qualidade da Claude.

```
┌──────────────┐     ┌─────────────────┐     ┌──────────────────┐
│ Claude Code  │ ──▶ │ TrimToken       │ ──▶ │ api.anthropic.com│
└──────────────┘     │ localhost:8019  │     └──────────────────┘
                     └─────────────────┘
                            │
                            ▼
                  Dashboard com economia
                  REAL em tempo real
```

## Princípios

1. **Pass-through fiel.** O proxy repassa sua requisição sem alterar nada que mude a *resposta* da Claude. Cabeçalhos, tools, streaming — tudo intacto.
2. **Números reais, nunca falsos.** A economia é medida com o `count_tokens` (tokenizer oficial da Anthropic) e com o campo `usage` real de cada resposta. Nada de fatores inventados.
3. **Qualidade primeiro.** A última mensagem nunca é comprimida; o roteamento de modelo é desligado por padrão e, quando ligado, só age fora de sessões agênticas.

## Como ele reduz tokens (de verdade)

| Camada | O que faz | Economia real | Risco de qualidade |
|--------|-----------|---------------|--------------------|
| **Input Compression** | Remove whitespace, deduplica linhas e trunca saídas longas — inclusive em `tool_result` (leituras/logs) do histórico | Alta em outputs repetitivos | Baixo (só histórico) |
| **Code Compression** | Colapsa corpos de função no histórico, preservando assinaturas/imports | Alta em código relido | Médio (configurável) |
| **Prompt Cache** | Injeta `cache_control` **só** quando o cliente não usa cache | 90% nos repetidos | Nenhum (lossless) |
| **Response Cache** | Resposta idêntica servida do cache (suporta streaming) | 100% no repetido | Nenhum (lossless) |
| **Output Compression** | Pede respostas concisas via system prompt | Reduz output | Baixo (estilo) |
| **Smart Routing** *(off)* | Tarefas triviais → modelo mais barato | Alta | Troca o modelo → desligado por padrão |

> **Teto realista:** ~80% acontece em inputs **grandes e repetitivos** (logs, arquivos relidos, contexto longo). Em uso leve a economia é menor — e o dashboard mostra **exatamente** quanto foi, medido. Em testes locais, tráfego estilo Claude Code teve ~54% e payloads code-heavy ~70% de redução de input.

> **Nota para Claude Code:** o Claude Code já faz prompt-cache nativo. Comprimir o histórico pode reduzir a taxa desse cache nativo — o dashboard mostra o **efeito líquido real**, então é fácil ajustar `code_compress`/`input_compress` se não compensar no seu caso.

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
npm start
```

## Uso

1. Inicie o proxy: `trimtoken` (ou `npm start`)
2. Aponte o Claude Code para ele:
   - **PowerShell:** `$env:ANTHROPIC_BASE_URL='http://localhost:8019'`
   - **bash:** `export ANTHROPIC_BASE_URL=http://localhost:8019`
3. Use o Claude Code normalmente. Veja a economia em `http://localhost:8019/dashboard`.

## Dashboard (100% real)

- **Gasto real** — o que você efetivamente pagou (do `usage` da API)
- **Economia total** — `baseline (sem otimização) − custo real`, medido
- **Tokens poupados** — `count_tokens(original) − tokens enviados`
- **% economizado** — real, com selo de quantas requisições foram *medidas* via count_tokens

## Configuração

Edite `config.yaml` (ou `~/.trimtoken/config.yaml`). Todas as camadas são liga/desliga e têm níveis `off | light | medium | aggressive`. Veja os comentários no [config.yaml](config.yaml).

```yaml
measure_savings: true        # mede economia real via count_tokens (grátis)
input_compress:  { enabled: true, level: medium }
code_compress:   { enabled: true, level: medium }
prompt_cache:    { enabled: true, min_tokens_to_cache: 1024 }
response_cache:  { enabled: true, ttl_seconds: 3600 }
output_compress: { enabled: true, level: medium }
routing:         { enabled: false, safe_only: true }
```

## Privacidade

- 100% local — roda na sua máquina
- Não loga prompts nem respostas — só metadados (tokens, custo, latência, modelo)
- Dados em `~/.trimtoken/analytics.json`

## Modo HTTPS (Claude Desktop App)

Opcional e avançado: intercepta `api.anthropic.com` na máquina inteira (modifica o hosts file e instala um Root CA local). Requer admin. Use `install-https.ps1` para configurar e `uninstall-https.ps1` para reverter.

## License

MIT
