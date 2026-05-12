"""Contrato público do gateway LLM + tipos compartilhados.

Nenhum código de nó deve importar um provider concreto. Toda chamada LLM
passa por ``LLMGateway.complete()`` — obtido via ``factory.get_gateway()``.

DLP (Data Loss Prevention) — LGPD §8.4
----------------------------------------
LGPD §8.4 proíbe enviar PII bruta a suboperadores internacionais.
O módulo ``app.llm.dlp`` implementa a função canônica ``redact_pii()`` que
aplica regex com DV-validation em CPF, CNPJ, email, telefone E.164/nacional,
RG (heurística) e datas de nascimento em contexto.

``gateway.complete(dlp=True)`` — padrão e obrigatório para agentes externos.
``gateway.complete(dlp=False)`` — requer permissão ``assistant:bypass_dlp``.
    Enquanto essa permissão não existir, levanta ``NotImplementedError``.

Logs
----
Nenhum log neste módulo carrega tokens reais de PII. Toda mensagem logada
está no formato mascarado. Tokens são apenas contadores por tipo.

Reverse-map
-----------
``complete()`` retorna ``CompletionResult`` com ``reverse_map`` — **nunca**
persistir em log, banco, outbox ou resposta HTTP. Usar apenas em memória,
escopado à conversa pelo chamador.
"""
from __future__ import annotations

import time
from typing import Any, Protocol, runtime_checkable

import structlog
from pydantic import BaseModel, Field

from app.llm.dlp import redact_messages, redact_pii  # re-export para importadores externos

log: structlog.stdlib.BoundLogger = structlog.get_logger(__name__)

__all__ = [
    "BudgetExceededError",
    "CompletionResult",
    "LLMGateway",
    "LLMProviderError",
    "LLMResponse",
    "TokenUsage",
    "measure_latency",
    "redact_messages",
    "redact_pii",
]


# ---------------------------------------------------------------------------
# Tipos de resposta
# ---------------------------------------------------------------------------


class TokenUsage(BaseModel):
    """Contagem de tokens reportada pelo provider."""

    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


class LLMResponse(BaseModel):
    """Resposta normalizada de qualquer provider LLM."""

    content: str = Field(description="Texto gerado pelo modelo.")
    model: str = Field(description="Identificador do modelo que respondeu.")
    usage: TokenUsage = Field(default_factory=TokenUsage)
    latency_ms: float = Field(description="Latência da chamada em milissegundos.", default=0.0)
    finish_reason: str = Field(default="stop")
    raw: dict[str, Any] = Field(
        default_factory=dict,
        description="Payload bruto do provider para debugging.",
        exclude=True,  # não serializar em logs estruturados
    )


class CompletionResult(BaseModel):
    """Resultado enriquecido de ``LLMGateway.complete()``.

    Extende ``LLMResponse`` com metadados DLP para uso no chamador.
    """

    model_config = {"arbitrary_types_allowed": True}

    content: str = Field(description="Texto gerado pelo modelo (validado pelo pós-validador).")
    model: str = Field(description="Identificador do modelo que respondeu.")
    usage: TokenUsage = Field(default_factory=TokenUsage)
    latency_ms: float = Field(default=0.0)
    finish_reason: str = Field(default="stop")

    pii_tokens_redacted: dict[str, int] = Field(
        default_factory=dict,
        description="Contagem de tokens PII redactados por tipo antes do envio.",
    )
    suspicious_output: bool = Field(
        default=False,
        description="True se o validador pós-LLM detectou possível PII na resposta.",
    )
    reverse_map: dict[str, str] = Field(
        default_factory=dict,
        description=(
            "Mapeamento token→original para devolução ao chamador. "
            "NUNCA persistir em log, banco ou outbox."
        ),
        exclude=True,  # excluído de serialização — segurança
    )

    @classmethod
    def from_llm_response(
        cls,
        resp: LLMResponse,
        *,
        pii_tokens_redacted: dict[str, int],
        suspicious_output: bool,
        reverse_map: dict[str, str],
    ) -> CompletionResult:
        return cls(
            content=resp.content,
            model=resp.model,
            usage=resp.usage,
            latency_ms=resp.latency_ms,
            finish_reason=resp.finish_reason,
            pii_tokens_redacted=pii_tokens_redacted,
            suspicious_output=suspicious_output,
            reverse_map=reverse_map,
        )


# ---------------------------------------------------------------------------
# Erros específicos do gateway
# ---------------------------------------------------------------------------


class BudgetExceededError(Exception):
    """Levantado quando o orçamento diário da organização foi esgotado."""

    def __init__(self, org_id: str, daily_budget_usd: float) -> None:
        self.org_id = org_id
        self.daily_budget_usd = daily_budget_usd
        super().__init__(
            f"Orçamento diário de ${daily_budget_usd:.2f} USD esgotado para org={org_id}"
        )


class LLMProviderError(Exception):
    """Levantado quando o provider retorna erro não-recuperável."""

    def __init__(self, provider: str, status_code: int | None, message: str) -> None:
        self.provider = provider
        self.status_code = status_code
        super().__init__(f"[{provider}] status={status_code}: {message}")


# ---------------------------------------------------------------------------
# Protocol — contrato que todo provider deve implementar
# ---------------------------------------------------------------------------


@runtime_checkable
class LLMGateway(Protocol):
    """Interface única que nós LangGraph usam para chamar LLMs.

    Implementações concretas: ``OpenRouterGateway``, ``AnthropicGateway``.
    Obtida via ``factory.get_gateway()`` — nunca instanciada diretamente nos nós.
    """

    async def complete(
        self,
        *,
        model: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.2,
        max_tokens: int = 1024,
        metadata: dict[str, Any] | None = None,
        conversation_id: str = "",
        dlp: bool = True,
    ) -> LLMResponse:
        """Executa uma chamada de completions ao LLM configurado.

        Args:
            model: Identificador do modelo (ex.: ``"anthropic/claude-3.5-haiku"``).
            messages: Lista de mensagens no formato OpenAI.
            tools: Definições de ferramentas no schema OpenAI (opcional).
            temperature: Temperatura de amostragem (0.0-2.0). Default: 0.2.
            max_tokens: Limite de tokens na resposta. Default: 1024.
            metadata: Dados extras para logging/tracing (ex.: node, lead_id).
            conversation_id: ID da conversa para escopo do reverse_map DLP.
            dlp: Se True (default), aplica DLP antes de enviar ao LLM.
                 Se False, exige permissão ``assistant:bypass_dlp`` (não implementada
                 — levanta ``NotImplementedError`` até o slot correspondente).

        Returns:
            ``LLMResponse`` com o texto gerado e métricas de uso.

        Raises:
            ``BudgetExceededError``: orçamento diário esgotado.
            ``LLMProviderError``: erro não-recuperável do provider.
            ``NotImplementedError``: dlp=False sem permissão.
            ``tenacity.RetryError``: retries esgotados em falha transitória.
        """
        ...

    async def check_budget(self, org_id: str) -> bool:
        """Verifica se a organização tem orçamento disponível para uma chamada."""
        ...


# ---------------------------------------------------------------------------
# Utilitário de timing — reutilizado pelos providers
# ---------------------------------------------------------------------------


def measure_latency(start: float) -> float:
    """Retorna a latência em ms desde ``start`` (resultado de ``time.monotonic()``)."""
    return (time.monotonic() - start) * 1000


# ---------------------------------------------------------------------------
# Helpers de compatibilidade retroativa (importados por openrouter.py)
# ---------------------------------------------------------------------------

# redact_messages já foi importado no topo deste módulo via dlp.py
# e está disponível como app.llm.gateway.redact_messages
