"""Estado tipado do grafo whatsapp_pre_attendance.

Define ConversationState (TypedDict, total=False) exatamente conforme doc 06 §5.1,
além das funções serialize_state / deserialize_state usadas pelo endpoint de estado
(F3-S02) para persistir/restaurar o snapshot jsonb em ai_conversation_states.

Regra de truncamento (doc 06 §8):
    messages é truncado às últimas MAX_MESSAGES entradas ao serializar,
    para controlar o crescimento do contexto enviado ao LLM.
"""

from __future__ import annotations

from typing import Any, Literal

from typing_extensions import TypedDict

# ---------------------------------------------------------------------------
# Constante de truncamento
# ---------------------------------------------------------------------------

MAX_MESSAGES: int = 20
"""Número máximo de mensagens mantidas no estado serializado (doc 06 §8)."""

# ---------------------------------------------------------------------------
# Tipo de intenção (catálogo canônico — doc 06 §5.1 e §5.4)
# ---------------------------------------------------------------------------

IntentLiteral = Literal[
    "saudacao",
    "quer_credito",
    "quer_simular",
    "enviar_documentos",
    "falar_atendente",
    "consultar_andamento",
    "reclamacao",
    "cobranca",
    "nao_entendi",
    "fora_de_escopo",
]

# ---------------------------------------------------------------------------
# Estado tipado
# ---------------------------------------------------------------------------


class ConversationState(TypedDict, total=False):
    """Estado compartilhado por todos os nós do grafo whatsapp_pre_attendance.

    Campos exatamente conforme doc 06 §5.1. total=False permite que cada nó
    retorne apenas os campos que modificou; LangGraph faz o merge incremental.

    Campos obrigatórios marcados como Not-Optional devem estar presentes na
    inicialização do grafo (receive_message / load_conversation_state).
    """

    # Multi-tenant (F16-S35): obrigatorio para escritas /internal/* — nao e PII
    organization_id: str

    # Identificadores de sessão
    conversation_id: str
    chatwoot_conversation_id: str

    # Identificadores de entidade
    lead_id: str | None
    customer_id: str | None
    phone: str

    # Perfil do cliente
    customer_name: str | None
    city_id: str | None
    city_name: str | None

    # Intenção classificada
    current_intent: IntentLiteral | None

    # Dados de qualificação de crédito
    requested_amount: float | None
    requested_term_months: int | None
    selected_product_id: str | None
    last_simulation_id: str | None

    # Estágio atual do funil
    current_stage: str | None

    # Handoff
    handoff_required: bool
    handoff_reason: str | None

    # Campos faltantes detectados pelo grafo
    missing_fields: list[str]

    # Histórico de mensagens (truncado a MAX_MESSAGES ao serializar)
    messages: list[dict[str, Any]]

    # Resultados de tools chamadas neste turno
    tool_results: list[dict[str, Any]]

    # Erros acumulados neste turno
    errors: list[dict[str, Any]]

    # Ações emitidas (eventos de domínio a serem processados pelo backend)
    actions_emitted: list[dict[str, Any]]


# ---------------------------------------------------------------------------
# Serialização
# ---------------------------------------------------------------------------

#: Conjunto de chaves conhecidas — usado por deserialize_state para filtrar
#: campos desconhecidos e garantir forward-compatibility.
_KNOWN_KEYS: frozenset[str] = frozenset(ConversationState.__annotations__.keys())


def serialize_state(state: ConversationState) -> dict[str, Any]:
    """Converte ConversationState em dict JSON-serializável.

    Aplica truncamento de messages às últimas MAX_MESSAGES entradas (doc 06 §8).
    O dict resultante é adequado para persistência na coluna jsonb
    ai_conversation_states.state do backend.

    Args:
        state: Estado atual do grafo.

    Returns:
        Dict com todos os campos do estado; messages truncado se necessário.
    """
    serialized: dict[str, Any] = dict(state)

    # Truncamento de histórico (doc 06 §8)
    messages = serialized.get("messages")
    if isinstance(messages, list) and len(messages) > MAX_MESSAGES:
        serialized["messages"] = messages[-MAX_MESSAGES:]

    return serialized


def deserialize_state(data: dict[str, Any]) -> ConversationState:
    """Restaura ConversationState a partir de um dict (snapshot jsonb).

    Chaves desconhecidas são descartadas para garantir forward-compatibility:
    se uma versão futura do schema adicionar campos que esta versão não conhece,
    o serviço não quebra ao carregar um estado salvo por versão mais nova.

    Args:
        data: Dict bruto recuperado do backend (campo state do snapshot).

    Returns:
        ConversationState com apenas os campos conhecidos pelo schema atual.
    """
    # Filtra chaves desconhecidas (forward-compat)
    filtered: dict[str, Any] = {k: v for k, v in data.items() if k in _KNOWN_KEYS}

    # TypedDict não tem __init__ que valide; construímos diretamente.
    # O cast é seguro aqui porque filtramos estritamente pelas anotações.
    return filtered  # type: ignore[return-value]
