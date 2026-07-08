"""Estado tipado do grafo internal_assistant (F6-S07).

O copiloto e stateless por request -- nao persiste em ai_conversation_states.
O principal do usuario e threaded via state em todas as tool calls.

LGPD s17/s8.5:
    Nenhum PII e persistido no state. O principal contem user_id (UUID opaco),
    organization_id, permissions e city_scope_ids -- nenhum dado pessoal bruto.
"""
from __future__ import annotations

from typing import Any

from typing_extensions import TypedDict


class Principal(TypedDict):
    """Principal do usuario -- threaded do JWT pelo endpoint F6-S08.

    Regra de ouro: nunca inferido pelo grafo, sempre fornecido pelo caller.
    Espelha PrincipalSchema de internal/assistant/schemas.ts.
    """

    user_id: str
    """UUID do usuario autenticado."""

    organization_id: str
    """UUID da organizacao (multi-tenant safety)."""

    permissions: list[str]
    """Permissoes efetivas do usuario no momento da chamada."""

    city_scope_ids: list[str] | None
    """null = escopo global; [] = sem cidade; [...] = IDs de cidades filtradas."""


class InternalAssistantState(TypedDict, total=False):
    """Estado compartilhado por todos os nos do grafo internal_assistant.

    total=False: cada no retorna apenas os campos que modificou.

    Campos obrigatorios (devem estar presentes na inicializacao):
        - principal: fornecido pelo caller (endpoint F6-S08).
        - organization_id: extraido do principal para facilitar tool calls.
        - question: pergunta do usuario.

    LGPD: nenhum PII e armazenado neste state (apenas IDs opacos e flags).
    """

    # Principal do usuario -- obrigatorio, threaded em todas as tool calls
    principal: Principal

    # Atalho para tools que precisam apenas de organization_id
    organization_id: str

    # Pergunta do usuario (input do request)
    question: str

    # Historico de mensagens para o LLM (format OpenAI)
    messages: list[dict[str, Any]]

    # Resposta final a retornar ao chamador
    answer: str

    # Fonte(s) dos dados utilizados na resposta
    sources: list[str]

    # Erros nao-fatais (nao interrompem o grafo, registrados para observabilidade)
    errors: list[dict[str, Any]]

    # Metadados de observabilidade (model, prompt_version, latency, etc.)
    metadata: dict[str, Any]
