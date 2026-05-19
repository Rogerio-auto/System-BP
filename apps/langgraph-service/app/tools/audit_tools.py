"""Tool LangGraph: log_ai_decision.

Wrapper fino sobre POST /internal/ai/decisions (F3-S09).
Usada pelo nó final ``log_decision`` para persistir dados do turno em
``ai_decision_logs`` via backend Node.

LGPD (doc 17 §3.4 / §8.4):
    - O campo ``decision`` NUNCA deve conter PII bruta (CPF, RG, nome completo,
      document_number). O produtor (nó LangGraph) é responsável pela sanitização
      antes de chamar esta tool.
    - Somente IDs internos opacos, intenções classificadas e dados de fluxo são
      permitidos em ``decision``. Dados financeiros (valor, prazo) são permitidos.
"""
from __future__ import annotations

import structlog
from pydantic import BaseModel, Field, field_validator

from app.tools._base import InternalApiClient

log: structlog.stdlib.BoundLogger = structlog.get_logger(__name__)

_ENDPOINT = "/internal/ai/decisions"


# ---------------------------------------------------------------------------
# I/O schemas (Pydantic v2)
# ---------------------------------------------------------------------------


class LogAiDecisionInput(BaseModel):
    """Agregação dos dados do turno — espelha LogAiDecisionBody do backend (F3-S09).

    Todos os campos opcionais correspondem a nós que não fazem chamada LLM.

    LGPD: ``decision`` não pode carregar PII bruta. Validação apenas estrutural
    aqui; a responsabilidade semântica (DLP) é do nó produtor.
    """

    organization_id: str = Field(
        description="UUID da organização — denormalizado para filtragem sem JOIN.",
    )
    conversation_id: str = Field(
        description="UUID da conversa (mesmo usado em ai_conversation_states).",
    )
    lead_id: str | None = Field(
        default=None,
        description="UUID do lead identificado; null se ainda não identificado.",
    )
    node_name: str = Field(
        min_length=1,
        max_length=255,
        description="Nome do nó LangGraph que tomou esta decisão.",
    )
    intent: str | None = Field(
        default=None,
        max_length=100,
        description="Intenção classificada; null em nós que não são de classificação.",
    )
    prompt_key: str | None = Field(
        default=None,
        max_length=255,
        description="Chave canônica do prompt sem versão (ex.: 'intent_classifier').",
    )
    prompt_version: str | None = Field(
        default=None,
        max_length=255,
        description="Versão do prompt no formato 'key@vN' (ex.: 'intent_classifier@v3').",
    )
    model: str | None = Field(
        default=None,
        max_length=255,
        description="Identificador do modelo LLM via OpenRouter.",
    )
    tokens_in: int | None = Field(
        default=None,
        ge=0,
        description="Tokens de entrada enviados ao LLM; null se sem chamada LLM.",
    )
    tokens_out: int | None = Field(
        default=None,
        ge=0,
        description="Tokens de saída gerados pelo LLM; null se sem chamada LLM.",
    )
    latency_ms: int | None = Field(
        default=None,
        ge=0,
        description="Latência da chamada ao LLM em ms; null se sem chamada LLM.",
    )
    decision: dict[str, object] = Field(
        default_factory=dict,
        description=(
            "Output estruturado da decisão. "
            "LGPD: NÃO incluir CPF, RG, document_number, nome completo bruto."
        ),
    )
    error: str | None = Field(
        default=None,
        max_length=2000,
        description="Mensagem de erro se o nó falhou; null em execução bem-sucedida.",
    )
    correlation_id: str = Field(
        description="UUID de correlação do request (mesmo valor do X-Correlation-Id).",
    )

    @field_validator("organization_id", "conversation_id", "correlation_id", mode="before")
    @classmethod
    def _must_not_be_empty(cls, v: object) -> object:
        if isinstance(v, str) and not v.strip():
            raise ValueError("campo obrigatório não pode ser vazio")
        return v


class LogAiDecisionOutput(BaseModel):
    """Resposta da tool após log gravado com sucesso."""

    decision_log_id: str = Field(
        description="UUID do registro criado em ai_decision_logs.",
    )


# ---------------------------------------------------------------------------
# Tool function
# ---------------------------------------------------------------------------


async def log_ai_decision(inp: LogAiDecisionInput) -> LogAiDecisionOutput:
    """Grava um registro de decisão de IA via backend Node.

    Chama POST /internal/ai/decisions com os dados do turno agregados pelo nó
    ``log_decision``. Retorna o UUID do registro criado.

    Args:
        inp: Dados do turno validados por ``LogAiDecisionInput``.

    Returns:
        ``LogAiDecisionOutput`` com ``decision_log_id`` do registro criado.

    Raises:
        httpx.HTTPStatusError: Se o backend retornar erro HTTP após retries.
        httpx.TimeoutException: Se o backend não responder em 8 s.
    """
    client = InternalApiClient()

    # Serializa para camelCase conforme contrato do backend (schemas.ts F3-S09)
    payload: dict[str, object] = {
        "organizationId": inp.organization_id,
        "conversationId": inp.conversation_id,
        "nodeName": inp.node_name,
        "correlationId": inp.correlation_id,
        "decision": inp.decision,
    }

    # Campos opcionais — omitir chave quando None para não sobrescrever defaults do Zod
    if inp.lead_id is not None:
        payload["leadId"] = inp.lead_id
    if inp.intent is not None:
        payload["intent"] = inp.intent
    if inp.prompt_key is not None:
        payload["promptKey"] = inp.prompt_key
    if inp.prompt_version is not None:
        payload["promptVersion"] = inp.prompt_version
    if inp.model is not None:
        payload["model"] = inp.model
    if inp.tokens_in is not None:
        payload["tokensIn"] = inp.tokens_in
    if inp.tokens_out is not None:
        payload["tokensOut"] = inp.tokens_out
    if inp.latency_ms is not None:
        payload["latencyMs"] = inp.latency_ms
    if inp.error is not None:
        payload["error"] = inp.error

    log.info(
        "log_ai_decision_calling",
        conversation_id=inp.conversation_id,
        node_name=inp.node_name,
        correlation_id=inp.correlation_id,
        has_error=inp.error is not None,
    )

    raw = await client.post(_ENDPOINT, json=payload)

    decision_log_id: str = raw["decision_log_id"]

    log.info(
        "log_ai_decision_ok",
        conversation_id=inp.conversation_id,
        node_name=inp.node_name,
        decision_log_id=decision_log_id,
    )

    return LogAiDecisionOutput(decision_log_id=decision_log_id)
