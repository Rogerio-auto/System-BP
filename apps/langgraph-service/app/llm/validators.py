"""Validador pós-LLM — detecta PII na resposta do modelo.

LGPD §8.4 / §13: Após receber a resposta do LLM, verificar se o modelo
tentou devolver PII (prompt injection, regressão, erro de configuração).

Se detectado:
- ``suspicious_output=True`` no resultado.
- ``truncate_at`` indica a posição do primeiro match.
- ``safe_output()`` aplica truncamento e insere aviso canônico.
- Log de incidente estruturado com ``event="llm_pii_leak_suspected"``.

Nenhum valor real de PII é logado — apenas contagens por padrão.
"""
from __future__ import annotations

import re
from typing import NamedTuple

import structlog

log: structlog.stdlib.BoundLogger = structlog.get_logger(__name__)

# Aviso inserido no texto truncado
_TRUNCATION_WARNING = "[CONTEÚDO TRUNCADO - SUSPEITA DE VAZAMENTO]"

# ---------------------------------------------------------------------------
# Padrões para detecção pós-LLM (subconjunto focado: CPF, CNPJ, email, telefone)
# Não incluímos RG aqui para evitar falsos positivos excessivos na resposta.
# ---------------------------------------------------------------------------

_POST_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("CPF", re.compile(r"\b\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2}\b")),
    (
        "CNPJ",
        re.compile(r"\b\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2}\b"),
    ),
    (
        "EMAIL",
        re.compile(r"\b[\w.+\-]+@[\w\-]+\.[\w.\-]+\b", re.ASCII),
    ),
    (
        "PHONE",
        re.compile(
            r"(?:\+55[\s\-]?\d{2}[\s\-]?\d{4,5}[\s\-]?\d{4})"
            r"|(?:\(?\d{2}\)?[\s\-]?\d{4,5}[\s\-]\d{4})"
            r"|(?:\b\d{4,5}[\s\-]\d{4}\b)"
        ),
    ),
]


# ---------------------------------------------------------------------------
# Tipos de resultado
# ---------------------------------------------------------------------------


class ValidationResult(NamedTuple):
    """Resultado de ``validate_llm_output``."""

    is_safe: bool
    """True se nenhum padrão PII foi detectado."""

    suspicious_output: bool
    """True se pelo menos um padrão PII foi detectado (inverso de is_safe)."""

    truncate_at: int | None
    """Posição do primeiro match suspeito. None se is_safe=True."""

    pattern_counts: dict[str, int]
    """Contagem de matches por tipo de padrão."""


# ---------------------------------------------------------------------------
# Funções públicas
# ---------------------------------------------------------------------------


def validate_llm_output(
    text: str,
    *,
    model: str = "",
    conversation_id: str = "",
) -> ValidationResult:
    """Analisa a resposta do LLM em busca de padrões PII.

    Args:
        text: Texto retornado pelo modelo.
        model: Identificador do modelo (para log de incidente).
        conversation_id: ID da conversa (para log de incidente).

    Returns:
        ``ValidationResult`` com flags de segurança e posição de truncamento.

    Segurança:
        Nenhum valor real de PII é logado — apenas contagens por padrão.
    """
    pattern_counts: dict[str, int] = {}
    first_match_pos: int | None = None

    for pattern_name, pattern in _POST_PATTERNS:
        matches = list(pattern.finditer(text))
        if matches:
            pattern_counts[pattern_name] = len(matches)
            pos = matches[0].start()
            if first_match_pos is None or pos < first_match_pos:
                first_match_pos = pos

    if pattern_counts:
        total = sum(pattern_counts.values())
        log.warning(
            "llm_pii_leak_suspected",
            model=model,
            conversation_id=conversation_id,
            pattern_count=total,
            patterns_detected=list(pattern_counts.keys()),
            # Nunca logar o texto ou valores reais
        )
        return ValidationResult(
            is_safe=False,
            suspicious_output=True,
            truncate_at=first_match_pos,
            pattern_counts=pattern_counts,
        )

    return ValidationResult(
        is_safe=True,
        suspicious_output=False,
        truncate_at=None,
        pattern_counts={},
    )


def safe_output(
    text: str,
    validation: ValidationResult,
) -> str:
    """Aplica truncamento e aviso quando a validação detectou PII.

    Se ``validation.is_safe`` é True, retorna o texto original sem alteração.
    Se ``validation.suspicious_output`` é True, trunca no ``truncate_at`` e
    adiciona o aviso canônico ``[CONTEÚDO TRUNCADO - SUSPEITA DE VAZAMENTO]``.

    Args:
        text: Texto original da resposta do LLM.
        validation: Resultado de ``validate_llm_output``.

    Returns:
        Texto seguro — truncado se necessário.
    """
    if validation.is_safe or validation.truncate_at is None:
        return text

    truncated = text[: validation.truncate_at].rstrip()
    return f"{truncated}\n\n{_TRUNCATION_WARNING}"


__all__ = [
    "ValidationResult",
    "safe_output",
    "validate_llm_output",
]
