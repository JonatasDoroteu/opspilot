import os
import logging
import httpx
from mcp.server.fastmcp import FastMCP

LOG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mcp_debug.log")
logging.basicConfig(
    filename=LOG_PATH,
    level=logging.INFO,
    format="%(asctime)s %(message)s",
)

API_URL = os.environ.get("OPSPILOT_API_URL", "http://localhost:8000")
API_KEY = os.environ.get("OPSPILOT_API_KEY", "troque-essa-chave")

mcp = FastMCP("opspilot")


def _headers():
    return {"x-api-key": API_KEY}


@mcp.tool()
async def list_incidents(status: str = "") -> str:
    """Lista incidentes do OpsPilot. Filtra por status (open/resolved) se informado."""
    params = {"status": status} if status else {}
    async with httpx.AsyncClient() as client:
        r = await client.get(f"{API_URL}/incidents", params=params, headers=_headers())
        return r.text


@mcp.tool()
async def create_incident(title: str, severity: str = "medium", category: str = "other") -> str:
    """Cria um novo incidente no OpsPilot. Categorias comuns: database, deploy, network, other."""
    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{API_URL}/incidents",
            json={"title": title, "severity": severity, "category": category},
            headers=_headers(),
        )
        return r.text


@mcp.tool()
async def resolve_incident(incident_id: str) -> str:
    """Marca um incidente como resolvido."""
    async with httpx.AsyncClient() as client:
        r = await client.post(f"{API_URL}/incidents/{incident_id}/resolve", headers=_headers())
        return r.text


@mcp.tool()
async def get_runbook_for_incident(incident_id: str) -> str:
    """Dado o ID de um incidente aberto, busca a categoria dele e retorna o runbook com os passos a seguir."""
    logging.info(f"[MCP] get_runbook_for_incident chamado com incident_id={incident_id}")
    async with httpx.AsyncClient() as client:
        incidents_r = await client.get(f"{API_URL}/incidents", headers=_headers())
        if incidents_r.status_code != 200:
            return "Erro ao buscar incidentes."

        incident = next((i for i in incidents_r.json() if i["id"] == incident_id), None)
        if not incident:
            return f"Incidente {incident_id} não encontrado."

        category = incident["category"]
        logging.info(f"[MCP] categoria identificada: {category} — buscando runbook...")
        runbook_r = await client.get(f"{API_URL}/runbooks/{category}", headers=_headers())
        if runbook_r.status_code == 404:
            return f"Incidente é da categoria '{category}', mas não existe runbook cadastrado ainda."

        rb = runbook_r.json()
        logging.info(f"[MCP] runbook encontrado: {rb['title']}")
        return f"Runbook: {rb['title']}\n\n{rb['steps']}"


if __name__ == "__main__":
    mcp.run(transport="stdio")