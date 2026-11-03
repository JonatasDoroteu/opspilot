import uuid
from datetime import datetime
from typing import Literal
from pydantic import BaseModel

IncidentStatus = Literal["open", "resolved"]


class IncidentCreate(BaseModel):
    title: str
    severity: str = "medium"
    status: IncidentStatus = "open"
    source: str = "manual"
    category: str = "other"


class IncidentOut(BaseModel):
    id: uuid.UUID
    title: str
    severity: str
    status: IncidentStatus
    source: str
    category: str
    created_at: datetime
    resolved_at: datetime | None

    class Config:
        from_attributes = True


class RunbookOut(BaseModel):
    id: uuid.UUID
    category: str
    title: str
    steps: str
    severity: str
    created_at: datetime

    class Config:
        from_attributes = True