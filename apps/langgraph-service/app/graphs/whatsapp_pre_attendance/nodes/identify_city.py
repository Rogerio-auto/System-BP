"""Nó identify_city — resolve e confirma a cidade do cliente.

Comportamento (doc 06 §5.2 / §7.2):

1. **Match alto** (``confidence >= 0.85``):
   Grava ``city_id`` / ``city_name`` no estado e persiste no lead via
   ``update_lead_profile``.  Registra ``tool_results`` e avança o fluxo.

2. **Match baixo** (``confidence < 0.85``):
   Compõe uma pergunta de confirmação listando as ``alternatives`` retornadas
   pela tool.  A resposta ficará em ``messages`` para o próximo turno.

3. **Fora da área atendida** (``out_of_service=True``):
   Emite mensagem de fluxo alternativo — o Banco do Povo ainda não atende
   aquela cidade.  Define ``handoff_required=False`` (não é handoff humano,
   é encerramento amigável).

Tratamento de falhas:
   ``identify_city`` (tool) propaga ``httpx.HTTPStatusError`` e
   ``httpx.TimeoutException`` em erros 5xx/timeout.  O nó os captura e
   compõe uma mensagem segura ao cliente, marcando ``handoff_required=True``
   com razão registrada.  O traceback (que contém a URL interna) nunca escapa
   para o estado público.

Função pura: ``(ConversationState) -> ConversationState``.
"""

from __future__ import annotations

import time
from typing import Any

import httpx
import structlog

from app.graphs.whatsapp_pre_attendance.state import ConversationState
from app.tools.city_tools import IdentifyCityResult
from app.tools.city_tools import identify_city as tool_identify_city
from app.tools.leads_tools import UpdateLeadProfileResult
from app.tools.leads_tools import update_lead_profile as tool_update_lead_profile

log: structlog.stdlib.BoundLogger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Limiar de confiança (doc 06 §7.2)
# ---------------------------------------------------------------------------

_CONFIDENCE_THRESHOLD: float = 0.85

# ---------------------------------------------------------------------------
# Mensagens ao cliente
# ---------------------------------------------------------------------------

_MSG_OUT_OF_SERVICE = (
    "Entendi! Infelizmente o Banco do Povo ainda não atende {city} na modalidade "
    "de microcrédito produtivo. Se tiver interesse, pode entrar em contato com a "
    "agência de desenvolvimento do seu município. Posso ajudar com mais alguma coisa?"
)

_MSG_CONFIRM_WITH_ALTS = (
    "Não consegui identificar exatamente a sua cidade. Você quis dizer uma destas opções?\n"
    "{alternatives_list}\n"
    "Por favor, responda com o nome correto ou o número correspondente."
)

_MSG_CONFIRM_NO_ALTS = (
    "Não reconheci a cidade informada. Poderia digitar o nome completo da sua cidade, "
    "por favor?"
)

_MSG_SERVICE_UNAVAILABLE = (
    "Tive um problema técnico ao verificar sua cidade. "
    "Um de nossos atendentes entrará em contato em breve para continuar seu cadastro."
)

# ---------------------------------------------------------------------------
# Nó principal
# ---------------------------------------------------------------------------


async def node_identify_city(state: ConversationState) -> ConversationState:
    """Resolve a cidade do cliente e atualiza o estado do grafo.

    Args:
        state: Estado atual da conversa.  Espera que ``messages`` contenha a
               mensagem mais recente do cliente com o nome da cidade, e que
               ``lead_id`` esteja preenchido (nó executado após identify_or_create_lead).

    Returns:
        Novo estado com ``city_id`` / ``city_name`` preenchidos (match alto),
        ou ``messages`` com pergunta de confirmação (match baixo), ou
        ``handoff_required=True`` (erro de infra).
    """
    lead_id: str | None = state.get("lead_id")
    messages: list[dict[str, Any]] = list(state.get("messages") or [])
    tool_results: list[dict[str, Any]] = list(state.get("tool_results") or [])
    errors: list[dict[str, Any]] = list(state.get("errors") or [])

    # Extrai o texto da última mensagem do cliente como city_text
    city_text = _extract_last_user_message(messages)

    log.info(
        "node_identify_city_start",
        lead_id=lead_id,
        city_text_length=len(city_text),
    )

    t0 = time.monotonic()

    # ------------------------------------------------------------------
    # Chamada à tool — protegida contra falhas de infra
    # ------------------------------------------------------------------
    try:
        result: IdentifyCityResult = await tool_identify_city(
            city_text=city_text,
            lead_id=lead_id,
        )
    except (httpx.HTTPStatusError, httpx.TimeoutException) as exc:
        latency_ms = int((time.monotonic() - t0) * 1000)
        # Registra o erro sem vazar detalhes internos (URL, stack trace)
        error_kind = "timeout" if isinstance(exc, httpx.TimeoutException) else "http_error"
        log.error(
            "node_identify_city_tool_error",
            lead_id=lead_id,
            error_kind=error_kind,
            latency_ms=latency_ms,
        )
        errors.append({"node": "identify_city", "error": error_kind})
        messages.append({"role": "assistant", "content": _MSG_SERVICE_UNAVAILABLE})
        return dict(  # type: ignore[return-value]  # ConversationState is TypedDict
            state,
            messages=messages,
            tool_results=tool_results,
            errors=errors,
            handoff_required=True,
            handoff_reason="city_identification_infra_error",
        )

    latency_ms = int((time.monotonic() - t0) * 1000)
    log.info(
        "node_identify_city_tool_done",
        lead_id=lead_id,
        matched=result.matched,
        confidence=result.confidence,
        out_of_service=result.out_of_service,
        latency_ms=latency_ms,
    )

    tool_results.append(
        {
            "tool": "identify_city",
            "city_id": result.city_id,
            "city_name": result.city_name,
            "matched": result.matched,
            "confidence": result.confidence,
            "out_of_service": result.out_of_service,
        }
    )

    # ------------------------------------------------------------------
    # Cenário 3 — Fora da área atendida
    # ------------------------------------------------------------------
    if result.out_of_service:
        city_label = result.city_name or city_text
        out_of_service_msg = _MSG_OUT_OF_SERVICE.format(city=city_label)
        messages.append({"role": "assistant", "content": out_of_service_msg})
        log.info("node_identify_city_out_of_service", lead_id=lead_id, city=city_label)
        return dict(  # type: ignore[return-value]
            state,
            messages=messages,
            tool_results=tool_results,
            errors=errors,
            # Seta `reply` para que `send_response` consolide no payload final.
            # Sem isso, a mensagem só vai pro histórico (`messages`) e o cliente
            # nunca recebe a resposta de "cidade fora do escopo".
            reply=out_of_service_msg,
        )

    # ------------------------------------------------------------------
    # Cenário 1 — Match alto: gravar cidade e persistir no lead
    # ------------------------------------------------------------------
    if result.matched and result.confidence >= _CONFIDENCE_THRESHOLD:
        city_id: str = result.city_id or ""
        city_name: str = result.city_name or ""

        update_result: UpdateLeadProfileResult | None = None
        if lead_id and city_id:
            update_result = await _update_lead_city(lead_id, city_id)
            if update_result is not None:
                tool_results.append(
                    {
                        "tool": "update_lead_profile",
                        "ok": update_result.ok,
                        "lead_id": lead_id,
                        "city_id": city_id,
                    }
                )

        log.info(
            "node_identify_city_matched",
            lead_id=lead_id,
            city_id=city_id,
            city_name=city_name,
        )
        return dict(  # type: ignore[return-value]
            state,
            city_id=city_id,
            city_name=city_name,
            messages=messages,
            tool_results=tool_results,
            errors=errors,
        )

    # ------------------------------------------------------------------
    # Cenário 2 — Match baixo: pedir confirmação com alternativas
    # ------------------------------------------------------------------
    confirmation_msg = _build_confirmation_message(result)
    messages.append({"role": "assistant", "content": confirmation_msg})

    log.info(
        "node_identify_city_low_confidence",
        lead_id=lead_id,
        confidence=result.confidence,
        alternatives_count=len(result.alternatives),
    )
    return dict(  # type: ignore[return-value]
        state,
        messages=messages,
        tool_results=tool_results,
        errors=errors,
        # Seta `reply` para que `send_response` consolide no payload final.
        # Sem isso, a mensagem de pedir confirmação só vai pro histórico e
        # o cliente nunca recebe a pergunta — bug observado no playground 2026-05-21.
        reply=confirmation_msg,
    )


# ---------------------------------------------------------------------------
# Helpers privados
# ---------------------------------------------------------------------------


def _extract_last_user_message(messages: list[dict[str, Any]]) -> str:
    """Retorna o conteúdo da última mensagem com role=='user'.

    Varre de trás para frente; retorna string vazia se não encontrar.
    """
    for msg in reversed(messages):
        if msg.get("role") == "user":
            content = msg.get("content", "")
            return str(content) if content is not None else ""
    return ""


def _build_confirmation_message(result: IdentifyCityResult) -> str:
    """Compõe a mensagem de confirmação com a lista de alternativas."""
    if not result.alternatives:
        return _MSG_CONFIRM_NO_ALTS

    lines: list[str] = []
    for i, alt in enumerate(result.alternatives, start=1):
        lines.append(f"  {i}. {alt.city_name}")

    return _MSG_CONFIRM_WITH_ALTS.format(alternatives_list="\n".join(lines))


async def _update_lead_city(
    lead_id: str,
    city_id: str,
) -> UpdateLeadProfileResult | None:
    """Chama update_lead_profile para persistir city_id no lead.

    Erros são absorvidos (logged) — a cidade já está gravada no estado;
    a falha de persistência não deve interromper o fluxo do cliente.
    """
    try:
        result: UpdateLeadProfileResult = await tool_update_lead_profile.ainvoke(
            {"lead_id": lead_id, "city_id": city_id}
        )
        return result
    except Exception as exc:  # broad catch: tool failure must not crash the node
        log.error(
            "node_identify_city_update_lead_error",
            lead_id=lead_id,
            city_id=city_id,
            error=type(exc).__name__,
        )
        return None
