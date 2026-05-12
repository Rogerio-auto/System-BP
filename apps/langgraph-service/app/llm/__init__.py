"""Pacote LLM — Gateway provider-agnóstico para o LangGraph service.

Uso:
    from app.llm.factory import get_gateway, for_role

    gateway = get_gateway()
    response = await gateway.complete(
        model=for_role("classifier"),
        messages=[{"role": "user", "content": "..."}],
        metadata={"node": "classify_intent", "lead_id": "..."},
    )
"""

from app.llm.factory import for_role, get_gateway
from app.llm.gateway import BudgetExceededError, LLMGateway, LLMResponse

__all__ = [
    "BudgetExceededError",
    "LLMGateway",
    "LLMResponse",
    "for_role",
    "get_gateway",
]
