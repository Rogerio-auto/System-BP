"""Nó send_response — compõe o objeto ``reply`` final do turno.

Responsabilidade (doc 06 §5.2 + §4.2):
    Compor o campo ``reply`` do contrato de resposta HTTP do grafo:
    - ``type``: ``"text"`` | ``"template"`` | ``"none"``
    - ``content``: texto da mensagem ou ``""`` quando type == "none"
    - ``template_name``: nome do template WhatsApp aprovado, ou ``None``
    - ``template_variables``: lista de variáveis do template, ou ``None``

Regras de composição (doc 06 §5.3):
    - Quando ``handoff_required=True``, não emite reply de conteúdo — o backend
      decide o texto de handoff; type="none", content="".
    - Intent ``nao_entendi``: reply de texto pedindo reformulação.
    - Intent ``fora_de_escopo``: reply de texto com mensagem padrão.
    - Qualquer outro caso sem reply gerado pelos nós anteriores: type="none".

O reply composto é armazenado em ``tool_results`` para ser lido pelo handler HTTP.

LGPD (doc 17 §8.3 / §8.4):
    - ``reply.content`` não deve conter PII bruta (CPF, RG, nome completo).
    - Respostas textuais são templates fixos sem interpolação de dados pessoais.
    - Este nó é função pura: não chama LLM, não chama backend.
"""
from __future__ import annotations

from typing import Any

import structlog

from app.graphs.whatsapp_pre_attendance.state import ConversationState

log: structlog.stdlib.BoundLogger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Constantes de reply (templates fixos — sem PII)
# ---------------------------------------------------------------------------

_MSG_NAO_ENTENDI = (
    "Desculpe, não entendi sua mensagem. "
    "Poderia reformular de outra forma? "
    "Posso ajudar com informações sobre crédito, simulações e atendimento."
)

_MSG_FORA_DE_ESCOPO = (
    "Posso ajudar apenas com assuntos relacionados ao crédito do Banco do Povo. "
    "Se precisar de outro tipo de suporte, entre em contato com nosso atendimento."
)

# Tipo do reply — espelha o contrato doc 06 §4.2
ReplyType = str  # "text" | "template" | "none"


def _build_reply(
    *,
    reply_type: ReplyType,
    content: str,
    template_name: str | None = None,
    template_variables: list[str] | None = None,
) -> dict[str, Any]:
    """Constrói o dict ``reply`` conforme contrato doc 06 §4.2."""
    return {
        "type": reply_type,
        "content": content,
        "template_name": template_name,
        "template_variables": template_variables,
    }


# ---------------------------------------------------------------------------
# Nó principal
# ---------------------------------------------------------------------------


def send_response(state: ConversationState) -> dict[str, Any]:
    """Nó LangGraph: compõe o ``reply`` final do turno.

    Lê o estado atual e determina o tipo e conteúdo da resposta ao cliente.
    A resposta composta é registrada em ``tool_results`` com ``node="send_response"``
    para ser lida pelo handler HTTP ao montar o corpo da resposta (doc 06 §4.2).

    Lógica de composição (doc 06 §5.3):
    1. ``handoff_required=True`` → ``type="none"`` (backend gerencia o texto do handoff).
    2. Intenção ``nao_entendi`` → reply de texto pedindo reformulação.
    3. Intenção ``fora_de_escopo`` → reply de texto com mensagem padrão.
    4. Qualquer outro caso → ``type="none"`` (outros nós emitiram o conteúdo).

    Args:
        state: Estado corrente do grafo.

    Returns:
        Dict com ``tool_results`` acumulado contendo o reply composto.
    """
    conversation_id: str = state.get("conversation_id", "")
    lead_id: str | None = state.get("lead_id")
    current_intent: str | None = state.get("current_intent")
    handoff_required: bool = state.get("handoff_required", False)

    # ------------------------------------------------------------------
    # Determina reply com base no estado
    # ------------------------------------------------------------------
    if handoff_required:
        # Handoff ativo — backend decide o texto; agente não emite reply
        reply = _build_reply(reply_type="none", content="")
        log.info(
            "send_response_none_handoff",
            conversation_id=conversation_id,
            lead_id=lead_id,
            intent=current_intent,
        )
    elif current_intent == "nao_entendi":
        reply = _build_reply(reply_type="text", content=_MSG_NAO_ENTENDI)
        log.info(
            "send_response_nao_entendi",
            conversation_id=conversation_id,
            lead_id=lead_id,
        )
    elif current_intent == "fora_de_escopo":
        reply = _build_reply(reply_type="text", content=_MSG_FORA_DE_ESCOPO)
        log.info(
            "send_response_fora_de_escopo",
            conversation_id=conversation_id,
            lead_id=lead_id,
        )
    else:
        # Outros nós (qualify_credit_interest, generate_simulation, etc.) são
        # responsáveis pelo conteúdo; send_response emite none aqui.
        reply = _build_reply(reply_type="none", content="")
        log.info(
            "send_response_none_delegated",
            conversation_id=conversation_id,
            lead_id=lead_id,
            intent=current_intent,
        )

    # ------------------------------------------------------------------
    # Acumula em tool_results para o handler HTTP (e para log_decision)
    # ------------------------------------------------------------------
    tool_results: list[dict[str, Any]] = list(state.get("tool_results") or [])
    tool_results.append(
        {
            "node": "send_response",
            "reply": reply,
        }
    )

    return {"tool_results": tool_results}


__all__ = ["send_response"]
