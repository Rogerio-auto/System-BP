"""Tools de simulação de crédito — wrapper sobre endpoints /internal/*.

Arquivo compartilhado pelas tools de simulação (F3-S15, F3-S16, F3-S21).
Toda chamada ao backend usa InternalApiClient (_base.py) — nunca acessa
banco de dados diretamente.

Endpoints cobertos:
    GET  /internal/credit-products   → list_credit_products (F3-S15)
"""
from __future__ import annotations

import structlog
from pydantic import BaseModel, Field

from app.tools._base import InternalApiClient

log: structlog.stdlib.BoundLogger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Schemas de I/O (Pydantic v2)
# ---------------------------------------------------------------------------


class ListCreditProductsInput(BaseModel):
    """Parâmetros de entrada para list_credit_products.

    Todos os campos são opcionais — sem organizationId, o endpoint retorna
    lista vazia (proteção cross-tenant gracioso no backend).
    """

    organization_id: str | None = Field(
        default=None,
        description=(
            "UUID da organização (multi-tenant). Sem este campo, o backend retorna []."
        ),
    )
    city_id: str | None = Field(
        default=None,
        description=(
            "UUID da cidade. Quando informado, filtra produtos disponíveis para essa cidade "
            "(scope da cidade ou produto global)."
        ),
    )


class CreditProductItem(BaseModel):
    """Produto de crédito retornado pelo backend (doc 06 §4.3 / internal schemas F3-S06).

    Campos seguros para a IA — sem PII, sem campos internos administrativos.
    """

    id: str = Field(description="UUID do produto — usado na tool generate_credit_simulation.")
    name: str = Field(description="Nome do produto para apresentação ao cliente.")
    min_amount: str = Field(
        description="Valor mínimo liberado (decimal como string, ex: '500.00')."
    )
    max_amount: str = Field(
        description="Valor máximo liberado (decimal como string, ex: '15000.00')."
    )
    min_term: int = Field(description="Prazo mínimo em meses.")
    max_term: int = Field(description="Prazo máximo em meses.")
    interest_rate: str = Field(
        description="Taxa mensal decimal (ex: '0.025000' = 2,5% ao mês)."
    )
    amortization_type: str = Field(description="Sistema de amortização: 'price' ou 'sac'.")


class ListCreditProductsOutput(BaseModel):
    """Resultado de list_credit_products."""

    products: list[CreditProductItem] = Field(
        default_factory=list,
        description="Lista de produtos de crédito ativos disponíveis.",
    )


# ---------------------------------------------------------------------------
# Tool
# ---------------------------------------------------------------------------


async def list_credit_products(
    input: ListCreditProductsInput,
) -> ListCreditProductsOutput:
    """Lista produtos de crédito ativos via GET /internal/credit-products.

    Chama o backend Node com os headers obrigatórios (X-Internal-Token +
    X-Correlation-Id quando disponível). Sem organizationId, retorna lista
    vazia sem levantar erro — proteção cross-tenant delegada ao backend.

    Em caso de erro HTTP ou timeout, loga e retorna lista vazia para que o
    grafo possa fazer handoff humano em vez de travar o fluxo.

    Args:
        input: Parâmetros opcionais (organization_id, city_id).

    Returns:
        ListCreditProductsOutput com a lista de produtos ativos.
    """
    client = InternalApiClient()

    # Monta query params — exclui valores None para não poluir a querystring.
    params: dict[str, str] = {}
    if input.organization_id is not None:
        params["organizationId"] = input.organization_id
    if input.city_id is not None:
        params["cityId"] = input.city_id

    log.info(
        "list_credit_products_start",
        organization_id=input.organization_id,
        city_id=input.city_id,
    )

    try:
        raw = await client.get("/internal/credit-products", params=params if params else None)
    except Exception:
        log.exception(
            "list_credit_products_error",
            organization_id=input.organization_id,
            city_id=input.city_id,
        )
        # Fallback: lista vazia permite ao grafo decidir handoff humano.
        return ListCreditProductsOutput(products=[])

    items_raw: list[object] = raw.get("data", [])
    products = [CreditProductItem.model_validate(item) for item in items_raw]

    log.info(
        "list_credit_products_ok",
        organization_id=input.organization_id,
        city_id=input.city_id,
        count=len(products),
    )

    return ListCreditProductsOutput(products=products)
