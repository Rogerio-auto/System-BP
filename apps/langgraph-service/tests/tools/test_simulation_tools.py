"""Testes unitários para simulation_tools.

Cobre list_credit_products (F3-S15):
- Lista com produtos retornados pelo backend (campos mapeados corretamente).
- Lista vazia quando o backend retorna data=[].
- Fallback para lista vazia quando o backend retorna erro HTTP.
- query params corretos (organizationId, cityId) enviados ao backend.
- Sem organizationId, não envia o param (backend devolve [] graciosamente).

Cobre generate_credit_simulation (F3-S16):
- Sucesso: campos mapeados, ok=True.
- Reenvio idempotente: mesma idempotency key produz mesma simulação.
- AMOUNT_OUT_OF_RANGE retornado como ok=False + error_code correto.
- TERM_OUT_OF_RANGE retornado como ok=False + error_code correto.
- NO_RULE_FOR_CITY retornado como ok=False + error_code correto.
- NO_ACTIVE_PRODUCT retornado como ok=False + error_code correto.
- Fallback gracioso em erro de infraestrutura (5xx).
- Idempotency-Key e X-Internal-Token enviados ao backend.
"""
from __future__ import annotations

import httpx
import pytest
import respx

from app.config import settings
from app.tools.simulation_tools import (
    CreditProductItem,
    GenerateCreditSimulationInput,
    GenerateCreditSimulationOutput,
    ListCreditProductsInput,
    ListCreditProductsOutput,
    SimulationErrorCode,
    _build_idempotency_key,
    generate_credit_simulation,
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


# ===========================================================================
# generate_credit_simulation (F3-S16)
# ===========================================================================

_SIM_ENDPOINT = _base("/internal/simulations")

_LEAD_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd"
_PRODUCT_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"

_SAMPLE_SIMULATION_RESPONSE = {
    "data": {
        "id": "ffffffff-ffff-ffff-ffff-ffffffffffff",
        "installmentAmount": "462.50",
        "totalAmount": "5550.00",
        "totalInterest": "550.00",
        "monthlyRate": "0.025000",
        "ruleVersion": "v3",
    }
}


# ---------------------------------------------------------------------------
# Sucesso — campos mapeados, ok=True
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_generate_credit_simulation_success() -> None:
    """Deve retornar ok=True com todos os campos mapeados corretamente."""
    with respx.mock:
        route = respx.post(_SIM_ENDPOINT).mock(
            return_value=httpx.Response(201, json=_SAMPLE_SIMULATION_RESPONSE)
        )

        result = await generate_credit_simulation(
            GenerateCreditSimulationInput(
                lead_id=_LEAD_ID,
                amount=5000.0,
                term_months=12,
                product_id=_PRODUCT_ID,
            )
        )

    assert isinstance(result, GenerateCreditSimulationOutput)
    assert result.ok is True
    assert result.simulation_id == "ffffffff-ffff-ffff-ffff-ffffffffffff"
    assert result.installment == "462.50"
    assert result.total == "5550.00"
    assert result.interest == "550.00"
    assert result.rate == "0.025000"
    assert result.rule_version == "v3"
    assert result.error_code is None
    assert result.error_message is None
    assert route.called


# ---------------------------------------------------------------------------
# Reenvio idempotente — mesma chave → mesma simulação
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_generate_credit_simulation_idempotent_resubmit() -> None:
    """Dois posts com a mesma idempotency key devem produzir a mesma simulação."""
    with respx.mock:
        route = respx.post(_SIM_ENDPOINT).mock(
            return_value=httpx.Response(201, json=_SAMPLE_SIMULATION_RESPONSE)
        )

        result1 = await generate_credit_simulation(
            GenerateCreditSimulationInput(
                lead_id=_LEAD_ID,
                amount=5000.0,
                term_months=12,
                product_id=_PRODUCT_ID,
            )
        )
        result2 = await generate_credit_simulation(
            GenerateCreditSimulationInput(
                lead_id=_LEAD_ID,
                amount=5000.0,
                term_months=12,
                product_id=_PRODUCT_ID,
            )
        )

    # Ambas as chamadas recebem a mesma simulação (backend deduplicou via key).
    assert result1.ok is True
    assert result2.ok is True
    assert result1.simulation_id == result2.simulation_id

    # As duas chamadas enviaram a mesma Idempotency-Key.
    keys_sent = [
        call.request.headers.get("idempotency-key") for call in route.calls
    ]
    assert keys_sent[0] == keys_sent[1]


# ---------------------------------------------------------------------------
# _build_idempotency_key — formato e estabilidade dentro do mesmo minuto
# ---------------------------------------------------------------------------


def test_build_idempotency_key_format() -> None:
    """Key gerada deve seguir o formato sim_<lead>_<amount>_<term>_<pid>_<bucket>."""
    key = _build_idempotency_key(
        lead_id="lead-123",
        amount=5000.0,
        term_months=12,
        product_id="prod-abc",
    )
    parts = key.split("_")
    # Prefixo "sim"
    assert parts[0] == "sim"
    # lead_id
    assert "lead-123" in key
    # amount normalizado (500000 centavos de 5000.00)
    assert "500000" in key
    # term
    assert "12" in key
    # product_id
    assert "prod-abc" in key


def test_build_idempotency_key_none_product() -> None:
    """Quando product_id é None, key deve conter 'none' no lugar do UUID."""
    key = _build_idempotency_key(
        lead_id="lead-x",
        amount=1000.0,
        term_months=6,
        product_id=None,
    )
    assert "_none_" in key


def test_build_idempotency_key_stable_within_minute() -> None:
    """Duas chamadas no mesmo minuto devem gerar a mesma key."""
    key1 = _build_idempotency_key("lead-1", 1000.0, 6, None)
    key2 = _build_idempotency_key("lead-1", 1000.0, 6, None)
    assert key1 == key2


# ---------------------------------------------------------------------------
# Erros de negócio — 422 com código específico
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
@pytest.mark.parametrize(
    ("error_code", "expected_enum"),
    [
        ("AMOUNT_OUT_OF_RANGE", SimulationErrorCode.AMOUNT_OUT_OF_RANGE),
        ("TERM_OUT_OF_RANGE", SimulationErrorCode.TERM_OUT_OF_RANGE),
        ("NO_RULE_FOR_CITY", SimulationErrorCode.NO_RULE_FOR_CITY),
        ("NO_ACTIVE_PRODUCT", SimulationErrorCode.NO_ACTIVE_PRODUCT),
    ],
)
async def test_generate_credit_simulation_business_errors(
    error_code: str,
    expected_enum: SimulationErrorCode,
) -> None:
    """Cada código de erro de negócio deve ser mapeado para SimulationErrorCode correto."""
    with respx.mock:
        respx.post(_SIM_ENDPOINT).mock(
            return_value=httpx.Response(
                422,
                json={"code": error_code, "message": f"Erro: {error_code}"},
            )
        )

        result = await generate_credit_simulation(
            GenerateCreditSimulationInput(
                lead_id=_LEAD_ID,
                amount=5000.0,
                term_months=12,
            )
        )

    assert result.ok is False
    assert result.error_code == expected_enum
    assert result.simulation_id is None


# ---------------------------------------------------------------------------
# Fallback em erro de infraestrutura (5xx)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_generate_credit_simulation_fallback_on_infra_error() -> None:
    """Deve retornar ok=False com UNKNOWN sem levantar exceção em erro 5xx."""
    with respx.mock:
        respx.post(_SIM_ENDPOINT).mock(
            side_effect=[
                httpx.Response(500, json={"error": "internal server error"}),
                httpx.Response(500, json={"error": "internal server error"}),
            ]
        )

        result = await generate_credit_simulation(
            GenerateCreditSimulationInput(
                lead_id=_LEAD_ID,
                amount=5000.0,
                term_months=12,
            )
        )

    assert result.ok is False
    assert result.error_code == SimulationErrorCode.UNKNOWN
    assert result.simulation_id is None


# ---------------------------------------------------------------------------
# Headers: Idempotency-Key e X-Internal-Token enviados
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_generate_credit_simulation_sends_required_headers() -> None:
    """Idempotency-Key e X-Internal-Token devem estar presentes em toda chamada."""
    with respx.mock:
        route = respx.post(_SIM_ENDPOINT).mock(
            return_value=httpx.Response(201, json=_SAMPLE_SIMULATION_RESPONSE)
        )

        await generate_credit_simulation(
            GenerateCreditSimulationInput(
                lead_id=_LEAD_ID,
                amount=5000.0,
                term_months=12,
                product_id=_PRODUCT_ID,
            )
        )

    assert route.called
    req_headers = route.calls.last.request.headers

    # X-Internal-Token obrigatório
    sent_token = req_headers.get("x-internal-token")
    assert sent_token == settings.internal_token.get_secret_value()

    # Idempotency-Key no formato correto
    idempotency_key = req_headers.get("idempotency-key")
    assert idempotency_key is not None
    assert idempotency_key.startswith("sim_")
