import httpx
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models import Incident
from app.schemas import IncidentCreate, IncidentOut
from app.config import settings
from app.observability import log

router = APIRouter(prefix="/incidents", tags=["incidents"])


def check_api_key(x_api_key: str = Header(...)):
    if x_api_key != settings.api_key:
        raise HTTPException(status_code=401, detail="API key inválida")


@router.post("", response_model=IncidentOut, dependencies=[Depends(check_api_key)])
async def create_incident(payload: IncidentCreate, db: AsyncSession = Depends(get_db)):
    incident = Incident(**payload.model_dump())
    db.add(incident)
    await db.commit()
    await db.refresh(incident)

    log.info("incident_created", id=str(incident.id), severity=incident.severity)

    async with httpx.AsyncClient() as client:
        try:
            await client.post(
                settings.n8n_webhook_url,
                json={"id": str(incident.id), "title": incident.title, "severity": incident.severity},
                timeout=5,
            )
        except httpx.HTTPError as e:
            log.warning("n8n_webhook_failed", error=str(e))

    return incident


@router.get("", response_model=list[IncidentOut], dependencies=[Depends(check_api_key)])
async def list_incidents(status: str | None = None, db: AsyncSession = Depends(get_db)):
    query = select(Incident)
    if status:
        query = query.where(Incident.status == status)
    result = await db.execute(query)
    return result.scalars().all()


@router.post("/{incident_id}/resolve", response_model=IncidentOut, dependencies=[Depends(check_api_key)])
async def resolve_incident(incident_id: str, db: AsyncSession = Depends(get_db)):
    incident = await db.get(Incident, incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incidente não encontrado")
    incident.status = "resolved"
    incident.resolved_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(incident)
    log.info("incident_resolved", id=str(incident.id))
    return incident
