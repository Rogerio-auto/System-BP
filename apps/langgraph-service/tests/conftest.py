"""Fixtures compartilhadas para a suite de testes do LangGraph service."""
from __future__ import annotations

import os

# ---------------------------------------------------------------------------
# Variáveis de ambiente obrigatórias para carregar Settings antes de qualquer
# import de app.config. Devem ser setadas ANTES do import de settings.
# Valores são apenas para testes — não são credenciais reais.
# ---------------------------------------------------------------------------
os.environ.setdefault("BACKEND_INTERNAL_URL", "http://backend-test:3000")
os.environ.setdefault("LANGGRAPH_INTERNAL_TOKEN", "test-internal-token-for-tests")

from collections.abc import Iterator
from unittest.mock import AsyncMock, patch

import pytest
import respx

from app.config import settings
from app.prompts.loader import ActivePrompt

# ---------------------------------------------------------------------------
# Prompt sintético padrão para testes (F9-S09)
#
# Fornece um ActivePrompt válido com body não-vazio para todos os testes que
# invocam os nós classify_intent, qualify_credit_interest ou generate_simulation.
# Evita que esses nós tentem chamar o backend real via InternalApiClient.
#
# Testes que precisam de comportamento específico do loader (ex: 404, timeout)
# devem sobrescrever os patches internamente via unittest.mock.patch context
# manager — os patches internos ao corpo do teste têm precedência sobre este
# fixture autouse (comportamento padrão do Python mock).
# ---------------------------------------------------------------------------

_DEFAULT_CLASSIFY_PROMPT = ActivePrompt(
    key="pre_attendance_classify",
    version=1,
    body=(
        "Classifique a intenção do cliente. "
        "Responda apenas com: quer_credito, falar_atendente ou nao_entendi."
    ),
    content_hash="test-hash-classify",
    model_recommended=None,
    temperature=None,
    max_tokens=32,
    top_p=None,
    prompt_version="pre_attendance_classify@v1",
)

_DEFAULT_QUALIFY_PROMPT = ActivePrompt(
    key="pre_attendance_qualify",
    version=1,
    body="Extraia valor e prazo do crédito solicitado pelo cliente.",
    content_hash="test-hash-qualify",
    model_recommended=None,
    temperature=None,
    max_tokens=256,
    top_p=None,
    prompt_version="pre_attendance_qualify@v1",
)

_DEFAULT_SIMULATION_PROMPT = ActivePrompt(
    key="simulation",
    version=1,
    body="Componha uma resposta clara com os dados da simulação de crédito.",
    content_hash="test-hash-simulation",
    model_recommended=None,
    temperature=None,
    max_tokens=512,
    top_p=None,
    prompt_version="simulation@v1",
)

_LOAD_PROMPT_TARGETS: dict[str, ActivePrompt] = {
    # Nó classify_intent
    (
        "app.graphs.whatsapp_pre_attendance"
        ".nodes.classify_intent.load_active_prompt"
    ): _DEFAULT_CLASSIFY_PROMPT,
    # Nó qualify_credit_interest
    (
        "app.graphs.whatsapp_pre_attendance"
        ".nodes.qualify_credit_interest.load_active_prompt"
    ): _DEFAULT_QUALIFY_PROMPT,
    # Nó generate_simulation
    (
        "app.graphs.whatsapp_pre_attendance"
        ".nodes.generate_simulation.load_active_prompt"
    ): _DEFAULT_SIMULATION_PROMPT,
}


@pytest.fixture(autouse=True)
def _mock_load_active_prompt() -> Iterator[None]:
    """Garante que nenhum nó tente chamar o backend real para carregar prompts.

    Aplica patches automáticos nos 3 nós que usam load_active_prompt (F9-S09).
    Testes que precisam de comportamento específico (ex: PromptNotFoundError)
    sobrescrevem o patch internamente — context managers de unittest.mock.patch
    dentro do corpo do teste têm precedência sobre este autouse fixture.
    """
    patchers = [
        patch(target, new=AsyncMock(return_value=default_prompt))
        for target, default_prompt in _LOAD_PROMPT_TARGETS.items()
    ]
    for p in patchers:
        p.start()
    yield
    for p in patchers:
        p.stop()


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
