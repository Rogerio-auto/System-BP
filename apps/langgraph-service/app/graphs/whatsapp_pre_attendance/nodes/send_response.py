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

import re
from typing import Any

import structlog

from app.config import settings
from app.graphs.whatsapp_pre_attendance.state import ConversationState
from app.schemas.outbound import MESSAGES_MAX_TOTAL_CHARS

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

_WS_RE = re.compile(r"[ 	]+")


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


def _content_to_messages(content: str) -> list[str]:
    """Converte conteudo do agente em msgs por double-newline.

    Normaliza newlines internos para espaco e remove vazios.
    """
    if not content or not content.strip():
        return []
    parts = content.split(chr(10)+chr(10))
    messages: list[str] = []
    for part in parts:
        cleaned = _WS_RE.sub(" ", part.replace(chr(10), " ")).strip()
        if cleaned:
            messages.append(cleaned)
    return messages


def _truncate_messages(
    messages: list[str],
    max_total: int = MESSAGES_MAX_TOTAL_CHARS,
) -> list[str]:
    """Trunca lista para soma <= max_total. Nao corta no meio de palavra.

    Estrategia (F16-S41): acumula msgs; parcial corta no ultimo espaco.
    """
    result: list[str] = []
    used = 0
    for msg in messages:
        remaining = max_total - used
        if remaining <= 0:
            log.warning(
                "send_response_messages_truncated",
                truncated_at=len(result),
                total_dropped=len(messages) - len(result),
            )
            break
        if len(msg) <= remaining:
            result.append(msg)
            used += len(msg)
        else:
            candidate = msg[:remaining]
            last_space = candidate.rfind(" ")
            if last_space > 0:
                candidate = candidate[:last_space]
            if candidate:
                result.append(candidate)
            log.warning(
                "send_response_messages_truncated",
                truncated_at=len(result),
                total_dropped=len(messages) - len(result),
                last_msg_truncated=True,
            )
            break
    return result


def _derive_retrocompat_content(messages: list[str]) -> str:
    """Retorna primeira mensagem para reply.content retrocompat."""
    return messages[0] if messages else ""


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
    # `state["reply"]` é setado por nós produtores (collect_missing_profile_data,
    # identify_city low_confidence/out_of_service, qualify_credit_interest etc.)
    # com a string de texto que deve virar reply ao cliente. Tipo é `str` quando
    # presente; ausente/empty significa "esses nós não setaram".
    pending_reply: Any = state.get("reply")

    # ------------------------------------------------------------------
    # Determina reply com base no estado
    # Ordem de precedência:
    #   1. handoff_required → none (backend assume o texto via fallback de handoff)
    #   2. current_intent canônico com mensagem padrão (nao_entendi, fora_de_escopo)
    #   3. state["reply"] setado por nó produtor → text com esse conteúdo
    #   4. Fallback → none (delegated — nó produtor esqueceu de setar reply)
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
    elif isinstance(pending_reply, dict) and pending_reply.get("content"):
        # Path agêntico: agent_turn seta state["reply"] como dict
        raw_content: str = str(pending_reply["content"])
        reply = _build_reply(reply_type="text", content=raw_content)
        log.info(
            "send_response_from_agent_reply",
            conversation_id=conversation_id,
            lead_id=lead_id,
            content_length=len(raw_content),
        )
    elif isinstance(pending_reply, str) and pending_reply.strip():
        # Funil determinístico: nó produtor setou state["reply"] como string
        reply = _build_reply(reply_type="text", content=pending_reply)
        log.info(
            "send_response_from_state_reply",
            conversation_id=conversation_id,
            lead_id=lead_id,
            intent=current_intent,
            content_length=len(pending_reply),
        )
    else:
        # Bug latente: nó deveria ter setado state["reply"] mas não setou.
        # Log explícito para facilitar diagnóstico — antes virava só "none" silencioso.
        reply = _build_reply(reply_type="none", content="")
        log.warning(
            "send_response_none_delegated",
            conversation_id=conversation_id,
            lead_id=lead_id,
            intent=current_intent,
            note="nenhum nó setou state['reply'] e o intent não tem fallback canônico",
        )

    # ------------------------------------------------------------------
    # Derivar messages[] (F16-S41 -- path agentico apenas)
    # Funil antigo (flag OFF): messages=[] sem mudanca de comportamento.
    # ------------------------------------------------------------------
    output_messages: list[str] = []

    if settings.pre_attendance_agentic_enabled and reply["type"] == "text" and reply["content"]:
        raw = reply["content"]
        msgs = _content_to_messages(raw)
        msgs = _truncate_messages(msgs)
        if msgs:
            output_messages = msgs
            retrocompat_content = _derive_retrocompat_content(msgs)
            reply = _build_reply(
                reply_type="text",
                content=retrocompat_content,
                template_name=reply.get("template_name"),
                template_variables=reply.get("template_variables"),
            )
            log.info(
                "send_response_messages_built",
                conversation_id=conversation_id,
                lead_id=lead_id,
                count=len(output_messages),
                total_chars=sum(len(m) for m in output_messages),
            )

    # ------------------------------------------------------------------
    # Acumula em tool_results para o handler HTTP (e para log_decision)
    # ------------------------------------------------------------------
    tool_results: list[dict[str, Any]] = list(state.get("tool_results") or [])
    tool_results.append(
        {
            "node": "send_response",
            "reply": reply,
            "messages": output_messages,
        }
    )

    return {"tool_results": tool_results}


__all__ = ["send_response"]
