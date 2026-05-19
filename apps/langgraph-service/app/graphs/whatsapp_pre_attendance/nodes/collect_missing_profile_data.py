"""Nó collect_missing_profile_data — detecta e solicita campos obrigatórios ausentes.

Verifica se `customer_name` está presente no estado. Se não estiver, marca
`missing_fields` com `"customer_name"` e compõe a pergunta de nome em `reply`.

Função pura: não faz chamadas externas. Apenas inspeciona o estado e devolve
um estado atualizado com `missing_fields` e, opcionalmente, `reply`.

Referência: doc 06 §5.2.
"""
from __future__ import annotations

from typing import Any

import structlog

from app.graphs.whatsapp_pre_attendance.state import ConversationState

log: structlog.stdlib.BoundLogger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Constantes
# ---------------------------------------------------------------------------

_FIELD_CUSTOMER_NAME = "customer_name"

_ASK_NAME_MESSAGE = (
    "Olá! Para continuar, preciso saber seu nome completo. "
    "Poderia me informar, por favor?"
)

# ---------------------------------------------------------------------------
# Nó
# ---------------------------------------------------------------------------


def collect_missing_profile_data(state: ConversationState) -> ConversationState:
    """Detecta campos de perfil obrigatórios ausentes e solicita ao usuário.

    Atualmente verifica apenas `customer_name`. A lista `missing_fields` no
    estado é acumulativa — campos já marcados por nós anteriores são preservados.

    Se `customer_name` estiver ausente:
      - Adiciona `"customer_name"` a `missing_fields` (sem duplicata).
      - Define `reply` com a pergunta de nome.

    Se todos os campos estiverem presentes:
      - Preserva `missing_fields` sem alteração.
      - Não altera `reply`.

    Args:
        state: Estado atual do grafo.

    Returns:
        Novo estado com `missing_fields` e `reply` atualizados se necessário.
    """
    conversation_id: str = state.get("conversation_id", "")
    customer_name: str | None = state.get("customer_name")

    # Preservar missing_fields já marcados por nós anteriores
    missing_fields: list[str] = list(state.get("missing_fields") or [])

    if not customer_name:
        if _FIELD_CUSTOMER_NAME not in missing_fields:
            missing_fields.append(_FIELD_CUSTOMER_NAME)

        log.info(
            "collect_missing_profile_data_name_required",
            conversation_id=conversation_id,
        )

        result: dict[str, Any] = {
            **state,
            "missing_fields": missing_fields,
            "reply": _ASK_NAME_MESSAGE,
        }
        return result  # type: ignore[return-value]

    # Nenhum campo faltando (ou já preenchido após iteração anterior)
    log.info(
        "collect_missing_profile_data_complete",
        conversation_id=conversation_id,
    )

    result = {**state, "missing_fields": missing_fields}
    return result  # type: ignore[return-value]
