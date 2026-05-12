"""Fixtures compartilhadas para a suite de testes do LangGraph service."""
from __future__ import annotations

import pytest
import respx

from app.config import settings


@pytest.fixture()
def backend_base_url() -> str:
    """URL base do backend sem trailing slash — usada para montar rotas no respx."""
    raw = str(settings.backend_internal_url)
    return raw.rstrip("/")


@pytest.fixture()
def mock_backend(backend_base_url: str) -> respx.MockRouter:
    """Router respx pré-configurado apontando para o backend interno.

    Uso:
        async def test_foo(mock_backend):
            mock_backend.get("/internal/foo").mock(return_value=httpx.Response(200, json={}))
            ...
    """
    with respx.mock(base_url=backend_base_url, assert_all_called=False) as router:
        yield router


@pytest.fixture(autouse=True)
def _clear_structlog_context() -> None:  # type: ignore[return]
    """Garante que o contextvars do structlog esteja limpo entre testes."""
    import structlog.contextvars

    structlog.contextvars.clear_contextvars()
    yield
    structlog.contextvars.clear_contextvars()
