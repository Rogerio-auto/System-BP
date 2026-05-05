"""Endpoint /health — status do serviço + dependências críticas."""
from __future__ import annotations

import time
from typing import Literal

import httpx
from fastapi import APIRouter
from pydantic import BaseModel

from app.config import settings

router = APIRouter()
_started_at = time.time()


class HealthChecks(BaseModel):
    backend: Literal["ok", "down", "unknown"]


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded", "down"]
    uptime_s: int
    checks: HealthChecks


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    backend_status: Literal["ok", "down", "unknown"] = "unknown"
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            r = await client.get(f"{settings.backend_internal_url}health")
            backend_status = "ok" if r.status_code == 200 else "down"
    except Exception:
        backend_status = "down"

    overall: Literal["ok", "degraded", "down"] = (
        "ok" if backend_status == "ok" else "degraded"
    )
    return HealthResponse(
        status=overall,
        uptime_s=int(time.time() - _started_at),
        checks=HealthChecks(backend=backend_status),
    )
