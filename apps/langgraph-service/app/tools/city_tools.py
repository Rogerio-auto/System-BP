"""Tool LangGraph: identify_city.

Wrapper fino sobre ``POST /internal/cities/identify`` (F3-S05).

Contrato (doc 06 §7.2):
    Input:  IdentifyCityInput  { lead_id?, city_text }
    Output: IdentifyCityResult { city_id, city_name, matched, confidence,
                                  out_of_service, alternatives }

``matched: false`` é retorno **normal** — indica que o nó deve pedir
confirmação ao cliente. Não é erro; não levanta exceção.

Nunca acessa Postgres diretamente. Usa InternalApiClient.
"""
from __future__ import annotations

import structlog
from pydantic import BaseModel, Field

from app.tools._base import InternalApiClient

log: structlog.stdlib.BoundLogger = structlog.get_logger(__name__)

_ENDPOINT = "/internal/cities/identify"


# ---------------------------------------------------------------------------
# I/O Pydantic v2
# ---------------------------------------------------------------------------


class IdentifyCityInput(BaseModel):
    """Payload enviado ao endpoint de identificação de cidade."""

    city_text: str = Field(
        ...,
        min_length=1,
        description="Texto livre digitado pelo cliente descrevendo a cidade.",
    )
    lead_id: str | None = Field(
        default=None,
        description="UUID do lead, quando já disponível no estado da conversa.",
    )


class CityAlternative(BaseModel):
    """Uma cidade alternativa sugerida quando ``matched=False``."""

    city_id: str
    city_name: str
    confidence: float = Field(ge=0.0, le=1.0)


class IdentifyCityResult(BaseModel):
    """Resposta normalizada do endpoint ``POST /internal/cities/identify``.

    Campos:
        matched:        ``True`` quando confidence >= 0.85 e cidade está na área atendida.
        out_of_service: ``True`` quando a cidade existe mas está fora da área atendida.
                        O grafo usa este flag para disparar mensagem de fluxo alternativo.
        alternatives:   Lista de até 3 sugestões quando ``matched=False`` e não
                        ``out_of_service``. Pode ser vazia.
    """

    city_id: str | None = None
    city_name: str | None = None
    matched: bool
    confidence: float = Field(ge=0.0, le=1.0)
    out_of_service: bool = False
    alternatives: list[CityAlternative] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Tool
# ---------------------------------------------------------------------------


async def identify_city(
    city_text: str,
    lead_id: str | None = None,
    *,
    client: InternalApiClient | None = None,
) -> IdentifyCityResult:
    """Identifica a cidade a partir de texto livre do cliente.

    Chama ``POST /internal/cities/identify`` e normaliza a resposta em
    ``IdentifyCityResult``.  ``matched=False`` é tratado como retorno válido —
    cabe ao nó do grafo decidir o próximo passo (pedir confirmação, fluxo
    alternativo, etc.).

    Args:
        city_text: Texto digitado pelo cliente (ex.: "porto velho", "pv").
        lead_id:   UUID do lead, repassado ao backend para logging/auditoria.
        client:    Instância de ``InternalApiClient`` (injetada em testes).
                   Quando ``None``, cria uma instância padrão.

    Returns:
        ``IdentifyCityResult`` com o resultado da identificação.

    Raises:
        httpx.HTTPStatusError: Em erro HTTP não recuperável do backend.
        httpx.TimeoutException: Se o backend não responder em 8 s.
    """
    payload = IdentifyCityInput(city_text=city_text, lead_id=lead_id)
    http_client = client or InternalApiClient()

    log.info(
        "identify_city_start",
        city_text=city_text,
        lead_id=lead_id,
    )

    raw = await http_client.post(
        _ENDPOINT,
        json=payload.model_dump(exclude_none=True),
    )

    result = IdentifyCityResult.model_validate(raw)

    log.info(
        "identify_city_done",
        matched=result.matched,
        city_id=result.city_id,
        city_name=result.city_name,
        confidence=result.confidence,
        out_of_service=result.out_of_service,
        alternatives_count=len(result.alternatives),
        lead_id=lead_id,
    )

    return result
