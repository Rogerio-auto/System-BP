"""Nó receive_message — primeiro nó do grafo whatsapp_pre_attendance.

Responsabilidade (doc 06 §5.2):
    Normalizar o payload HTTP inbound (doc 06 §4.1) e fazer append da mensagem
    recebida em ``state.messages``, inicializando os campos de sessão quando
    ainda ausentes no estado.

Contrato:
    - Entrada: ConversationState (pode estar vazio na primeira mensagem)
    - Saída: ConversationState atualizado com campos de sessão + nova mensagem
    - Sem side-effects: não chama backend, não chama LLM.
    - Função pura compatível com LangGraph.

Payload inbound (doc 06 §4.1 — campos relevantes para este nó):
    conversation_id, lead_id, customer_phone, message_text,
    message_attachments, message_timestamp, chatwoot_conversation_id,
    chatwoot_account_id, metadata (city_id, city_name, customer_name)
"""

from __future__ import annotations

import time
from typing import Any

import structlog

from app.graphs.whatsapp_pre_attendance.state import ConversationState

log: structlog.stdlib.BoundLogger = structlog.get_logger(__name__)


def receive_message(state: ConversationState, *, payload: dict[str, Any]) -> ConversationState:
    """Normaliza o payload inbound e faz append em ``state.messages``.

    Este nó é chamado com o estado corrente (possivelmente vazio) e o payload
    HTTP recebido do backend (doc 06 §4.1). Ele:

    1. Inicializa os campos de sessão (``conversation_id``, ``phone``,
       ``chatwoot_conversation_id``) a partir do payload, caso ausentes.
    2. Propaga os campos de perfil vindos em ``metadata`` (``city_id``,
       ``city_name``, ``customer_name``) quando presentes.
    3. Faz append da mensagem normalizada em ``state.messages``.

    Args:
        state: Estado atual do grafo (pode ser ``{}`` na primeira mensagem).
        payload: Dict com o corpo do ``POST /process/whatsapp/message``
                 (doc 06 §4.1).

    Returns:
        Novo ConversationState com todos os campos acima preenchidos/atualizados.
    """
    start_ns = time.monotonic_ns()

    # ------------------------------------------------------------------
    # Extrai campos do payload (doc 06 §4.1)
    # ------------------------------------------------------------------
    conversation_id: str = payload["conversation_id"]
    chatwoot_conversation_id: str = str(payload.get("chatwoot_conversation_id", ""))
    phone: str = payload.get("customer_phone", state.get("phone", ""))
    lead_id: str | None = payload.get("lead_id") or state.get("lead_id")
    message_text: str = payload.get("message_text", "")
    message_attachments: list[dict[str, Any]] = payload.get("message_attachments") or []
    message_timestamp: str = payload.get("message_timestamp", "")
    channel: str = payload.get("channel", "whatsapp")
    correlation_id: str | None = payload.get("correlation_id")

    # Metadata opcional (pode inicializar perfil parcial)
    metadata: dict[str, Any] = payload.get("metadata") or {}
    city_id: str | None = metadata.get("city_id") or state.get("city_id")
    city_name: str | None = metadata.get("city_name") or state.get("city_name")
    customer_name: str | None = metadata.get("customer_name") or state.get("customer_name")

    # ------------------------------------------------------------------
    # Normaliza mensagem para o histórico
    # ------------------------------------------------------------------
    normalized_message: dict[str, Any] = {
        "role": "user",
        "content": message_text,
        "channel": channel,
        "timestamp": message_timestamp,
    }
    if message_attachments:
        normalized_message["attachments"] = message_attachments

    # Append não-destrutivo: preserva histórico existente
    existing_messages: list[dict[str, Any]] = list(state.get("messages") or [])
    updated_messages = [*existing_messages, normalized_message]

    # ------------------------------------------------------------------
    # Monta o estado atualizado (merge incremental)
    # ------------------------------------------------------------------
    updates: ConversationState = {
        "conversation_id": conversation_id,
        "chatwoot_conversation_id": chatwoot_conversation_id,
        "phone": phone,
        "messages": updated_messages,
        # Listas de controle — garante inicialização em estado novo
        "tool_results": list(state.get("tool_results") or []),
        "errors": list(state.get("errors") or []),
        "actions_emitted": list(state.get("actions_emitted") or []),
        "missing_fields": list(state.get("missing_fields") or []),
        "handoff_required": state.get("handoff_required", False),
    }

    # Campos opcionais: só sobrescreve quando payload traz valor
    if lead_id is not None:
        updates["lead_id"] = lead_id
    if customer_name is not None:
        updates["customer_name"] = customer_name
    if city_id is not None:
        updates["city_id"] = city_id
    if city_name is not None:
        updates["city_name"] = city_name

    latency_ms = (time.monotonic_ns() - start_ns) // 1_000_000
    log.info(
        "receive_message_done",
        conversation_id=conversation_id,
        # LGPD doc 17 §8.3: telefone é PII — logar só o sufixo, nunca o número bruto.
        phone_suffix=phone[-4:] if phone else "",
        message_length=len(message_text),
        messages_total=len(updated_messages),
        correlation_id=correlation_id,
        latency_ms=latency_ms,
    )

    # Mescla estado existente com atualizações (LangGraph-style: retorna
    # apenas as chaves que este nó conhece/modificou)
    merged: ConversationState = {**state, **updates}
    return merged
