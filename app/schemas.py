import uuid
from datetime import datetime
from pydantic import BaseModel


class IncidentCreate(BaseModel):
    title: str
    severity: str = "medium"
    source: str = "manual"
    category: str = "other"


class IncidentOut(BaseModel):
    id: uuid.UUID
    title: str
    severity: str
    status: str
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
    created_at: datetime

    class Config:
        from_attributes = True