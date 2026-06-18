"""Nó load_state — segundo nó do grafo whatsapp_pre_attendance.

Responsabilidade (doc 06 §5.2):
    Carregar o estado persistido via ``GET /internal/conversations/:id/state``
    (implementado em F3-S02). Se o estado não existir (404), inicializa um
    ``ConversationState`` novo a partir dos campos presentes no estado atual
    (preenchidos por ``receive_message``).

Contrato:
    - Entrada: ConversationState com pelo menos ``conversation_id`` e ``phone``
               (garantidos pelo nó anterior ``receive_message``).
    - Saída: ConversationState carregado do backend ou inicializado.
    - Toda chamada HTTP usa ``InternalApiClient`` (header X-Internal-Token).
    - Erros irrecuperáveis → ``handoff_required=True`` + entrada em ``errors``.
    - Função pura do ponto de vista do grafo: não muta estado; retorna novo.

Endpoint chamado: ``GET /internal/conversations/{conversation_id}/state``
    200 → { "state": { ... } }
    404 → estado inexistente → inicializa novo
    5xx / timeout → handoff
"""

from __future__ import annotations

import time
from typing import Any

import httpx
import structlog

from app.graphs.whatsapp_pre_attendance.state import (
    ConversationState,
    deserialize_state,
)
from app.tools._base import InternalApiClient

log: structlog.stdlib.BoundLogger = structlog.get_logger(__name__)


def _initial_state(base: ConversationState) -> ConversationState:
    """Retorna um ConversationState novo com defaults para estado inexistente.

    Preserva todos os campos já preenchidos por ``receive_message`` e adiciona
    os campos de controle com valores padrão.

    Args:
        base: Estado atual (contém phone, conversation_id, messages, etc.).

    Returns:
        ConversationState completo com defaults.
    """
    defaults: ConversationState = {
        "handoff_required": False,
        "handoff_reason": None,
        "missing_fields": [],
        "tool_results": [],
        "errors": [],
        "actions_emitted": [],
        "lead_id": None,
        "customer_id": None,
        "customer_name": None,
        "city_id": None,
        "city_name": None,
        "current_intent": None,
        "requested_amount": None,
        "requested_term_months": None,
        "selected_product_id": None,
        "last_simulation_id": None,
        "current_stage": None,
        # Estado leve do agente (F16-S42) — defaults para primeira interação
        "activity": None,
        "profile": None,
        "credit_objective": None,
        "scr_authorized": None,
        "collection_status": None,
        "handoff_active": False,
        "cpf_collected": False,
    }
    # base sobrescreve defaults — preserve tudo que receive_message já preencheu
    merged: ConversationState = {**defaults, **base}
    return merged


async def load_state(state: ConversationState) -> ConversationState:
    """Carrega o estado persistido do backend ou inicializa um novo.

    Chama ``GET /internal/conversations/{conversation_id}/state`` via
    ``InternalApiClient``. Em caso de 404, inicializa estado novo usando os
    campos presentes em ``state`` (preenchidos por ``receive_message``).
    Em caso de 5xx ou timeout, marca ``handoff_required=True`` e registra
    o erro em ``errors``.

    Args:
        state: Estado corrente do grafo (deve ter ``conversation_id``).

    Returns:
        ConversationState carregado ou inicializado.
    """
    start_ns = time.monotonic_ns()
    conversation_id: str = state.get("conversation_id", "")

    if not conversation_id:
        log.error("load_state_missing_conversation_id")
        error_entry: dict[str, Any] = {
            "node": "load_state",
            "error": "MISSING_CONVERSATION_ID",
            "message": "conversation_id ausente no estado — não é possível carregar.",
        }
        errors: list[dict[str, Any]] = [*list(state.get("errors") or []), error_entry]
        result: ConversationState = {**state, "handoff_required": True, "errors": errors}
        return result

    client = InternalApiClient()
    path = f"/internal/conversations/{conversation_id}/state"

    try:
        response_data: dict[str, Any] = await client.get(path)
        # Endpoint retorna { "state": { … } }
        raw_state: dict[str, Any] = response_data.get("state") or {}
        loaded = deserialize_state(raw_state)

        # Mescla: estado carregado tem precedência sobre defaults,
        # mas mensagens novas de receive_message são preservadas.
        # receive_message já append a nova mensagem — tomamos o maior histórico.
        merged_messages: list[dict[str, Any]] = _merge_messages(
            persisted=list(loaded.get("messages") or []),
            current=list(state.get("messages") or []),
        )

        merged: ConversationState = {**_initial_state(loaded), **{
            # Campos de sessão do request atual sempre prevalecem
            # organization_id: request é autoritativo; fallback para o persistido
            "organization_id": state.get("organization_id") or loaded.get("organization_id", ""),
            "conversation_id": state.get("conversation_id", loaded.get("conversation_id", "")),
            "chatwoot_conversation_id": (
                state.get("chatwoot_conversation_id")
                or loaded.get("chatwoot_conversation_id", "")
            ),
            "phone": state.get("phone") or loaded.get("phone", ""),
            "messages": merged_messages,
            # Listas de controle do turno corrente (começam frescas a cada turno)
            "tool_results": [],
            "errors": [],
            "actions_emitted": [],
        }}

        latency_ms = (time.monotonic_ns() - start_ns) // 1_000_000
        log.info(
            "load_state_ok",
            conversation_id=conversation_id,
            organization_id=merged.get("organization_id") or "<missing>",
            messages_count=len(merged_messages),
            current_stage=merged.get("current_stage"),
            latency_ms=latency_ms,
        )
        return merged

    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            # Estado não existe ainda — primeira interação
            initialized = _initial_state(state)
            latency_ms = (time.monotonic_ns() - start_ns) // 1_000_000
            log.info(
                "load_state_initialized_new",
                conversation_id=conversation_id,
                latency_ms=latency_ms,
            )
            return initialized

        # 4xx não-404 ou 5xx — handoff
        # F7-S03 log sanitization: str(exc) pode vazar URL interna com path
        # contendo conversation_id. Usar apenas o status code (dado seguro).
        error_entry = {
            "node": "load_state",
            "error": "BACKEND_ERROR",
            "status_code": exc.response.status_code,
            "message": f"http_status_{exc.response.status_code}",
        }
        errors = [*list(state.get("errors") or []), error_entry]
        log.error(
            "load_state_backend_error",
            conversation_id=conversation_id,
            status_code=exc.response.status_code,
        )
        result = {**_initial_state(state), "handoff_required": True, "errors": errors}
        return result

    except httpx.TimeoutException:
        error_entry = {
            "node": "load_state",
            "error": "TIMEOUT",
            "message": "Timeout ao carregar estado do backend",
        }
        errors = [*list(state.get("errors") or []), error_entry]
        log.error("load_state_timeout", conversation_id=conversation_id)
        result = {**_initial_state(state), "handoff_required": True, "errors": errors}
        return result


def _merge_messages(
    *,
    persisted: list[dict[str, Any]],
    current: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Mescla histórico persistido com mensagens do turno atual.

    ``receive_message`` já appended a nova mensagem em ``current``. O histórico
    persistido no backend é o de turnos anteriores. Estratégia: usar ``current``
    se ele já contém o histórico (cenário normal após receive_message), ou
    concatenar ``persisted`` + novos itens de ``current``.

    Heurística: se ``current`` é superconjunto de ``persisted`` (em comprimento),
    retorna ``current`` diretamente. Caso contrário, concatena.

    Args:
        persisted: Histórico carregado do backend.
        current: Histórico do estado após receive_message.

    Returns:
        Lista mesclada de mensagens.
    """
    if len(current) >= len(persisted):
        # receive_message já inclui tudo — retorna diretamente
        return current

    # Estado do backend tem mais mensagens que o estado atual (improvável,
    # mas defensivo): concatena e remove duplicatas por posição
    combined = persisted + current[len(persisted):]
    return combined
