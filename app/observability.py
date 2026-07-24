import logging
import structlog
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from app.config import settings


def setup_logging():
    structlog.configure(
        processors=[
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.add_log_level,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
    )


def setup_sentry():
    if settings.sentry_dsn:
        sentry_sdk.init(
            dsn=settings.sentry_dsn,
            environment=settings.environment,
            integrations=[FastApiIntegration()],
            traces_sample_rate=0.2,
        )


log = structlog.get_logger()
