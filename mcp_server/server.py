import os
import httpx
from mcp.server.fastmcp import FastMCP

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
async def create_incident(title: str, severity: str = "medium") -> str:
    """Cria um novo incidente no OpsPilot."""
    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{API_URL}/incidents",
            json={"title": title, "severity": severity},
            headers=_headers(),
        )
        return r.text


@mcp.tool()
async def resolve_incident(incident_id: str) -> str:
    """Marca um incidente como resolvido."""
    async with httpx.AsyncClient() as client:
        r = await client.post(f"{API_URL}/incidents/{incident_id}/resolve", headers=_headers())
        return r.text


if __name__ == "__main__":
    mcp.run(transport="stdio")
