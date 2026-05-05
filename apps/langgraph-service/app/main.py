"""Bootstrap FastAPI do serviço LangGraph.

Mantém este arquivo enxuto. Endpoints de domínio vão em `app/api/`,
grafos em `app/graphs/` e tools em `app/tools/`.
"""
from __future__ import annotations

import logging

import structlog
from fastapi import FastAPI

from app.api.health import router as health_router
from app.config import settings


def configure_logging() -> None:
    logging.basicConfig(level=settings.log_level.upper(), format="%(message)s")
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, settings.log_level.upper())
        ),
    )


def create_app() -> FastAPI:
    configure_logging()
    app = FastAPI(
        title="Elemento LangGraph Service",
        version="0.0.0",
        docs_url="/docs" if settings.environment != "production" else None,
        redoc_url=None,
        openapi_url="/openapi.json" if settings.environment != "production" else None,
    )
    app.include_router(health_router)
    return app


app = create_app()
