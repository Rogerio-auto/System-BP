"""Testes para o grafo internal_assistant (F6-S07)."""
from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.graphs.internal_assistant.nodes.agent_node import agent_node
from app.graphs.internal_assistant.state import InternalAssistantState, Principal
from app.llm.gateway import LLMResponse, TokenUsage
from app.tools.assistant_tools import (
    call_billing_snapshot,
)

ORG_ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479"
USER_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"


def _make_principal() -> Principal:
    return {
        "user_id": USER_ID,
        "organization_id": ORG_ID,
        "permissions": ["assistant:query"],
        "city_scope_ids": None,
    }


def _make_state(question: str = "Quantos leads temos?") -> InternalAssistantState:
    return {"principal": _make_principal(), "organization_id": ORG_ID, "question": question}


def _llm_resp(content: str = "Resposta gerada.", tool_calls: list | None = None) -> LLMResponse:
    raw: dict[str, Any] = {}
    if tool_calls:
        raw["choices"] = [{"message": {"tool_calls": tool_calls}}]
    return LLMResponse(content=content, model="test-model", usage=TokenUsage(), raw=raw)


# ---------------------------------------------------------------------------
# Testes de call_billing_snapshot -- contrato: sem range (M-1 de F6-S06)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_call_billing_snapshot_no_range():
    """billing-upcoming NAO deve enviar campo range no body (contrato M-1)."""
    captured: list = []
    async def mock_post(path, **kw):
        captured.append({"path": path, "body": kw.get("json", {})})
        return {"items": [], "snapshotLabel": "2026-07"}
    with patch("app.tools.assistant_tools.InternalApiClient") as mock_cls:
        mock_instance = AsyncMock()
        mock_instance.post = AsyncMock(side_effect=mock_post)
        mock_cls.return_value = mock_instance
        await call_billing_snapshot(principal=_make_principal(), city_ids=None)
    assert len(captured) == 1
    body = captured[0]["body"]
    assert "range" not in body.get("query", {})
    assert "query" not in body, "query deve ser omitido quando city_ids=None"
    assert body["principal"]["organization_id"] == ORG_ID


@pytest.mark.asyncio
async def test_call_billing_snapshot_with_city_ids():
    """billing-upcoming com city_ids: body deve ter query.cityIds mas NAO range."""
    captured: list = []
    async def mock_post(path, **kw):
        captured.append({"path": path, "body": kw.get("json", {})})
        return {"items": [], "snapshotLabel": "2026-07"}
    city_ids = ["city-uuid-1", "city-uuid-2"]
    with patch("app.tools.assistant_tools.InternalApiClient") as mock_cls:
        mock_instance = AsyncMock()
        mock_instance.post = AsyncMock(side_effect=mock_post)
        mock_cls.return_value = mock_instance
        await call_billing_snapshot(principal=_make_principal(), city_ids=city_ids)
    body = captured[0]["body"]
    assert "range" not in body.get("query", {})
    assert body["query"]["cityIds"] == city_ids


# ---------------------------------------------------------------------------
# Testes do agent_node
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_agent_node_no_tool_calls():
    """LLM responde sem tool calls: retorna answer diretamente."""
    mock_prompt = MagicMock()
    mock_prompt.body = "Voce e o copiloto."
    mock_prompt.temperature = None
    mock_prompt.max_tokens = None
    mock_prompt.model_recommended = None
    mock_gw = MagicMock()
    mock_gw.complete = AsyncMock(return_value=_llm_resp("Temos 42 leads."))
    lp = "app.graphs.internal_assistant.nodes.agent_node.load_active_prompt"
    gw = "app.graphs.internal_assistant.nodes.agent_node.get_gateway"
    with patch(lp, new=AsyncMock(return_value=mock_prompt)), patch(gw, return_value=mock_gw):
        result = await agent_node(_make_state())
    assert result["answer"] == "Temos 42 leads."
    assert result["sources"] == []
    assert result["errors"] == []


@pytest.mark.asyncio
async def test_agent_node_empty_question():
    """question vazia: retorna fallback sem chamar LLM."""
    result = await agent_node(_make_state(question=""))
    assert "Nenhuma pergunta" in result["answer"]
    assert result["sources"] == []


@pytest.mark.asyncio
async def test_agent_node_prompt_not_found():
    """PromptNotFoundError: retorna answer de fallback sem chamar LLM."""
    from app.prompts.loader import PromptNotFoundError
    lp = "app.graphs.internal_assistant.nodes.agent_node.load_active_prompt"
    err = PromptNotFoundError("internal_assistant")
    with patch(lp, new=AsyncMock(side_effect=err)):
        result = await agent_node(_make_state())
    assert "Copiloto indisponivel" in result["answer"]
    assert result["sources"] == []
    assert any(e.get("error") == "PROMPT_NOT_FOUND" for e in result["errors"])


@pytest.mark.asyncio
async def test_agent_node_tool_call_principal_threaded():
    """Principal do state e threaded para tool calls (nunca inferido)."""
    import json as _json
    tc = {
        "id": "call_1",
        "function": {
            "name": "get_lead_count",
            "arguments": _json.dumps({"range": "last30d"}),
        },
    }
    calls: list = []
    async def mock_lead_count(principal, range_value, city_ids=None, client=None):
        calls.append({"principal": principal})
        return {"total": 99}
    mock_prompt = MagicMock()
    mock_prompt.body = "Voce e o copiloto."
    mock_prompt.temperature = None
    mock_prompt.max_tokens = None
    mock_prompt.model_recommended = None
    mock_gw = MagicMock()
    resp_with_tc = _llm_resp("", tool_calls=[tc])
    resp_final = _llm_resp("Ha 99 leads.")
    mock_gw.complete = AsyncMock(side_effect=[resp_with_tc, resp_final])
    lp = "app.graphs.internal_assistant.nodes.agent_node.load_active_prompt"
    gw = "app.graphs.internal_assistant.nodes.agent_node.get_gateway"
    lc = "app.graphs.internal_assistant.nodes.agent_node.call_lead_count"
    with (
        patch(lp, new=AsyncMock(return_value=mock_prompt)),
        patch(gw, return_value=mock_gw),
        patch(lc, side_effect=mock_lead_count),
    ):
        result = await agent_node(_make_state())
    assert len(calls) == 1, "call_lead_count deve ser chamada 1x"
    assert calls[0]["principal"]["organization_id"] == ORG_ID
    assert calls[0]["principal"]["user_id"] == USER_ID
    assert result["answer"] == "Ha 99 leads."


@pytest.mark.asyncio
async def test_agent_node_billing_dispatch_no_range():
    """M-1: mesmo que o LLM envie range, _dispatch_tool ignora para billing."""
    import json as _json
    tc = {
        "id": "call_1",
        "function": {
            "name": "get_billing_snapshot",
            "arguments": _json.dumps({"range": "last30d"}),
        },
    }
    billing_calls: list = []
    async def mock_billing(principal, city_ids=None, client=None):
        billing_calls.append({"principal": principal, "city_ids": city_ids})
        return {"items": [], "snapshotLabel": "2026-07"}
    mock_prompt = MagicMock()
    mock_prompt.body = "Voce e o copiloto."
    mock_prompt.temperature = None
    mock_prompt.max_tokens = None
    mock_prompt.model_recommended = None
    mock_gw = MagicMock()
    resp_with_bs = _llm_resp("", tool_calls=[tc])
    resp_final_bs = _llm_resp("Snapshot carregado.")
    mock_gw.complete = AsyncMock(side_effect=[resp_with_bs, resp_final_bs])
    lp = "app.graphs.internal_assistant.nodes.agent_node.load_active_prompt"
    gw = "app.graphs.internal_assistant.nodes.agent_node.get_gateway"
    bs = "app.graphs.internal_assistant.nodes.agent_node.call_billing_snapshot"
    with (
        patch(lp, new=AsyncMock(return_value=mock_prompt)),
        patch(gw, return_value=mock_gw),
        patch(bs, side_effect=mock_billing),
    ):
        await agent_node(_make_state())
    assert len(billing_calls) == 1
    assert "range" not in billing_calls[0], "range nao deve ser passado para call_billing_snapshot"
