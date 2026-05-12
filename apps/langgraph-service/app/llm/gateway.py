"""Contrato público do gateway LLM + tipos compartilhados + filtro DLP.

Nenhum código de nó deve importar um provider concreto. Toda chamada LLM
passa por ``LLMGateway.complete()`` — obtido via ``factory.get_gateway()``.

DLP (Data Loss Prevention)
---------------------------
LGPD §14 proíbe enviar PII bruta a suboperadores internacionais.
``redact_pii()`` remove CPF, e-mail e telefone de qualquer string de mensagem
antes que ela saia pela rede. Chamado internamente pelos providers; não precisa
ser invocado pelo código de nó.
"""
from __future__ import annotations

import re
import time
from typing import Any, Protocol, runtime_checkable

import structlog
from pydantic import BaseModel, Field

log: structlog.stdlib.BoundLogger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# DLP — expressões regulares
# ---------------------------------------------------------------------------

# CPF: 000.000.000-00 ou 00000000000
_RE_CPF = re.compile(r"\b\d{3}[\.\s]?\d{3}[\.\s]?\d{3}[-\s]?\d{2}\b")

# E-mail: padrão RFC simplificado — suficiente para DLP
_RE_EMAIL = re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b")

# Telefone brasileiro: (XX) XXXXX-XXXX / +55XXXXXXXXXXX / variações
_RE_PHONE = re.compile(
    r"(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)(?:9\s?)?\d{4}[\s\-]?\d{4}"
)


def redact_pii(text: str) -> str:
    """Remove CPF, e-mail e telefone de ``text``, substituindo por marcadores.

    Deve ser aplicado em todo conteúdo de mensagem antes de envio ao LLM.
    Não persiste — opera apenas na cópia em memória.
    """
    text = _RE_CPF.sub("[CPF_REDACTED]", text)
    text = _RE_EMAIL.sub("[EMAIL_REDACTED]", text)
    text = _RE_PHONE.sub("[PHONE_REDACTED]", text)
    return text


def redact_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Aplica ``redact_pii()`` no campo ``content`` de cada mensagem.

    Mensagens sem campo ``content`` (ex.: tool calls) são passadas sem alteração.
    Retorna uma nova lista; a original não é mutada.
    """
    result: list[dict[str, Any]] = []
    for msg in messages:
        if isinstance(msg.get("content"), str):
            result.append({**msg, "content": redact_pii(msg["content"])})
        else:
            result.append(dict(msg))
    return result


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
    ) -> LLMResponse:
        """Executa uma chamada de completions ao LLM configurado.

        Args:
            model: Identificador do modelo (ex.: ``"anthropic/claude-3.5-haiku"``).
            messages: Lista de mensagens no formato OpenAI
                      (``{"role": "user"|"system"|"assistant", "content": "..."}``)
            tools: Definições de ferramentas no schema OpenAI (opcional).
            temperature: Temperatura de amostragem (0.0-2.0). Default: 0.2.
            max_tokens: Limite de tokens na resposta. Default: 1024.
            metadata: Dados extras para logging/tracing (ex.: node, lead_id).

        Returns:
            ``LLMResponse`` com o texto gerado e métricas de uso.

        Raises:
            ``BudgetExceededError``: orçamento diário esgotado.
            ``LLMProviderError``: erro não-recuperável do provider.
            ``tenacity.RetryError``: retries esgotados em falha transitória.
        """
        ...

    async def check_budget(self, org_id: str) -> bool:
        """Verifica se a organização tem orçamento disponível para uma chamada.

        Stub neste slot — retorna sempre ``True``.
        Implementação real no slot de billing (consulta ``llm_usage_daily``).

        Args:
            org_id: Identificador da organização (tenant).

        Returns:
            ``True`` se houver orçamento; ``False`` caso contrário.

        Raises:
            ``BudgetExceededError``: quando budget está esgotado (alternativa a retornar False).
        """
        ...


# ---------------------------------------------------------------------------
# Utilitário de timing — reutilizado pelos providers
# ---------------------------------------------------------------------------


def measure_latency(start: float) -> float:
    """Retorna a latência em ms desde ``start`` (resultado de ``time.monotonic()``)."""
    return (time.monotonic() - start) * 1000
