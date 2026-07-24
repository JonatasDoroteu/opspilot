from contextlib import asynccontextmanager
from fastapi import FastAPI
from prometheus_fastapi_instrumentator import Instrumentator
from app.observability import setup_logging, setup_sentry
from app.routers import incidents
from app.database import engine, Base

setup_logging()
setup_sentry()


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield


app = FastAPI(title="OpsPilot API", lifespan=lifespan)

app.include_router(incidents.router)
Instrumentator().instrument(app).expose(app)


@app.get("/health")
async def health():
    return {"status": "ok"}
