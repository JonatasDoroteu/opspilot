from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models import Runbook
from app.schemas import RunbookOut
from app.routers.incidents import check_api_key

router = APIRouter(prefix="/runbooks", tags=["runbooks"])


@router.get("/{category}", response_model=RunbookOut, dependencies=[Depends(check_api_key)])
async def get_runbook_by_category(category: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Runbook).where(Runbook.category == category))
    runbook = result.scalar_one_or_none()
    if not runbook:
        raise HTTPException(status_code=404, detail=f"Nenhum runbook para categoria '{category}'")
    return runbook