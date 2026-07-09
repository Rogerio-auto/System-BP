"""Bootstrap FastAPI do servico LangGraph.

Mantem este arquivo enxuto. Endpoints de dominio vao em `app/api/`,
grafos em `app/graphs/` e tools em `app/tools/`.
"""
from __future__ import annotations

import logging

import structlog
from fastapi import FastAPI

from app.api.graph_viz import router as graph_viz_router
from app.api.health import router as health_router
from app.api.internal_assistant import router as internal_assistant_router
from app.api.playground import router as playground_router
from app.api.process import router as process_router
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
    app.include_router(process_router)
    app.include_router(internal_assistant_router)
    app.include_router(playground_router)
    # Dev-only: visualizador do grafo em /graph (sem auth -- localhost only).
    if settings.environment != "production":
        app.include_router(graph_viz_router)
    return app


app = create_app()
