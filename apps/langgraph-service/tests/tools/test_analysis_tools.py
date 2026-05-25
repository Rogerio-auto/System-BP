"""Testes unitários para analysis_tools — get_credit_analysis_history (F4-S04).

Cobre:
  1.  Sucesso: lead sem análises (items=[])
  2.  Sucesso: 1 análise em curso (status=em_analise, version_number=1)
  3.  Sucesso: múltiplas análises finalizadas
  4.  Erro: 404 → LEAD_NOT_FOUND
  5.  Erro: BACKEND_UNAVAILABLE (5xx)
  6.  Erro: BACKEND_UNAVAILABLE (timeout)
  7.  Mascaramento LGPD: campos proibidos ausentes no output (parecer_text, internal_score, etc.)
  8.  X-Internal-Token enviado em toda chamada
  9.  X-Organization-Id enviado corretamente (escopo multi-tenant)
  10. Análise com current_version_number=0 (sem parecer ainda)

DoD F4-S04: 4 cenários mínimos cobertos (sem análise, 1 em curso, múltiplas, erro 5xx).
"""
from __future__ import annotations

from datetime import datetime

import httpx
import pytest
import respx

from app.config import settings
from app.tools.analysis_tools import (
    AnalysisHistoryError,
    AnalysisHistoryOutput,
    get_credit_analysis_history,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _url(lead_id: str) -> str:
    raw = str(settings.backend_internal_url)
    base = raw if raw.endswith("/") else f"{raw}/"
    return f"{base}internal/customers/{lead_id}/credit-analyses"


_LEAD_ID = "aaaaaaaa-0000-0000-0000-000000000001"
_ORG_ID = "ffffffff-0000-0000-0000-000000000001"

_NOW_ISO = "2026-05-18T12:00:00.000Z"
_EARLIER_ISO = "2026-04-01T09:00:00.000Z"

_ANALYSIS_ID_1 = "cccccccc-0000-0000-0000-000000000001"
_ANALYSIS_ID_2 = "dddddddd-0000-0000-0000-000000000002"

_ITEM_EM_ANALISE = {
    "analysis_id": _ANALYSIS_ID_1,
    "status": "em_analise",
    "current_version_number": 1,
    "created_at": _NOW_ISO,
    "updated_at": _NOW_ISO,
}

_ITEM_APROVADO = {
    "analysis_id": _ANALYSIS_ID_2,
    "status": "aprovado",
    "current_version_number": 3,
    "created_at": _EARLIER_ISO,
    "updated_at": _EARLIER_ISO,
}

_EMPTY_RESPONSE = {"lead_id": _LEAD_ID, "items": []}

_ONE_ANALYSIS_RESPONSE = {"lead_id": _LEAD_ID, "items": [_ITEM_EM_ANALISE]}

_TWO_ANALYSES_RESPONSE = {
    "lead_id": _LEAD_ID,
    "items": [_ITEM_EM_ANALISE, _ITEM_APROVADO],
}


# ---------------------------------------------------------------------------
# 1. Sucesso: lead sem análises (items=[])
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_success_no_analyses() -> None:
    """Tool deve retornar AnalysisHistoryOutput com items vazio quando lead não tem análises."""
    with respx.mock:
        route = respx.get(_url(_LEAD_ID)).mock(
            return_value=httpx.Response(200, json=_EMPTY_RESPONSE)
        )
        result = await get_credit_analysis_history.ainvoke(
            {"lead_id": _LEAD_ID, "organization_id": _ORG_ID}
        )

    assert route.called
    assert isinstance(result, AnalysisHistoryOutput)
    assert result.lead_id == _LEAD_ID
    assert result.items == []


# ---------------------------------------------------------------------------
# 2. Sucesso: 1 análise em curso
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_success_one_analysis_em_analise() -> None:
    """Tool deve retornar 1 análise em curso com status e version_number corretos."""
    with respx.mock:
        respx.get(_url(_LEAD_ID)).mock(
            return_value=httpx.Response(200, json=_ONE_ANALYSIS_RESPONSE)
        )
        result = await get_credit_analysis_history.ainvoke(
            {"lead_id": _LEAD_ID, "organization_id": _ORG_ID}
        )

    assert isinstance(result, AnalysisHistoryOutput)
    assert len(result.items) == 1

    item = result.items[0]
    assert item.analysis_id == _ANALYSIS_ID_1
    assert item.status == "em_analise"
    assert item.current_version_number == 1
    # Verificar que created_at e updated_at são datetime válidos
    assert isinstance(item.created_at, datetime)
    assert isinstance(item.updated_at, datetime)


# ---------------------------------------------------------------------------
# 3. Sucesso: múltiplas análises finalizadas
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_success_multiple_analyses() -> None:
    """Tool deve deserializar múltiplas análises corretamente."""
    with respx.mock:
        respx.get(_url(_LEAD_ID)).mock(
            return_value=httpx.Response(200, json=_TWO_ANALYSES_RESPONSE)
        )
        result = await get_credit_analysis_history.ainvoke(
            {"lead_id": _LEAD_ID, "organization_id": _ORG_ID}
        )

    assert isinstance(result, AnalysisHistoryOutput)
    assert len(result.items) == 2

    first = result.items[0]
    second = result.items[1]

    assert first.analysis_id == _ANALYSIS_ID_1
    assert first.status == "em_analise"
    assert first.current_version_number == 1

    assert second.analysis_id == _ANALYSIS_ID_2
    assert second.status == "aprovado"
    assert second.current_version_number == 3

    # Verificar ordem (mais recente primeiro — garantido pelo backend)
    assert first.created_at >= second.created_at


# ---------------------------------------------------------------------------
# 4. Erro: 404 → LEAD_NOT_FOUND
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_error_404_lead_not_found() -> None:
    """Tool deve retornar LEAD_NOT_FOUND quando backend retorna 404."""
    with respx.mock:
        respx.get(_url(_LEAD_ID)).mock(
            return_value=httpx.Response(404, json={"message": "Lead não encontrado"})
        )
        result = await get_credit_analysis_history.ainvoke(
            {"lead_id": _LEAD_ID, "organization_id": _ORG_ID}
        )

    assert isinstance(result, AnalysisHistoryError)
    assert result.ok is False
    assert result.error_code == "LEAD_NOT_FOUND"
    assert _LEAD_ID in result.message


# ---------------------------------------------------------------------------
# 5. Erro: BACKEND_UNAVAILABLE (5xx)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_error_5xx_backend_unavailable() -> None:
    """Tool deve retornar BACKEND_UNAVAILABLE quando backend retorna 5xx."""
    with respx.mock:
        respx.get(_url(_LEAD_ID)).mock(
            return_value=httpx.Response(503, json={"error": "service unavailable"})
        )
        result = await get_credit_analysis_history.ainvoke(
            {"lead_id": _LEAD_ID, "organization_id": _ORG_ID}
        )

    assert isinstance(result, AnalysisHistoryError)
    assert result.error_code == "BACKEND_UNAVAILABLE"
    assert "503" in result.message


# ---------------------------------------------------------------------------
# 6. Erro: BACKEND_UNAVAILABLE (timeout)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_error_timeout_backend_unavailable() -> None:
    """Tool deve retornar BACKEND_UNAVAILABLE quando backend ultrapassa timeout."""
    with respx.mock:
        respx.get(_url(_LEAD_ID)).mock(
            side_effect=httpx.ReadTimeout("timed out", request=None)  # type: ignore[arg-type]
        )
        result = await get_credit_analysis_history.ainvoke(
            {"lead_id": _LEAD_ID, "organization_id": _ORG_ID}
        )

    assert isinstance(result, AnalysisHistoryError)
    assert result.error_code == "BACKEND_UNAVAILABLE"
    assert "Timeout" in result.message


# ---------------------------------------------------------------------------
# 7. Mascaramento LGPD — campos proibidos ausentes no output
#
# Teste crítico: verifica ausência de parecer_text, internal_score, etc.
# Defesa em profundidade: mesmo que o backend retornasse esses campos
# acidentalmente, o schema Pydantic os descartaria (model fields são fechados).
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_lgpd_masked_output_no_sensitive_fields() -> None:
    """Output não deve conter parecer_text, internal_score, analyst_user_id, approved_amount."""
    with respx.mock:
        respx.get(_url(_LEAD_ID)).mock(
            return_value=httpx.Response(200, json=_ONE_ANALYSIS_RESPONSE)
        )
        result = await get_credit_analysis_history.ainvoke(
            {"lead_id": _LEAD_ID, "organization_id": _ORG_ID}
        )

    assert isinstance(result, AnalysisHistoryOutput)

    # Serializar o modelo e garantir ausência de campos PII/sensíveis
    data = result.model_dump()
    forbidden_top_fields = {
        "parecer_text",
        "pendencias",
        "attachments",
        "internal_score",
        "analyst_user_id",
        "approved_amount",
        "approved_term_months",
        "approved_rate_monthly",
    }
    assert forbidden_top_fields.isdisjoint(data.keys()), (
        f"Campos sensíveis encontrados no output: {forbidden_top_fields & data.keys()}"
    )

    # Verificar em cada item individualmente
    for item_data in data.get("items", []):
        assert forbidden_top_fields.isdisjoint(item_data.keys()), (
            f"Campos sensíveis encontrados no item: {forbidden_top_fields & item_data.keys()}"
        )


# ---------------------------------------------------------------------------
# 8. X-Internal-Token enviado em toda chamada
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_sends_internal_token() -> None:
    """X-Internal-Token deve estar presente em toda chamada."""
    with respx.mock:
        route = respx.get(_url(_LEAD_ID)).mock(
            return_value=httpx.Response(200, json=_EMPTY_RESPONSE)
        )
        await get_credit_analysis_history.ainvoke(
            {"lead_id": _LEAD_ID, "organization_id": _ORG_ID}
        )

    token = route.calls.last.request.headers.get("x-internal-token")
    assert token == settings.internal_token.get_secret_value()


# ---------------------------------------------------------------------------
# 9. X-Organization-Id enviado corretamente (escopo multi-tenant)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_sends_organization_id_header() -> None:
    """X-Organization-Id deve ser enviado com o valor correto (regra inviolável #3)."""
    with respx.mock:
        route = respx.get(_url(_LEAD_ID)).mock(
            return_value=httpx.Response(200, json=_EMPTY_RESPONSE)
        )
        await get_credit_analysis_history.ainvoke(
            {"lead_id": _LEAD_ID, "organization_id": _ORG_ID}
        )

    org_id_header = route.calls.last.request.headers.get("x-organization-id")
    assert org_id_header == _ORG_ID


# ---------------------------------------------------------------------------
# 10. current_version_number=0 (análise sem parecer ainda)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_success_analysis_without_version() -> None:
    """Tool deve retornar current_version_number=0 para análise sem parecer."""
    response_body = {
        "lead_id": _LEAD_ID,
        "items": [
            {
                "analysis_id": _ANALYSIS_ID_1,
                "status": "em_analise",
                "current_version_number": 0,
                "created_at": _NOW_ISO,
                "updated_at": _NOW_ISO,
            }
        ],
    }
    with respx.mock:
        respx.get(_url(_LEAD_ID)).mock(
            return_value=httpx.Response(200, json=response_body)
        )
        result = await get_credit_analysis_history.ainvoke(
            {"lead_id": _LEAD_ID, "organization_id": _ORG_ID}
        )

    assert isinstance(result, AnalysisHistoryOutput)
    assert len(result.items) == 1
    assert result.items[0].current_version_number == 0
    assert result.items[0].status == "em_analise"


# ---------------------------------------------------------------------------
# 11. Utiliza o lead_id correto na URL
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_uses_correct_lead_id_in_url() -> None:
    """A URL da chamada deve conter o lead_id fornecido."""
    other_lead_id = "bbbbbbbb-0000-0000-0000-000000000099"
    with respx.mock:
        route = respx.get(_url(other_lead_id)).mock(
            return_value=httpx.Response(200, json={"lead_id": other_lead_id, "items": []})
        )
        result = await get_credit_analysis_history.ainvoke(
            {"lead_id": other_lead_id, "organization_id": _ORG_ID}
        )

    assert route.called
    assert isinstance(result, AnalysisHistoryOutput)
    assert result.lead_id == other_lead_id
    # URL deve conter o lead_id correto
    assert other_lead_id in str(route.calls.last.request.url)
