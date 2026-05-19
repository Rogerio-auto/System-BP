"""Testes unitários para simulation_tools.list_credit_products.

Cobre:
- Lista com produtos retornados pelo backend (campos mapeados corretamente).
- Lista vazia quando o backend retorna data=[].
- Fallback para lista vazia quando o backend retorna erro HTTP.
- query params corretos (organizationId, cityId) enviados ao backend.
- Sem organizationId, não envia o param (backend devolve [] graciosamente).
"""
from __future__ import annotations

import httpx
import pytest
import respx

from app.config import settings
from app.tools.simulation_tools import (
    CreditProductItem,
    ListCreditProductsInput,
    ListCreditProductsOutput,
    list_credit_products,
)


def _base(path: str) -> str:
    """Monta URL completa a partir de settings — replica lógica de _build_url."""
    raw = str(settings.backend_internal_url)
    base = raw if raw.endswith("/") else f"{raw}/"
    return f"{base}{path.lstrip('/')}"


_ENDPOINT = _base("/internal/credit-products")

_SAMPLE_PRODUCTS = [
    {
        "id": "11111111-1111-1111-1111-111111111111",
        "name": "Crédito Produtivo Solidário",
        "min_amount": "500.00",
        "max_amount": "15000.00",
        "min_term": 6,
        "max_term": 36,
        "interest_rate": "0.025000",
        "amortization_type": "price",
    },
    {
        "id": "22222222-2222-2222-2222-222222222222",
        "name": "Microcrédito Individual",
        "min_amount": "300.00",
        "max_amount": "5000.00",
        "min_term": 3,
        "max_term": 24,
        "interest_rate": "0.030000",
        "amortization_type": "sac",
    },
]


# ---------------------------------------------------------------------------
# Lista preenchida
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_list_credit_products_returns_products() -> None:
    """Deve retornar lista mapeada corretamente quando backend devolve produtos."""
    with respx.mock:
        route = respx.get(_ENDPOINT).mock(
            return_value=httpx.Response(200, json={"data": _SAMPLE_PRODUCTS})
        )

        result = await list_credit_products(
            ListCreditProductsInput(
                organization_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                city_id="bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
            )
        )

    assert isinstance(result, ListCreditProductsOutput)
    assert len(result.products) == 2

    first = result.products[0]
    assert isinstance(first, CreditProductItem)
    assert first.id == "11111111-1111-1111-1111-111111111111"
    assert first.name == "Crédito Produtivo Solidário"
    assert first.min_amount == "500.00"
    assert first.max_amount == "15000.00"
    assert first.min_term == 6
    assert first.max_term == 36
    assert first.interest_rate == "0.025000"
    assert first.amortization_type == "price"

    second = result.products[1]
    assert second.amortization_type == "sac"

    assert route.called


# ---------------------------------------------------------------------------
# Lista vazia
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_list_credit_products_empty_list() -> None:
    """Deve retornar lista vazia quando backend devolve data=[]."""
    with respx.mock:
        route = respx.get(_ENDPOINT).mock(
            return_value=httpx.Response(200, json={"data": []})
        )

        result = await list_credit_products(
            ListCreditProductsInput(
                organization_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            )
        )

    assert isinstance(result, ListCreditProductsOutput)
    assert result.products == []
    assert route.called


# ---------------------------------------------------------------------------
# Fallback em erro HTTP
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_list_credit_products_fallback_on_http_error() -> None:
    """Deve retornar lista vazia (sem levantar exceção) quando backend retorna 5xx."""
    with respx.mock:
        # Dois 500 para esgotar o retry do InternalApiClient (1 retry + original).
        respx.get(_ENDPOINT).mock(
            side_effect=[
                httpx.Response(500, json={"error": "internal server error"}),
                httpx.Response(500, json={"error": "internal server error"}),
            ]
        )

        result = await list_credit_products(
            ListCreditProductsInput(
                organization_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            )
        )

    assert isinstance(result, ListCreditProductsOutput)
    assert result.products == []


# ---------------------------------------------------------------------------
# Query params — organizationId + cityId enviados
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_list_credit_products_sends_organization_and_city_params() -> None:
    """organizationId e cityId devem aparecer na querystring enviada ao backend."""
    with respx.mock:
        route = respx.get(_ENDPOINT).mock(
            return_value=httpx.Response(200, json={"data": []})
        )

        await list_credit_products(
            ListCreditProductsInput(
                organization_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                city_id="cccccccc-cccc-cccc-cccc-cccccccccccc",
            )
        )

    assert route.called
    sent_url = str(route.calls.last.request.url)
    assert "organizationId=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" in sent_url
    assert "cityId=cccccccc-cccc-cccc-cccc-cccccccccccc" in sent_url


# ---------------------------------------------------------------------------
# Query params — sem organizationId, param não enviado
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_list_credit_products_no_org_id_omits_param() -> None:
    """Sem organization_id, o param organizationId NÃO deve aparecer na querystring."""
    with respx.mock:
        route = respx.get(_ENDPOINT).mock(
            return_value=httpx.Response(200, json={"data": []})
        )

        result = await list_credit_products(ListCreditProductsInput())

    assert route.called
    sent_url = str(route.calls.last.request.url)
    assert "organizationId" not in sent_url
    assert result.products == []


# ---------------------------------------------------------------------------
# Header X-Internal-Token enviado
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_list_credit_products_sends_internal_token() -> None:
    """X-Internal-Token deve estar presente em toda chamada."""
    with respx.mock:
        route = respx.get(_ENDPOINT).mock(
            return_value=httpx.Response(200, json={"data": []})
        )

        await list_credit_products(
            ListCreditProductsInput(
                organization_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            )
        )

    assert route.called
    sent_token = route.calls.last.request.headers.get("x-internal-token")
    assert sent_token == settings.internal_token.get_secret_value()
