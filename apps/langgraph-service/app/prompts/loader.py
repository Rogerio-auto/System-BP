"""Loader de prompts ativos do DB via /internal/prompts/active/:key (F9-S09).

Substitui a leitura de arquivos .md locais. A fonte canônica passa a ser
a tabela prompt_versions do banco, acessada via endpoint interno do backend Node.

Fluxo:
    load_active_prompt(key) → GET /internal/prompts/active/{key}
                            → parse em ActivePrompt (Pydantic v2)
                            → cacheia 60s em TTLCache em processo

Fallback:
    404 ou timeout → levanta PromptNotFoundError.
    O nó chamador captura e converte em handoff_required=True.
    Sem fallback silencioso para .md — comportamento inconsistente é pior que falha.

Regras:
    - LangGraph NUNCA toca Postgres direto — só via InternalApiClient.
    - Cache invalidação apenas por TTL. Sem invalidation cross-process no MVP.
    - Sem PII no corpo do prompt por design (F9-S01 valida) — sem redact necessário aqui.
    - mypy --strict verde: todos os campos tipados, extra forbid no schema.
"""
from __future__ import annotations

import time
from typing import Any

import httpx
import structlog
from pydantic import BaseModel, ConfigDict

from app.tools._base import InternalApiClient

log: structlog.stdlib.BoundLogger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Schema Pydantic v2 para a resposta do endpoint
# ---------------------------------------------------------------------------


class ActivePrompt(BaseModel):
    """Versão ativa de um prompt versionado, lida do DB via endpoint interno.

    Corresponde ao payload de GET /internal/prompts/active/:key.
    extra='forbid': rejeita campos desconhecidos (defesa em profundidade).
    """

    model_config = ConfigDict(extra="forbid")

    key: str
    """Chave canônica do prompt (ex: 'pre_attendance_classify')."""

    version: int
    """Número da versão inteira (ex: 1)."""

    body: str
    """Corpo do prompt sem frontmatter YAML — usado como system message."""

    content_hash: str
    """SHA-256 do body para auditoria e detecção de adulteração."""

    model_recommended: str | None
    """Modelo LLM recomendado, ou None = usar padrão do gateway."""

    temperature: float | None
    """Temperatura para amostragem LLM. None = usar default do gateway."""

    max_tokens: int | None
    """Limite de tokens na resposta. None = usar default do gateway."""

    top_p: float | None
    """Nucleus sampling. None = usar default do gateway."""

    prompt_version: str
    """String composta para logging: 'key@vN' (ex: 'pre_attendance_classify@v1')."""


# ---------------------------------------------------------------------------
# Exceção de prompt não encontrado
# ---------------------------------------------------------------------------


class PromptNotFoundError(Exception):
    """Levantada quando o endpoint retorna 404 para a key solicitada.

    O nó chamador deve capturar e converter em handoff_required=True.
    """

    def __init__(self, key: str) -> None:
        self.key = key
        super().__init__(f"prompt active version não encontrada para key={key}")


# ---------------------------------------------------------------------------
# Cache TTL em processo (sem dependências externas)
# ---------------------------------------------------------------------------

_TTL_SECONDS: float = 60.0


class _TTLEntry:
    """Entrada simples de cache com timestamp de expiração."""

    __slots__ = ("expires_at", "value")

    def __init__(self, value: ActivePrompt, ttl: float) -> None:
        self.value = value
        self.expires_at = time.monotonic() + ttl


# Dicionário em módulo: persiste dentro do mesmo processo/worker.
# Invalidação apenas por TTL — correto para o MVP (doc F9-S09).
_cache: dict[str, _TTLEntry] = {}


def _get_cached(key: str) -> ActivePrompt | None:
    """Retorna o prompt cacheado se ainda válido, ou None se expirado/ausente."""
    entry = _cache.get(key)
    if entry is None:
        return None
    if time.monotonic() >= entry.expires_at:
        # Remove entrada expirada para liberar memória
        del _cache[key]
        return None
    return entry.value


def _set_cached(key: str, prompt: ActivePrompt) -> None:
    """Armazena o prompt no cache com TTL de 60s."""
    _cache[key] = _TTLEntry(prompt, _TTL_SECONDS)


def _invalidate_cache(key: str | None = None) -> None:
    """Remove entradas do cache. Se key=None, limpa tudo.

    Usado apenas em testes para controle de estado.
    Não chamar em produção — invalidação é por TTL.
    """
    if key is None:
        _cache.clear()
    else:
        _cache.pop(key, None)


# ---------------------------------------------------------------------------
# Função pública principal
# ---------------------------------------------------------------------------


async def load_active_prompt(key: str) -> ActivePrompt:
    """Carrega a versão ativa de um prompt do DB via endpoint interno.

    Busca em cache primeiro (TTL 60s). Se ausente ou expirado, chama
    GET /internal/prompts/active/{key} via InternalApiClient.

    Args:
        key: Chave canônica do prompt (ex: 'pre_attendance_classify').

    Returns:
        ActivePrompt com todos os campos do endpoint.

    Raises:
        PromptNotFoundError: Quando o endpoint retorna 404 (sem versão ativa).
        httpx.TimeoutException: Quando o backend não responde em tempo.
        httpx.HTTPStatusError: Em respostas 5xx após retries esgotados.

    Notes:
        Sem fallback silencioso para .md — inconsistência é pior que falha.
        O nó chamador captura exceções e converte em handoff_required=True.
    """
    # 1. Verificar cache
    cached = _get_cached(key)
    if cached is not None:
        log.debug(
            "prompt_cache_hit",
            key=key,
            version=cached.version,
        )
        return cached

    # 2. Buscar do endpoint interno
    client = InternalApiClient()
    path = f"/internal/prompts/active/{key}"

    try:
        raw: dict[str, Any] = await client.get(path)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            log.warning(
                "prompt_not_found",
                key=key,
                status_code=404,
            )
            raise PromptNotFoundError(key) from exc
        # 5xx ou outros: propaga — InternalApiClient já fez retry
        log.error(
            "prompt_load_http_error",
            key=key,
            status_code=exc.response.status_code,
        )
        raise
    except httpx.TimeoutException:
        log.error("prompt_load_timeout", key=key)
        raise

    # 3. Parse em ActivePrompt (Pydantic v2 valida e rejeita campos extras)
    prompt = ActivePrompt.model_validate(raw)

    # 4. Armazena no cache
    _set_cached(key, prompt)

    log.info(
        "prompt_loaded",
        key=key,
        version=prompt.version,
        prompt_version=prompt.prompt_version,
    )

    return prompt


__all__ = ["ActivePrompt", "PromptNotFoundError", "_invalidate_cache", "load_active_prompt"]
