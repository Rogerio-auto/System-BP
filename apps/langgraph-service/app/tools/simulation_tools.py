"""Tools de simulação de crédito — wrapper sobre endpoints /internal/*.

Arquivo compartilhado pelas tools de simulação (F3-S15, F3-S16, F3-S21).
Toda chamada ao backend usa InternalApiClient (_base.py) — nunca acessa
banco de dados diretamente.

Endpoints cobertos:
    GET  /internal/credit-products   → list_credit_products (F3-S15)
    POST /internal/simulations       → generate_credit_simulation (F3-S16)
"""
from __future__ import annotations

import contextlib
import math
from datetime import UTC, datetime
from enum import StrEnum

import httpx
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


# ---------------------------------------------------------------------------
# generate_credit_simulation — F3-S16
# ---------------------------------------------------------------------------

# Known error codes returned by POST /internal/simulations (doc 06 §7.3).
_KNOWN_ERROR_CODES = frozenset(
    {"AMOUNT_OUT_OF_RANGE", "TERM_OUT_OF_RANGE", "NO_RULE_FOR_CITY", "NO_ACTIVE_PRODUCT"}
)


class SimulationErrorCode(StrEnum):
    """Códigos de erro documentados no doc 06 §7.3."""

    AMOUNT_OUT_OF_RANGE = "AMOUNT_OUT_OF_RANGE"
    TERM_OUT_OF_RANGE = "TERM_OUT_OF_RANGE"
    NO_RULE_FOR_CITY = "NO_RULE_FOR_CITY"
    NO_ACTIVE_PRODUCT = "NO_ACTIVE_PRODUCT"
    UNKNOWN = "UNKNOWN"


class GenerateCreditSimulationInput(BaseModel):
    """Parâmetros de entrada para generate_credit_simulation (doc 06 §7.3)."""

    lead_id: str = Field(description="UUID do lead para o qual a simulação é gerada.")
    amount: float = Field(
        gt=0,
        description="Valor solicitado em reais (ex: 5000.0).",
    )
    term_months: int = Field(
        gt=0,
        description="Prazo desejado em meses (ex: 12).",
    )
    product_id: str | None = Field(
        default=None,
        description=(
            "UUID do produto de crédito. Quando nulo, o backend escolhe o produto "
            "compatível automaticamente (ou retorna NO_ACTIVE_PRODUCT se não houver)."
        ),
    )


class GenerateCreditSimulationOutput(BaseModel):
    """Resultado de generate_credit_simulation.

    Em caso de erro de negócio (range, produto, regra), ``ok`` é False e
    ``error_code`` indica o motivo. Nenhuma exceção é levantada para o grafo —
    ele decide se faz handoff ou reformula a pergunta.
    """

    ok: bool = Field(description="True quando a simulação foi gerada com sucesso.")

    # Campos preenchidos quando ok=True
    simulation_id: str | None = Field(
        default=None, description="UUID da simulação gerada."
    )
    installment: str | None = Field(
        default=None,
        description="Valor da parcela mensal (decimal como string, ex: '462.50').",
    )
    total: str | None = Field(
        default=None,
        description="Total a pagar ao final do contrato (decimal como string).",
    )
    interest: str | None = Field(
        default=None,
        description="Total de juros embutidos (decimal como string).",
    )
    rate: str | None = Field(
        default=None,
        description="Taxa mensal aplicada (decimal como string, ex: '0.025000').",
    )
    rule_version: str | None = Field(
        default=None,
        description="Versão da regra de crédito usada no cálculo.",
    )

    # Campos preenchidos quando ok=False
    error_code: SimulationErrorCode | None = Field(
        default=None,
        description="Código do erro de negócio quando ok=False.",
    )
    error_message: str | None = Field(
        default=None,
        description="Mensagem descritiva do erro (para log/handoff summary).",
    )


def _build_idempotency_key(
    lead_id: str,
    amount: float,
    term_months: int,
    product_id: str | None,
) -> str:
    """Constrói a idempotency key conforme doc 06 §7.3.

    Formato: ``sim_<lead_id>_<amount>_<term>_<product_id>_<minute_bucket>``

    ``minute_bucket`` garante que uma nova tentativa dentro do mesmo minuto
    (ex.: retry de rede) reutilize a mesma key — simulações distintas em
    minutos diferentes recebem keys diferentes.
    """
    now_utc = datetime.now(tz=UTC)
    minute_bucket = now_utc.strftime("%Y%m%d%H%M")
    # Normaliza amount para evitar diferença entre 5000.0 e 5000 na key.
    amount_str = str(math.floor(amount * 100))
    pid = product_id if product_id is not None else "none"
    return f"sim_{lead_id}_{amount_str}_{term_months}_{pid}_{minute_bucket}"


async def generate_credit_simulation(
    input: GenerateCreditSimulationInput,
) -> GenerateCreditSimulationOutput:
    """Gera uma simulação de crédito via POST /internal/simulations.

    Chama o backend Node com idempotency key no padrão doc 06 §7.3.
    Erros de negócio (range, produto, regra) são retornados como
    ``ok=False`` + ``error_code`` — nunca levantam exceção para o grafo.
    Erros de infraestrutura (5xx, timeout) também são tratados com
    fallback gracioso para que o grafo possa fazer handoff humano.

    Args:
        input: Parâmetros da simulação (lead_id, amount, term_months, product_id?).

    Returns:
        GenerateCreditSimulationOutput com os dados da simulação ou o erro de negócio.
    """
    client = InternalApiClient()

    idempotency_key = _build_idempotency_key(
        lead_id=input.lead_id,
        amount=input.amount,
        term_months=input.term_months,
        product_id=input.product_id,
    )

    payload: dict[str, object] = {
        "leadId": input.lead_id,
        "amount": input.amount,
        "termMonths": input.term_months,
    }
    if input.product_id is not None:
        payload["productId"] = input.product_id

    # LGPD doc 17 §8.3: não logar `amount` nem `idempotency_key` (a chave embute
    # lead_id+amount) — dado financeiro não pode ser associado a id pessoal no log.
    log.info(
        "generate_credit_simulation_start",
        lead_id=input.lead_id,
        term_months=input.term_months,
        product_id=input.product_id,
    )

    try:
        raw = await client.post(
            "/internal/simulations",
            json=payload,
            idempotency_key=idempotency_key,
        )
    except httpx.HTTPStatusError as exc:
        status_code = exc.response.status_code
        # 422 / 400 → erro de negócio (range, produto, regra).
        if status_code in (400, 422):
            body: dict[str, object] = {}
            with contextlib.suppress(Exception):
                body = exc.response.json()
            raw_code = str(body.get("code", "UNKNOWN"))
            error_code = (
                SimulationErrorCode(raw_code)
                if raw_code in _KNOWN_ERROR_CODES
                else SimulationErrorCode.UNKNOWN
            )
            error_message = str(body.get("message", exc.response.text))
            log.warning(
                "generate_credit_simulation_business_error",
                lead_id=input.lead_id,
                status_code=status_code,
                error_code=error_code,
                error_message=error_message,
            )
            return GenerateCreditSimulationOutput(
                ok=False,
                error_code=error_code,
                error_message=error_message,
            )
        # 5xx after retries exhausted → infra error, fall through to generic handler.
        log.exception(
            "generate_credit_simulation_http_error",
            lead_id=input.lead_id,
            status_code=status_code,
        )
        return GenerateCreditSimulationOutput(
            ok=False,
            error_code=SimulationErrorCode.UNKNOWN,
            error_message=f"Backend HTTP error {status_code}",
        )
    except Exception:
        log.exception(
            "generate_credit_simulation_error",
            lead_id=input.lead_id,
        )
        return GenerateCreditSimulationOutput(
            ok=False,
            error_code=SimulationErrorCode.UNKNOWN,
            error_message="Unexpected error contacting backend",
        )

    # Happy path — map backend response fields.
    data: dict[str, object] = raw.get("data", raw)

    simulation_id = str(data.get("id", "")) or None
    installment = _str_or_none(data.get("installmentAmount"))
    total = _str_or_none(data.get("totalAmount"))
    interest = _str_or_none(data.get("totalInterest"))
    rate = _str_or_none(data.get("monthlyRate"))
    rule_version = _str_or_none(data.get("ruleVersion"))

    # LGPD doc 17 §8.3: `installment`/`total` (financeiro) não logados junto de
    # lead_id. simulation_id é o handle operacional para rastreio.
    log.info(
        "generate_credit_simulation_ok",
        lead_id=input.lead_id,
        simulation_id=simulation_id,
        rule_version=rule_version,
    )

    return GenerateCreditSimulationOutput(
        ok=True,
        simulation_id=simulation_id,
        installment=installment,
        total=total,
        interest=interest,
        rate=rate,
        rule_version=rule_version,
    )


def _str_or_none(value: object) -> str | None:
    """Converte um valor do payload JSON para str, ou None se ausente/nulo."""
    if value is None:
        return None
    return str(value)
