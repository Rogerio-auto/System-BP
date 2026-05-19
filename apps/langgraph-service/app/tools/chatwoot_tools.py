"""Tools de Chatwoot para os grafos LangGraph.

Expõe ``request_handoff`` — wrapper fino sobre ``POST /internal/handoffs``
(F3-S07/F3-S37) com suporte a ``Idempotency-Key`` via ``InternalApiClient``.

Usado pelos nós ``request_handoff`` e ``decide_next_step`` do grafo de
pré-atendimento WhatsApp (doc 06 §5.2 / §7.4).

Regra: NUNCA acessar Postgres diretamente. NUNCA chamar Chatwoot diretamente.
Toda mutação passa pelo backend Node via /internal/*.
"""
from __future__ import annotations

import uuid
from typing import Literal

import structlog
from pydantic import BaseModel, Field

from app.tools._base import InternalApiClient

log: structlog.stdlib.BoundLogger = structlog.get_logger(__name__)

_HANDOFFS_PATH = "/internal/handoffs"


# ---------------------------------------------------------------------------
# I/O schemas (Pydantic v2)
# ---------------------------------------------------------------------------


class HandoffInput(BaseModel):
    """Payload de entrada para solicitar transferência a atendente humano.

    Campos alinhados com doc 06 §7.4 e schema do endpoint F3-S07.
    """

    lead_id: str = Field(description="UUID do lead no banco.")
    conversation_id: str = Field(description="UUID interno da conversa LangGraph.")
    reason: str = Field(
        description=(
            "Motivo da transferência. Exemplos: 'cliente_solicitou_atendente', "
            "'cobranca', 'ai_unavailable', 'reclamacao'."
        )
    )
    summary: str = Field(
        description=(
            "Resumo do contexto da conversa para o atendente. "
            "Nunca incluir CPF ou dados sensíveis em texto plano — "
            "omitir ou mascarar conforme LGPD (doc 17)."
        )
    )
    simulation_id: str | None = Field(
        default=None,
        description="UUID da simulação vinculada, se houver.",
    )


class HandoffOutput(BaseModel):
    """Resposta do backend após criar o handoff.

    Campos conforme doc 06 §7.4 output.
    """

    handoff_id: str = Field(description="UUID do registro chatwoot_handoffs criado.")
    chatwoot_conversation_id: str = Field(
        description="ID da conversa no Chatwoot."
    )
    assigned_agent_id: str | None = Field(
        default=None,
        description="UUID do agente humano designado (pode ser None se fila).",
    )
    status: Literal["requested", "assigned", "queued"] = Field(
        description="Estado inicial do handoff."
    )


# ---------------------------------------------------------------------------
# Tool function
# ---------------------------------------------------------------------------


async def request_handoff(
    handoff_input: HandoffInput,
    *,
    client: InternalApiClient | None = None,
    idempotency_key: str | None = None,
) -> HandoffOutput:
    """Cria um handoff para atendente humano via ``POST /internal/handoffs``.

    Deve ser chamada pelos nós LangGraph que decidem transferir a conversa.
    Em caso de falha (5xx, timeout), o chamador deve tratar o erro e emitir
    mensagem segura ao cliente — LangGraph não retenta sozinho (doc 06 §4).

    Args:
        handoff_input: Dados da solicitação de handoff (lead, conversa, motivo, resumo).
        client: Instância de ``InternalApiClient`` (injetável em testes).
                Se ``None``, cria uma instância padrão.
        idempotency_key: Chave de idempotência para evitar handoffs duplicados
                         em reenvios. Se ``None``, gera um UUID v4 derivado de
                         ``conversation_id + reason`` para segurança.

    Returns:
        ``HandoffOutput`` com ``handoff_id``, ``chatwoot_conversation_id``,
        ``assigned_agent_id`` e ``status``.

    Raises:
        httpx.HTTPStatusError: Quando o backend retorna erro não-transitório.
        httpx.TimeoutException: Quando o backend não responde em 8 s.
    """
    _client = client or InternalApiClient()

    # Derive um idempotency_key estável a partir de (conversation_id, reason)
    # quando o chamador não fornece um. UUID v5 (namespace + nome) é determinístico:
    # mesma combinação sempre gera o mesmo UUID — ideal para retries seguros.
    if idempotency_key is None:
        idempotency_key = str(
            uuid.uuid5(
                uuid.NAMESPACE_URL,
                f"{handoff_input.conversation_id}:{handoff_input.reason}",
            )
        )

    payload: dict[str, object] = {
        "lead_id": handoff_input.lead_id,
        "conversation_id": handoff_input.conversation_id,
        "reason": handoff_input.reason,
        "summary": handoff_input.summary,
    }
    if handoff_input.simulation_id is not None:
        payload["simulation_id"] = handoff_input.simulation_id

    log.info(
        "handoff_requested",
        lead_id=handoff_input.lead_id,
        conversation_id=handoff_input.conversation_id,
        reason=handoff_input.reason,
        idempotency_key=idempotency_key,
    )

    raw = await _client.post(
        _HANDOFFS_PATH,
        json=payload,
        idempotency_key=idempotency_key,
    )

    output = HandoffOutput.model_validate(raw)

    log.info(
        "handoff_created",
        handoff_id=output.handoff_id,
        chatwoot_conversation_id=output.chatwoot_conversation_id,
        assigned_agent_id=output.assigned_agent_id,
        status=output.status,
    )

    return output
