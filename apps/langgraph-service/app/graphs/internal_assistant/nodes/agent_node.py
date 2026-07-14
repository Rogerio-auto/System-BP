"""No principal do grafo internal_assistant (F6-S07).

Loop de tool-calling read-only com DLP. Principal threaded do state.
LGPD s17/s8.4: DLP=True obrigatorio. Nenhum PII bruto ao LLM.
"""
from __future__ import annotations

import json
import time
from typing import Any, Literal

import structlog

from app.graphs.internal_assistant.state import (
    Block,
    BlockRef,
    BlockType,
    HistoryTurn,
    InternalAssistantState,
    Principal,
)
from app.llm.factory import for_role, get_gateway
from app.prompts.loader import PromptNotFoundError, load_active_prompt
from app.tools.assistant_tools import (
    build_assistant_tool_schemas,
    call_analysis_status,
    call_billing_snapshot,
    call_find_lead,
    call_funnel_metrics,
    call_lead_count,
    call_summarize_lead_conversation,
)

log: structlog.stdlib.BoundLogger = structlog.get_logger(__name__)

_PROMPT_KEY = "internal_assistant"
_MODEL_ROLE: Literal["reasoner"] = "reasoner"
_DEFAULT_TEMPERATURE = 0.2
_DEFAULT_MAX_TOKENS = 1024

#: Cap de tool-calls por turno para evitar loop custoso
MAX_TOOL_CALLS_PER_TURN: int = 6

#: Cap defensivo de turnos de historico incluidos nas mensagens do LLM
#: (o Node/endpoint ja capam em 10, mas o node nunca confia so no upstream).
MAX_HISTORY_TURNS: int = 10

#: Mapeamento tool -> tipo de bloco (F6-S20). 1:1 com as tools que devolvem
#: dado de cliente pronto para exibicao. `find_lead` fica DE FORA de proposito:
#: devolve uma LISTA de candidatos (referencia ambigua -- nao ha um lead_id
#: unico e determinista para o `ref`), e serve apenas para o LLM resolver o
#: lead_id que sera usado numa tool call subsequente (essa sim vira bloco).
_TOOL_TO_BLOCK_TYPE: dict[str, BlockType] = {
    "get_funnel_metrics": "funnel_metrics",
    "get_lead_count": "lead_count",
    "get_analysis_status": "analysis_status",
    "get_billing_snapshot": "billing",
    "summarize_lead_conversation": "lead_summary",
}


def _build_block_ref(tool_args: dict[str, Any], tool_result: dict[str, Any]) -> BlockRef:
    """Deriva o `ref` de um bloco a partir dos IDs da tool call (arg ou resultado).

    Determinista, NUNCA heuristico sobre texto (DPIA R5 -- rejeita nivel B).
    Sem lead_id na chamada (ex.: metricas agregadas) -> ref kind='none'.
    """
    lead_id = tool_args.get("lead_id") or tool_result.get("lead_id")
    if isinstance(lead_id, str) and lead_id:
        return {"kind": "lead", "lead_id": lead_id}
    return {"kind": "none"}


async def _dispatch_tool(
    tool_name: str,
    tool_args: dict[str, Any],
    principal: Any,
) -> str:
    "Executa a tool e retorna resultado JSON. billing nao aceita range."
    city_ids: list[str] | None = tool_args.get("city_ids") or None
    try:
        if tool_name == "get_funnel_metrics":
            result = await call_funnel_metrics(
                principal=principal,
                range_value=tool_args.get("range", "last30d"),
                city_ids=city_ids,
            )
        elif tool_name == "get_lead_count":
            result = await call_lead_count(
                principal=principal,
                range_value=tool_args.get("range", "last30d"),
                city_ids=city_ids,
            )
        elif tool_name == "get_analysis_status":
            result = await call_analysis_status(
                principal=principal,
                lead_id=tool_args["lead_id"],
            )
        elif tool_name == "get_billing_snapshot":
            # billing-upcoming NAO aceita range (contrato F6-S06 M-1)
            result = await call_billing_snapshot(
                principal=principal,
                city_ids=city_ids,
            )
        elif tool_name == "find_lead":
            result = await call_find_lead(
                principal=principal,
                name=tool_args.get("name", ""),
            )
        elif tool_name == "summarize_lead_conversation":
            result = await call_summarize_lead_conversation(
                principal=principal,
                lead_id=tool_args["lead_id"],
            )
        else:
            return json.dumps({"error": f"tool desconhecida: {tool_name}"})
        return json.dumps(result, ensure_ascii=False)
    except Exception as exc:
        log.error(
            "internal_assistant_tool_error",
            tool=tool_name,
            error_type=type(exc).__name__,
        )
        return json.dumps({"error": type(exc).__name__, "message": "tool execution failed"})


async def agent_node(state: InternalAssistantState) -> dict[str, Any]:
    """No de tool-calling do copiloto interno."""
    start = time.monotonic()
    principal: Principal = state["principal"]
    organization_id: str = state.get("organization_id", principal["organization_id"])
    question: str = state.get("question", "")
    errors: list[dict[str, Any]] = list(state.get("errors", []))
    sources: list[str] = []
    if not question:
        return {
            "narrative": "Nenhuma pergunta fornecida.",
            "blocks": [],
            "sources": [],
            "errors": errors,
            "metadata": {},
        }
    try:
        active_prompt = await load_active_prompt(_PROMPT_KEY)
        system_prompt: str = active_prompt.body.strip()
        eff_temperature: float = (
            active_prompt.temperature
            if active_prompt.temperature is not None
            else _DEFAULT_TEMPERATURE
        )
        eff_max_tokens: int = (
            active_prompt.max_tokens
            if active_prompt.max_tokens is not None
            else _DEFAULT_MAX_TOKENS
        )
        model_override: str | None = active_prompt.model_recommended
    except PromptNotFoundError:
        log.warning(
            "internal_assistant_prompt_not_found",
            key=_PROMPT_KEY,
            organization_id=organization_id,
        )
        errors.append({"node": "agent_node", "error": "PROMPT_NOT_FOUND"})
        return {
            "narrative": "Copiloto indisponivel (prompt nao configurado).",
            "blocks": [],
            "sources": [],
            "errors": errors,
            "metadata": {"prompt_key": _PROMPT_KEY},
        }
    gateway = get_gateway()
    model: str = model_override if model_override else for_role(_MODEL_ROLE)
    tools = build_assistant_tool_schemas()
    # Truncamento defensivo: mesmo que o Node/endpoint ja capem em 10 turnos,
    # o node nunca confia apenas no upstream. Historico entra ENTRE o system
    # prompt e a pergunta atual -- dlp=True (abaixo) redige PII de TODAS as
    # mensagens antes do OpenRouter, inclusive o historico.
    history: list[HistoryTurn] = list(state.get("history") or [])[-MAX_HISTORY_TURNS:]
    history_messages: list[dict[str, Any]] = [
        {"role": turn["role"], "content": turn["content"]} for turn in history
    ]
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system_prompt},
        *history_messages,
        {"role": "user", "content": question},
    ]
    tool_call_count = 0
    narrative = ""
    blocks: list[Block] = []
    for _iteration in range(MAX_TOOL_CALLS_PER_TURN + 1):
        resp = await gateway.complete(
            model=model,
            messages=messages,
            tools=tools,
            temperature=eff_temperature,
            max_tokens=eff_max_tokens,
            metadata={
                "node": "internal_assistant.agent_node",
                "organization_id": organization_id,
                "user_id": principal["user_id"],
            },
            conversation_id=organization_id,
            dlp=True,
        )
        # Tool calls vem em resp.raw (padrao da integracao OpenRouter)
        raw_choices = resp.raw.get("choices", [])
        raw_msg = raw_choices[0].get("message", {}) if raw_choices else {}
        tool_calls: list[dict[str, Any]] = raw_msg.get("tool_calls") or []
        if not tool_calls:
            narrative = resp.content or ""
            messages.append({"role": "assistant", "content": narrative})
            break
        # Cap de operacoes: checado ANTES de appender a mensagem com tool_calls.
        # Assim o historico nunca termina com tool_calls pendentes (estado invalido
        # no formato OpenAI/OpenRouter), e devolvemos uma resposta graciosa em vez de
        # string vazia (o provider retorna content=None quando finish_reason=tool_calls).
        if tool_call_count >= MAX_TOOL_CALLS_PER_TURN:
            log.warning(
                "internal_assistant_max_tool_calls",
                count=tool_call_count,
                organization_id=organization_id,
            )
            narrative = resp.content or (
                "Nao consegui concluir a consulta agora (limite de operacoes atingido). "
                "Tente reformular a pergunta de forma mais especifica."
            )
            messages.append({"role": "assistant", "content": narrative})
            break
        messages.append({
            "role": "assistant",
            "content": resp.content or None,
            "tool_calls": tool_calls,
        })
        # Executa TODAS as tools deste batch (o cap gateia turnos de LLM, nao tools
        # dentro de um mesmo turno) -> toda tool_calls appendada recebe seu tool result.
        for tc in tool_calls:
            tool_name: str = tc.get("function", {}).get("name", "")
            tool_args_raw: str = tc.get("function", {}).get("arguments", "{}")
            tool_call_id: str = tc.get("id", f"call_{tool_call_count}")
            try:
                tool_args = json.loads(tool_args_raw)
            except json.JSONDecodeError:
                tool_args = {}
            log.info(
                "internal_assistant_tool_call",
                tool=tool_name,
                organization_id=organization_id,
            )
            tool_result = await _dispatch_tool(tool_name, tool_args, principal)
            tool_call_count += 1
            try:
                tool_result_parsed = json.loads(tool_result)
                if isinstance(tool_result_parsed, dict) and "error" not in tool_result_parsed:
                    sources.append(tool_name)
                    block_type = _TOOL_TO_BLOCK_TYPE.get(tool_name)
                    if block_type is not None:
                        blocks.append({
                            "type": block_type,
                            "ref": _build_block_ref(tool_args, tool_result_parsed),
                            "value": tool_result_parsed,
                        })
                elif isinstance(tool_result_parsed, dict):
                    errors.append({
                        "node": "agent_node",
                        "tool": tool_name,
                        "error": tool_result_parsed.get("error", ""),
                    })
                else:
                    sources.append(tool_name)
            except json.JSONDecodeError:
                sources.append(tool_name)
            messages.append({
                "role": "tool",
                "tool_call_id": tool_call_id,
                "content": tool_result,
            })
    else:
        for msg in reversed(messages):
            if msg.get("role") == "assistant" and msg.get("content"):
                narrative = str(msg["content"])
                break
    latency_ms = round((time.monotonic() - start) * 1000, 1)
    log.info(
        "internal_assistant_done",
        organization_id=organization_id,
        user_id=principal["user_id"],
        tool_calls=tool_call_count,
        blocks_count=len(blocks),
        latency_ms=latency_ms,
    )
    return {
        "narrative": narrative,
        "blocks": blocks,
        "sources": list(dict.fromkeys(sources)),
        "errors": errors,
        "messages": messages,
        "metadata": {
            "model": model,
            "prompt_key": _PROMPT_KEY,
            "tool_call_count": tool_call_count,
            "latency_ms": latency_ms,
        },
    }


__all__ = ["MAX_TOOL_CALLS_PER_TURN", "agent_node"]
