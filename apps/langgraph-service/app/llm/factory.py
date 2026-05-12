"""Factory do LLM Gateway — entrada pública para nós LangGraph.

Uso canônico em um nó:
    from app.llm.factory import for_role, get_gateway

    async def node_classify_intent(state: ConversationState) -> ConversationState:
        gateway = get_gateway()
        response = await gateway.complete(
            model=for_role("classifier"),
            messages=[...],
            metadata={"node": "classify_intent", "lead_id": state.lead_id},
        )
        ...

``get_gateway()`` é leve (não abre conexões — apenas constrói o objeto).
Pode ser chamado a cada invocação de nó sem custo relevante.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Literal

import structlog

from app.config import settings
from app.llm.gateway import LLMGateway

log: structlog.stdlib.BoundLogger = structlog.get_logger(__name__)

# Roles lógicas disponíveis
Role = Literal["classifier", "reasoner", "fallback"]


def for_role(role: Role) -> str:
    """Retorna o ``model_id`` configurado para a role lógica informada.

    Os valores vêm das variáveis de ambiente:
        - ``LLM_MODEL_CLASSIFIER`` → default ``anthropic/claude-3.5-haiku``
        - ``LLM_MODEL_REASONER``   → default ``anthropic/claude-sonnet-4``
        - ``LLM_MODEL_FALLBACK``   → default ``openai/gpt-4o-mini``

    Args:
        role: Um de ``"classifier"``, ``"reasoner"``, ``"fallback"``.

    Returns:
        String com o model id a ser passado em ``gateway.complete(model=...)``.
    """
    mapping: dict[Role, str] = {
        "classifier": settings.model_classifier,
        "reasoner": settings.model_reasoner,
        "fallback": settings.model_fallback,
    }
    return mapping[role]


@lru_cache(maxsize=1)
def _build_openrouter() -> LLMGateway:
    """Constrói e cacheia instância do OpenRouterGateway."""
    from app.llm.openrouter import OpenRouterGateway

    log.info("llm_factory_init", provider="openrouter")
    # lru_cache garante que só uma instância é criada por processo
    return OpenRouterGateway()


@lru_cache(maxsize=1)
def _build_anthropic() -> LLMGateway:
    """Constrói e cacheia instância do AnthropicGateway."""
    from app.llm.anthropic import AnthropicGateway

    log.info("llm_factory_init", provider="anthropic")
    return AnthropicGateway()


def get_gateway() -> LLMGateway:
    """Retorna o gateway LLM ativo conforme ``settings.llm_provider``.

    O provider é selecionado pela variável de ambiente ``LLM_PROVIDER``:
        - ``"openrouter"`` (default) → OpenRouterGateway
        - ``"anthropic"``            → AnthropicGateway

    A instância é cacheada por processo via ``lru_cache`` — consequentemente
    não há overhead de re-criação entre chamadas de nó.

    Returns:
        Implementação de ``LLMGateway`` pronta para uso.

    Raises:
        ``RuntimeError``: Provider desconhecido ou chave de API ausente.
    """
    provider = settings.llm_provider.lower()

    if provider == "openrouter":
        return _build_openrouter()
    if provider == "anthropic":
        return _build_anthropic()

    raise RuntimeError(
        f"LLM_PROVIDER='{provider}' não suportado. "
        "Valores válidos: 'openrouter', 'anthropic'."
    )


def reset_gateway_cache() -> None:
    """Limpa o cache de instâncias — útil em testes que trocam settings.

    NÃO deve ser chamado em código de produção.
    """
    _build_openrouter.cache_clear()
    _build_anthropic.cache_clear()


__all__ = ["Role", "for_role", "get_gateway", "reset_gateway_cache"]
