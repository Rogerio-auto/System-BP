from __future__ import annotations

import contextlib

import httpx
import pytest
import respx

from app.config import settings
from app.tools.leads_tools import QualifyLeadError, QualifyLeadSuccess, qualify_lead


def _base() -> str:
    raw = str(settings.backend_internal_url)
    return raw if raw.endswith("/") else f"{raw}/"


def _flag_url() -> str:
    return f"{_base()}internal/feature-flags/check"


def _qualify_url(lead_id: str) -> str:
    return f"{_base()}internal/leads/{lead_id}/qualify"


_LEAD_ID = "aaaaaaaa-0000-0000-0000-000000000001"
_ORG_ID = "bbbbbbbb-0000-0000-0000-000000000001"
_FLAG_KEY = "internal_assistant.actions.enabled"
_FLAG_ON: dict = {"key": _FLAG_KEY, "status": "enabled", "enabled": True}
_FLAG_OFF: dict = {"key": _FLAG_KEY, "status": "disabled", "enabled": False}
_QUALIFY_OK: dict = {
    "lead_id": _LEAD_ID,
    "previous_status": "new",
    "current_status": "qualifying",
    "card_id": "cccccccc-0000-0000-0000-000000000001",
    "stage_id": "dddddddd-0000-0000-0000-000000000001",
    "canonical_role": "pre_atendimento",
}


@pytest.mark.asyncio()
async def test_qualify_lead_success() -> None:
    with respx.mock:
        flag_route = respx.post(_flag_url()).mock(
            return_value=httpx.Response(200, json=_FLAG_ON)
        )
        qualify_route = respx.post(_qualify_url(_LEAD_ID)).mock(
            return_value=httpx.Response(200, json=_QUALIFY_OK)
        )
        result = await qualify_lead.ainvoke(
            {"reason": "dossie ok", "lead_id": _LEAD_ID, "organization_id": _ORG_ID}
        )
    assert flag_route.called
    assert qualify_route.called
    assert isinstance(result, QualifyLeadSuccess)
    assert result.ok is True
    assert result.lead_id == _LEAD_ID
    assert result.previous_status == "new"
    assert result.current_status == "qualifying"
    assert result.canonical_role == "pre_atendimento"


@pytest.mark.asyncio()
async def test_qualify_lead_already_qualifying() -> None:
    body = {**_QUALIFY_OK, "previous_status": "qualifying", "current_status": "qualifying"}
    with respx.mock:
        respx.post(_flag_url()).mock(return_value=httpx.Response(200, json=_FLAG_ON))
        respx.post(_qualify_url(_LEAD_ID)).mock(return_value=httpx.Response(200, json=body))
        result = await qualify_lead.ainvoke({"lead_id": _LEAD_ID, "organization_id": _ORG_ID})
    assert isinstance(result, QualifyLeadSuccess)
    assert result.current_status == "qualifying"


@pytest.mark.asyncio()
async def test_qualify_lead_not_found() -> None:
    with respx.mock:
        respx.post(_flag_url()).mock(return_value=httpx.Response(200, json=_FLAG_ON))
        respx.post(_qualify_url(_LEAD_ID)).mock(
            return_value=httpx.Response(404, json={"error": "NOT_FOUND"})
        )
        result = await qualify_lead.ainvoke({"lead_id": _LEAD_ID, "organization_id": _ORG_ID})
    assert isinstance(result, QualifyLeadError)
    assert result.error_code == "LEAD_NOT_FOUND"


@pytest.mark.asyncio()
async def test_qualify_lead_feature_disabled() -> None:
    with respx.mock:
        respx.post(_flag_url()).mock(return_value=httpx.Response(200, json=_FLAG_OFF))
        qualify_route = respx.post(_qualify_url(_LEAD_ID)).mock(
            return_value=httpx.Response(200, json=_QUALIFY_OK)
        )
        result = await qualify_lead.ainvoke({"lead_id": _LEAD_ID, "organization_id": _ORG_ID})
    assert not qualify_route.called
    assert isinstance(result, QualifyLeadError)
    assert result.error_code == "FEATURE_DISABLED"


@pytest.mark.asyncio()
async def test_qualify_lead_flag_check_error_fail_closed() -> None:
    with respx.mock:
        respx.post(_flag_url()).mock(
            return_value=httpx.Response(500, json={"error": "internal"})
        )
        qualify_route = respx.post(_qualify_url(_LEAD_ID)).mock(
            return_value=httpx.Response(200, json=_QUALIFY_OK)
        )
        result = await qualify_lead.ainvoke({"lead_id": _LEAD_ID, "organization_id": _ORG_ID})
    assert not qualify_route.called
    assert isinstance(result, QualifyLeadError)
    assert result.error_code == "FEATURE_DISABLED"


@pytest.mark.asyncio()
async def test_qualify_lead_missing_lead_id() -> None:
    with respx.mock:
        respx.post(_flag_url()).mock(return_value=httpx.Response(200, json=_FLAG_ON))
        qualify_route = respx.post(_qualify_url("")).mock(
            return_value=httpx.Response(200, json=_QUALIFY_OK)
        )
        result = await qualify_lead.ainvoke({"lead_id": "", "organization_id": _ORG_ID})
    assert not qualify_route.called
    assert isinstance(result, QualifyLeadError)
    assert result.error_code == "MISSING_LEAD_ID"


@pytest.mark.asyncio()
async def test_qualify_lead_backend_5xx() -> None:
    with respx.mock:
        respx.post(_flag_url()).mock(return_value=httpx.Response(200, json=_FLAG_ON))
        respx.post(_qualify_url(_LEAD_ID)).mock(
            return_value=httpx.Response(503, text="down")
        )
        result = await qualify_lead.ainvoke({"lead_id": _LEAD_ID, "organization_id": _ORG_ID})
    assert isinstance(result, QualifyLeadError)
    assert result.error_code == "BACKEND_UNAVAILABLE"
    assert "503" in result.message


@pytest.mark.asyncio()
async def test_qualify_lead_timeout() -> None:
    with respx.mock:
        respx.post(_flag_url()).mock(return_value=httpx.Response(200, json=_FLAG_ON))
        respx.post(_qualify_url(_LEAD_ID)).mock(
            side_effect=httpx.ReadTimeout("timed out", request=None)
        )
        result = await qualify_lead.ainvoke({"lead_id": _LEAD_ID, "organization_id": _ORG_ID})
    assert isinstance(result, QualifyLeadError)
    assert result.error_code == "BACKEND_UNAVAILABLE"


@pytest.mark.asyncio()
async def test_reason_not_sent_to_qualify_endpoint() -> None:
    import json as _json
    captured: dict = {}
    def capture(req: httpx.Request) -> httpx.Response:
        with contextlib.suppress(Exception):
            captured.update(_json.loads(req.content))
        return httpx.Response(200, json=_QUALIFY_OK)
    with respx.mock:
        respx.post(_flag_url()).mock(return_value=httpx.Response(200, json=_FLAG_ON))
        respx.post(_qualify_url(_LEAD_ID)).mock(side_effect=capture)
        await qualify_lead.ainvoke(
            {"reason": "dossie ok", "lead_id": _LEAD_ID, "organization_id": _ORG_ID}
        )
    assert "reason" not in captured


@pytest.mark.asyncio()
async def test_qualify_endpoint_has_internal_token() -> None:
    with respx.mock:
        respx.post(_flag_url()).mock(return_value=httpx.Response(200, json=_FLAG_ON))
        qualify_route = respx.post(_qualify_url(_LEAD_ID)).mock(
            return_value=httpx.Response(200, json=_QUALIFY_OK)
        )
        await qualify_lead.ainvoke({"lead_id": _LEAD_ID, "organization_id": _ORG_ID})
    token = qualify_route.calls.last.request.headers.get("x-internal-token")
    assert token == settings.internal_token.get_secret_value()


@pytest.mark.asyncio()
async def test_flag_check_has_internal_token() -> None:
    with respx.mock:
        flag_route = respx.post(_flag_url()).mock(
            return_value=httpx.Response(200, json=_FLAG_ON)
        )
        respx.post(_qualify_url(_LEAD_ID)).mock(
            return_value=httpx.Response(200, json=_QUALIFY_OK)
        )
        await qualify_lead.ainvoke({"lead_id": _LEAD_ID, "organization_id": _ORG_ID})
    token = flag_route.calls.last.request.headers.get("x-internal-token")
    assert token == settings.internal_token.get_secret_value()


@pytest.mark.asyncio()
async def test_qualify_sends_organization_id_in_body() -> None:
    import json as _json
    captured: dict = {}
    def capture(req: httpx.Request) -> httpx.Response:
        with contextlib.suppress(Exception):
            captured.update(_json.loads(req.content))
        return httpx.Response(200, json=_QUALIFY_OK)
    with respx.mock:
        respx.post(_flag_url()).mock(return_value=httpx.Response(200, json=_FLAG_ON))
        respx.post(_qualify_url(_LEAD_ID)).mock(side_effect=capture)
        await qualify_lead.ainvoke({"lead_id": _LEAD_ID, "organization_id": _ORG_ID})
    assert captured.get("organization_id") == _ORG_ID
