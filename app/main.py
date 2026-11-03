from contextlib import asynccontextmanager
from fastapi import FastAPI
from prometheus_fastapi_instrumentator import Instrumentator
from starlette.middleware.cors import CORSMiddleware
from app.config import settings
from app.observability import setup_logging, setup_sentry
from app.routers import incidents, runbooks
from app.database import engine, Base

setup_logging()
setup_sentry()


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="OpsPilot API", lifespan=lifespan)
    cors_origins = []
    for configured_origin in settings.cors_origins.split(","):
        origin = configured_origin.strip().rstrip("/")
        if origin and origin != "*":
            cors_origins.append(origin)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_methods=["GET"],
        allow_credentials=False,
    )
    app.include_router(incidents.router)
    app.include_router(runbooks.router)
    Instrumentator().instrument(app).expose(app)

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    return app


app = create_app()
