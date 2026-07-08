"""Tools de leitura para o copiloto interno (F6-S07).

Todas as tools chamam endpoints /internal/assistant/* (F6-S06) via InternalApiClient.
O principal do usuario e threaded do state em cada chamada -- nunca inferido.

Contratos (fonte de verdade: apps/api/src/modules/internal/assistant/schemas.ts):
  funnel_metrics  -> POST /internal/assistant/funnel-metrics  (range + cityIds)
  lead_count      -> POST /internal/assistant/lead-count      (range + cityIds)
  analysis_status -> POST /internal/assistant/analysis-status (lead_id)
  billing_snapshot-> POST /internal/assistant/billing-upcoming (cityIds ONLY, sem range)

LGPD s17/s8.5: responses nao incluem CPF. Telefone mascarado pelo backend.
"""
from __future__ import annotations

from typing import Any

import structlog

from app.tools._base import InternalApiClient

log: structlog.stdlib.BoundLogger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Tipo do principal (espelha PrincipalSchema do backend)
# ---------------------------------------------------------------------------

Principal = dict[str, Any]
"""Dict com user_id, organization_id, permissions, city_scope_ids."""


# ---------------------------------------------------------------------------
# Helpers de schema OpenAI para o nodo agent_node
# ---------------------------------------------------------------------------


def _prop(typ: str, desc: str, **extra: Any) -> dict[str, Any]:
    d: dict[str, Any] = {"type": typ, "description": desc}
    d.update(extra)
    return d


def _tool(
    name: str,
    desc: str,
    props: dict[str, Any],
    required: list[str],
) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": desc,
            "parameters": {
                "type": "object",
                "properties": props,
                "required": required,
            },
        },
    }


def build_assistant_tool_schemas() -> list[dict[str, Any]]:
    """Retorna definicoes de tools no formato OpenAI tool-calling."""
    range_values = "today | last7d | last30d | last90d | thisMonth | lastMonth | custom"

    return [
        _tool(
            "get_funnel_metrics",
            "Retorna metricas do funil de leads (por stage, conversao, contagens). "
            "Use quando o usuario perguntar sobre o pipeline, kanban ou progressao de leads.",
            {
                "range": _prop("string", f"Periodo: {range_values}"),
                "city_ids": _prop(
                    "array",
                    "Lista de UUIDs de cidades. Omitir para todas do escopo.",
                    items={"type": "string"},
                ),
            },
            required=["range"],
        ),
        _tool(
            "get_lead_count",
            "Retorna contagem de leads e taxa de conversao para um periodo. "
            "Use quando o usuario perguntar sobre volume de leads.",
            {
                "range": _prop("string", f"Periodo: {range_values}"),
                "city_ids": _prop(
                    "array",
                    "Lista de UUIDs de cidades para filtrar.",
                    items={"type": "string"},
                ),
            },
            required=["range"],
        ),
        _tool(
            "get_analysis_status",
            "Retorna status e resultado das analises de credito de um lead especifico. "
            "Use quando o usuario perguntar sobre o andamento de uma analise ou resultado.",
            {
                "lead_id": _prop("string", "UUID do lead a consultar."),
            },
            required=["lead_id"],
        ),
        _tool(
            "get_billing_snapshot",
            "Retorna snapshot da carteira de cobranca (sempre o estado atual). "
            "Use quando o usuario perguntar sobre inadimplencia, boletos ou cobrancas pendentes. "
            "IMPORTANTE: esta tool NAO aceita range de datas -- retorna sempre o snapshot atual.",
            {
                "city_ids": _prop(
                    "array",
                    "Lista de UUIDs de cidades. Omitir para todas do escopo.",
                    items={"type": "string"},
                ),
            },
            required=[],
        ),
    ]


# ---------------------------------------------------------------------------
# Implementacoes das tools (chamadas pelo agent_node)
# ---------------------------------------------------------------------------


async def call_funnel_metrics(
    principal: Principal,
    range_value: str,
    city_ids: list[str] | None = None,
    client: InternalApiClient | None = None,
) -> dict[str, Any]:
    """Chama /internal/assistant/funnel-metrics e retorna resultado tipado."""
    http = client or InternalApiClient()
    body: dict[str, Any] = {
        "principal": principal,
        "query": {
            "range": range_value,
            **(({"cityIds": city_ids}) if city_ids else {}),
        },
    }
    log.info("assistant_tool_call", tool="get_funnel_metrics", range=range_value)
    return await http.post("/internal/assistant/funnel-metrics", json=body)


async def call_lead_count(
    principal: Principal,
    range_value: str,
    city_ids: list[str] | None = None,
    client: InternalApiClient | None = None,
) -> dict[str, Any]:
    """Chama /internal/assistant/lead-count e retorna resultado tipado."""
    http = client or InternalApiClient()
    body: dict[str, Any] = {
        "principal": principal,
        "query": {
            "range": range_value,
            **(({"cityIds": city_ids}) if city_ids else {}),
        },
    }
    log.info("assistant_tool_call", tool="get_lead_count", range=range_value)
    return await http.post("/internal/assistant/lead-count", json=body)


async def call_analysis_status(
    principal: Principal,
    lead_id: str,
    client: InternalApiClient | None = None,
) -> dict[str, Any]:
    """Chama /internal/assistant/analysis-status e retorna resultado tipado."""
    http = client or InternalApiClient()
    body: dict[str, Any] = {
        "principal": principal,
        "lead_id": lead_id,
    }
    log.info("assistant_tool_call", tool="get_analysis_status", lead_id=lead_id)
    return await http.post("/internal/assistant/analysis-status", json=body)


async def call_billing_snapshot(
    principal: Principal,
    city_ids: list[str] | None = None,
    client: InternalApiClient | None = None,
) -> dict[str, Any]:
    """Chama /internal/assistant/billing-upcoming e retorna snapshot.

    IMPORTANTE: billing-upcoming NAO aceita range/datas (review F6-S06 M-1).
    E sempre o estado atual da carteira (snapshotLabel, nao rangeLabel).
    """
    http = client or InternalApiClient()
    body: dict[str, Any] = {
        "principal": principal,
        "query": {"cityIds": city_ids} if city_ids else None,
    }
    # Remove query se None para nao enviar campo nulo
    if body["query"] is None:
        del body["query"]
    log.info("assistant_tool_call", tool="get_billing_snapshot")
    return await http.post("/internal/assistant/billing-upcoming", json=body)
