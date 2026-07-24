# OpsPilot

API de incidentes com Supabase, automação n8n, observabilidade e agente de IA via MCP.

## Passo 1 — Subir Postgres e n8n

```bash
cd opspilot
docker compose up -d
```

Confere: `docker ps` deve mostrar `postgres` e `n8n` rodando.

## Passo 2 — Configurar variáveis

```bash
cp .env.example .env
```

Deixa como está para rodar local (aponta pro Postgres do docker-compose).

## Passo 3 — Instalar dependências e rodar a API

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Abre `http://localhost:8000/docs` — Swagger já vem pronto (FastAPI gera sozinho).

## Passo 4 — Criar o workflow no n8n

1. Abre `http://localhost:5678` (login: admin / admin123)
2. Cria um workflow novo
3. Nó 1: **Webhook** — método POST, path `incident-created` (tem que bater com `N8N_WEBHOOK_URL` do `.env`)
4. Nó 2: qualquer ação (Discord, Slack, ou até um nó "NoOp" pra começar)
5. Ativa o workflow (toggle no canto superior direito)

## Passo 5 — Testar o fluxo

```bash
curl -X POST http://localhost:8000/incidents \
  -H "x-api-key: troque-essa-chave" \
  -H "Content-Type: application/json" \
  -d '{"title": "API fora do ar", "severity": "high"}'
```

Se o n8n recebeu o webhook, o fluxo está fechado: API → Postgres → n8n.

## Passo 6 — Observabilidade

- Logs: aparecem no terminal do `uvicorn` já em JSON (structlog)
- Métricas: `http://localhost:8000/metrics` (formato Prometheus)
- Erros: cria conta grátis em sentry.io, cria um projeto Python/FastAPI, cola o DSN em `SENTRY_DSN` no `.env`

## Passo 7 — Migrar para Supabase real (produção)

1. Cria projeto em supabase.com
2. Vai em SQL Editor, roda o conteúdo de `supabase/schema.sql`
3. Pega a connection string em Project Settings → Database → Connection string (modo "Transaction pooler")
4. Troca `DATABASE_URL` no `.env` pela do Supabase (troca `postgresql://` por `postgresql+asyncpg://`)

## Passo 8 — Rodar o servidor MCP

```bash
cd mcp_server
pip install -r requirements.txt
export OPSPILOT_API_URL=http://localhost:8000
export OPSPILOT_API_KEY=troque-essa-chave
python server.py
```

Pra conectar no Claude Desktop, edita o `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "opspilot": {
      "command": "python",
      "args": ["/caminho/completo/para/opspilot/mcp_server/server.py"],
      "env": {
        "OPSPILOT_API_URL": "http://localhost:8000",
        "OPSPILOT_API_KEY": "troque-essa-chave"
      }
    }
  }
}
```

Reinicia o Claude Desktop e pergunta: "quais incidentes estão abertos no OpsPilot?"

## Deploy (pra colocar no ar de verdade)

- API: Railway ou Fly.io (você já usou Railway antes)
- Banco: Supabase (produção)
- n8n: Railway tem template pronto de n8n, ou n8n Cloud (free tier)
