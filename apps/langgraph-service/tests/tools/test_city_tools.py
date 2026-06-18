"""Testes unitários para identify_city (city_tools.py).

Cobre 3 cenários de confidence conforme doc 06 §7.2:
  1. Match alto (confidence >= 0.85) → matched=True, city_id preenchido.
  2. Match baixo (confidence < 0.85) → matched=False, alternatives retornadas.
  3. Cidade fora da área atendida → matched=False, out_of_service=True.

O backend nunca é chamado de verdade — respx intercepta todas as chamadas HTTP.
"""
from __future__ import annotations

import httpx
import pytest
import respx

from app.config import settings
from app.tools.city_tools import CityAlternative, IdentifyCityResult, identify_city

# F16-S38: organization_id obrigatorio pelo InternalIdentifyCityBodySchema
_ORG_ID = "576a8121-838a-4904-b6bb-574648d9c32b"


def _url() -> str:
    """Monta a URL completa do endpoint de identificação de cidade."""
    raw = str(settings.backend_internal_url)
    base = raw if raw.endswith("/") else f"{raw}/"
    return f"{base}internal/cities/identify"


# ---------------------------------------------------------------------------
# Cenário 1 — Match alto (confidence >= 0.85)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_identify_city_high_confidence_match() -> None:
    """Quando o backend retorna confidence >= 0.85, matched deve ser True."""
    url = _url()
    backend_response = {
        "city_id": "uuid-porto-velho",
        "city_name": "Porto Velho",
        "matched": True,
        "confidence": 0.97,
        "out_of_service": False,
        "alternatives": [],
    }

    with respx.mock:
        route = respx.post(url).mock(return_value=httpx.Response(200, json=backend_response))
        result = await identify_city("porto velho", organization_id=_ORG_ID, lead_id="lead-uuid-1")

    assert route.called
    assert isinstance(result, IdentifyCityResult)
    assert result.matched is True
    assert result.city_id == "uuid-porto-velho"
    assert result.city_name == "Porto Velho"
    assert result.confidence == 0.97
    assert result.out_of_service is False
    assert result.alternatives == []


@pytest.mark.asyncio()
async def test_identify_city_sends_internal_token() -> None:
    """X-Internal-Token deve ser enviado em toda chamada."""
    url = _url()
    backend_response = {
        "city_id": "uuid-ariquemes",
        "city_name": "Ariquemes",
        "matched": True,
        "confidence": 0.92,
        "out_of_service": False,
        "alternatives": [],
    }

    with respx.mock:
        route = respx.post(url).mock(return_value=httpx.Response(200, json=backend_response))
        await identify_city("ariquemes", organization_id=_ORG_ID)

    token = route.calls.last.request.headers.get("x-internal-token")
    assert token == settings.internal_token.get_secret_value()


@pytest.mark.asyncio()
async def test_identify_city_without_lead_id_excludes_field() -> None:
    """Quando lead_id é None, o campo NÃO deve aparecer no payload enviado."""
    url = _url()
    backend_response = {
        "city_id": "uuid-jaru",
        "city_name": "Jaru",
        "matched": True,
        "confidence": 0.88,
        "out_of_service": False,
        "alternatives": [],
    }

    with respx.mock:
        route = respx.post(url).mock(return_value=httpx.Response(200, json=backend_response))
        result = await identify_city("jaru", organization_id=_ORG_ID)

    import json

    sent_body = json.loads(route.calls.last.request.content)
    assert "lead_id" not in sent_body
    assert sent_body["city_text"] == "jaru"
    assert sent_body["organization_id"] == _ORG_ID
    assert result.matched is True


# ---------------------------------------------------------------------------
# Cenário 2 — Match baixo (confidence < 0.85) — retorna alternatives
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_identify_city_low_confidence_returns_alternatives() -> None:
    """Quando confidence < 0.85, matched=False e alternatives devem ser retornadas."""
    url = _url()
    backend_response = {
        "city_id": None,
        "city_name": None,
        "matched": False,
        "confidence": 0.62,
        "out_of_service": False,
        "alternatives": [
            {"city_id": "uuid-cacoal", "city_name": "Cacoal", "confidence": 0.62},
            {"city_id": "uuid-cacaual", "city_name": "Cacaulândia", "confidence": 0.54},
            {"city_id": "uuid-cabixi", "city_name": "Cabixi", "confidence": 0.41},
        ],
    }

    with respx.mock:
        respx.post(url).mock(return_value=httpx.Response(200, json=backend_response))
        result = await identify_city("cacol", organization_id=_ORG_ID, lead_id="lead-uuid-2")

    assert result.matched is False
    assert result.city_id is None
    assert result.city_name is None
    assert result.confidence == 0.62
    assert result.out_of_service is False
    assert len(result.alternatives) == 3
    assert all(isinstance(a, CityAlternative) for a in result.alternatives)
    assert result.alternatives[0].city_name == "Cacoal"
    assert result.alternatives[0].confidence == 0.62


@pytest.mark.asyncio()
async def test_identify_city_low_confidence_empty_alternatives() -> None:
    """matched=False com alternatives vazia deve ser aceito (sem erro de validação)."""
    url = _url()
    backend_response = {
        "city_id": None,
        "city_name": None,
        "matched": False,
        "confidence": 0.20,
        "out_of_service": False,
        "alternatives": [],
    }

    with respx.mock:
        respx.post(url).mock(return_value=httpx.Response(200, json=backend_response))
        result = await identify_city("xyzabc", organization_id=_ORG_ID)

    assert result.matched is False
    assert result.alternatives == []


# ---------------------------------------------------------------------------
# Cenário 3 — Cidade fora da área atendida (out_of_service=True)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_identify_city_out_of_service() -> None:
    """Cidade fora da área atendida retorna matched=False, out_of_service=True."""
    url = _url()
    backend_response = {
        "city_id": "uuid-sao-paulo",
        "city_name": "São Paulo",
        "matched": False,
        "confidence": 0.99,
        "out_of_service": True,
        "alternatives": [],
    }

    with respx.mock:
        respx.post(url).mock(return_value=httpx.Response(200, json=backend_response))
        result = await identify_city("são paulo", organization_id=_ORG_ID, lead_id="lead-uuid-3")

    assert result.matched is False
    assert result.out_of_service is True
    # city_id pode vir preenchido mesmo quando out_of_service (backend identifica mas não atende)
    assert result.city_id == "uuid-sao-paulo"
    assert result.city_name == "São Paulo"
    assert result.alternatives == []


# ---------------------------------------------------------------------------
# Tratamento de erros HTTP
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_identify_city_raises_on_backend_error() -> None:
    """Deve propagar HTTPStatusError quando o backend retorna 5xx."""
    url = _url()

    with respx.mock:
        respx.post(url).mock(
            side_effect=[
                httpx.Response(500, json={"error": "internal server error"}),
                httpx.Response(500, json={"error": "internal server error"}),
            ]
        )
        with pytest.raises(httpx.HTTPStatusError) as exc_info:
            await identify_city("porto velho", organization_id=_ORG_ID)

    assert exc_info.value.response.status_code == 500


@pytest.mark.asyncio()
async def test_identify_city_raises_on_timeout() -> None:
    """Deve propagar TimeoutException quando o backend não responde."""
    url = _url()

    with respx.mock:
        respx.post(url).mock(side_effect=httpx.ReadTimeout("timed out", request=None))  # type: ignore[arg-type]
        with pytest.raises(httpx.TimeoutException):
            await identify_city("porto velho", organization_id=_ORG_ID)
