# OpsPilot

API de incidentes com Supabase, automação n8n, observabilidade e agente de IA via MCP. O diferencial: pergunte em linguagem natural pro Claude "o que fazer com esse incidente de banco travado?" e o agente MCP busca automaticamente o runbook certo, pela categoria do incidente.

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
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Abre http://localhost:8000/docs — Swagger já vem pronto (FastAPI gera sozinho).

> Rodando em outra porta (ex.: `--port 8001`)? Lembra de ajustar `OPSPILOT_API_URL` no Passo 8 e no `claude_desktop_config.json`.

## Passo 4 — Criar o workflow no n8n

1. Abre http://localhost:5678 (login: `admin` / `admin123`)
2. Cria um workflow novo
3. Nó 1: **Webhook** — método `POST`, path `incident-created` (tem que bater com `N8N_WEBHOOK_URL` do `.env`)
4. Nó 2: qualquer ação (Discord, Slack, ou até um nó "NoOp" pra começar)
5. Ativa o workflow (toggle no canto superior direito)

## Passo 5 — Testar o fluxo

```bash
curl -X POST http://localhost:8000/incidents \
  -H "x-api-key: troque-essa-chave" \
  -H "Content-Type: application/json" \
  -d '{"title": "API fora do ar", "severity": "high", "category": "network"}'
```

Se o n8n recebeu o webhook, o fluxo está fechado: API → Postgres → n8n.

Windows/PowerShell, use `Invoke-RestMethod` em vez de `curl`:

```powershell
Invoke-RestMethod -Uri "http://localhost:8000/incidents" -Method Post -Headers @{"x-api-key"="troque-essa-chave"} -ContentType "application/json" -Body '{"title": "API fora do ar", "severity": "high", "category": "network"}'
```

## Passo 6 — Observabilidade

- **Logs:** aparecem no terminal do uvicorn já em JSON (structlog)
- **Métricas:** http://localhost:8000/metrics (formato Prometheus)
- **Erros:** cria conta grátis em sentry.io, cria um projeto Python/FastAPI, cola o DSN em `SENTRY_DSN` no `.env`

## Passo 7 — Migrar para Supabase real (produção)

1. Cria projeto em supabase.com
2. Vai em **SQL Editor**, roda o conteúdo de `supabase/schema.sql` (schema completo, incluindo `incidents.category` e a tabela `runbooks` já populada)
3. Pega a connection string em **Project Settings → Database → Connection string** (modo "Transaction pooler")
4. Troca `DATABASE_URL` no `.env` pela do Supabase (troca `postgresql://` por `postgresql+asyncpg://`)

> ⚠️ `Base.metadata.create_all` (rodado no startup da API) cria tabelas novas, mas não adiciona colunas em tabelas já existentes. Se você alterar o schema depois de já ter rodado o projeto uma vez, rode a migração manualmente via SQL Editor do Supabase (ou psql local).

## Categorias e runbooks

Cada incidente tem uma `category` (`database`, `deploy`, `network` ou `other`). A tabela `runbooks` guarda um playbook de passos por categoria — é isso que o agente MCP consulta.

`GET /runbooks/{category}` — retorna o runbook daquela categoria (404 se não existir). Categorias sem runbook cadastrado caem em "sem runbook para essa categoria" quando o agente perguntar.

| Categoria  | Runbook seed no `schema.sql`? |
|------------|:------------------------------:|
| `database` | ✅ |
| `deploy`   | ✅ |
| `network`  | ✅ |
| `other`    | ❌ (adicionar manualmente) |

Pra adicionar um novo runbook, insere direto na tabela `runbooks` (colunas: `category`, `title`, `steps`).

## Passo 8 — Rodar o servidor MCP

```bash
export OPSPILOT_API_URL=http://localhost:8000
export OPSPILOT_API_KEY=troque-essa-chave
python mcp_server/server.py
```

> **Importante:** o `server.py` usa a API `FastMCP` da biblioteca `mcp` versão 1.x. A versão 2.x renomeou essa API (`FastMCP` → `MCPServer`) e quebra o código atual. Se der `ModuleNotFoundError: No module named 'mcp.server.fastmcp'`, fixa a versão:
>
> ```bash
> pip install "mcp[cli]<2"
> ```
>
> (o `requirements.txt` já vem com essa versão fixada — só é um problema se você instalar o pacote `mcp` manualmente, fora do `requirements.txt`.)

### Ferramentas disponíveis pro agente

| Ferramenta | O que faz |
|---|---|
| `list_incidents(status?)` | Lista incidentes, opcionalmente filtrando por status |
| `create_incident(title, severity?, category?)` | Cria um incidente |
| `resolve_incident(incident_id)` | Marca como resolvido |
| `get_runbook_for_incident(incident_id)` | Busca a categoria do incidente e retorna o runbook correspondente |

## Conectar no Claude Desktop

Edita (ou cria) o arquivo de config do Claude Desktop:

- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

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

> No Windows, use o python do seu venv (não o global) em `command`, algo como: `C:\caminho\para\opspilot\venv\Scripts\python.exe`

Reinicia o Claude Desktop por completo (confere se não ficou processo residente na bandeja do sistema) e pergunta:

> tem um incidente de banco travado, id — me diz o que fazer

O agente busca a categoria do incidente e devolve o runbook certo automaticamente.

## Deploy (pra colocar no ar de verdade)

- **API:** Railway ou Fly.io
- **Banco:** Supabase (produção)
- **n8n:** Railway tem template pronto de n8n, ou n8n Cloud (free tier)