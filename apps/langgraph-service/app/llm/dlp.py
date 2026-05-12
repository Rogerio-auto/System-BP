"""DLP — Data Loss Prevention para o pipeline LangGraph.

LGPD §8.4: Nenhum dado pessoal bruto deve sair do Brasil via gateway OpenRouter.
Esta função é o ponto de controle único antes de qualquer chamada LLM.

Padrões cobertos
-----------------
- CPF:   ``\\d{3}\\.?\\d{3}\\.?\\d{3}-?\\d{2}`` + validação de dígito verificador.
         CPF com DV inválido AINDA é mascarado (vazamento parcial = vazamento).
- CNPJ:  ``\\d{2}\\.?\\d{3}\\.?\\d{3}\\/?\\d{4}-?\\d{2}`` + validação de DV.
         CNPJ com DV inválido AINDA é mascarado.
- Email: RFC simplificado — ``[\\w.+-]+@[\\w-]+\\.[\\w.-]+``.
- Telefone BR:
    * E.164: ``\\+55\\d{10,11}``
    * Nacional: ``(\\d{2})\\s?\\d{4,5}-\\d{4}`` e variações sem parênteses
- RG (heurística): ``\\d{1,2}\\.\\d{3}\\.\\d{3}-?[\\dXx]``
  ATENÇÃO: Alta taxa de falso positivo. Todo mascaramento de RG gera ``warn``.
- Data de nascimento: ``\\d{2}/\\d{2}/\\d{4}`` apenas quando dentro de 30
  caracteres de termos indicativos (nascimento, nasc, dob, birthday, etc.).

Tokens
------
Dentro de uma mesma chamada, o mesmo valor → mesmo token (``<CPF_1>``, etc.).
O ``reverse_map`` retornado é um dict ``{token: valor_original}`` — em memória,
escopado à conversa pelo chamador (gateway). **Nunca persistir em log ou banco.**

Segurança de logs
-----------------
Nenhuma função deste módulo loga o valor original de PII. Logs contêm apenas
contadores por tipo e o texto já mascarado.
"""
from __future__ import annotations

import re
from typing import NamedTuple

import structlog

log: structlog.stdlib.BoundLogger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Helpers de normalização de dígitos
# ---------------------------------------------------------------------------


def _digits_only(value: str) -> str:
    """Retorna apenas os dígitos de ``value``."""
    return re.sub(r"\D", "", value)


# ---------------------------------------------------------------------------
# Validação de dígito verificador — CPF
# ---------------------------------------------------------------------------


def _cpf_dv_valid(cpf_raw: str) -> bool:
    """Valida os dois dígitos verificadores do CPF.

    Aceita qualquer string que contenha exatamente 11 dígitos (após remover
    não-dígitos). Retorna ``False`` para sequências triviais (111.111.111-11).
    """
    digits = _digits_only(cpf_raw)
    if len(digits) != 11:
        return False
    # Sequências triviais (ex.: 00000000000) são inválidas
    if len(set(digits)) == 1:
        return False

    def _check(ds: str, length: int) -> bool:
        total = sum(int(ds[i]) * (length + 1 - i) for i in range(length))
        remainder = total % 11
        expected = 0 if remainder < 2 else 11 - remainder
        return int(ds[length]) == expected

    return _check(digits, 9) and _check(digits, 10)


# ---------------------------------------------------------------------------
# Validação de dígito verificador — CNPJ
# ---------------------------------------------------------------------------


def _cnpj_dv_valid(cnpj_raw: str) -> bool:
    """Valida os dois dígitos verificadores do CNPJ."""
    digits = _digits_only(cnpj_raw)
    if len(digits) != 14:
        return False
    if len(set(digits)) == 1:
        return False

    def _check(ds: str, length: int, weights: list[int]) -> bool:
        total = sum(int(ds[i]) * weights[i] for i in range(length))
        remainder = total % 11
        expected = 0 if remainder < 2 else 11 - remainder
        return int(ds[length]) == expected

    w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    return _check(digits, 12, w1) and _check(digits, 13, w2)


# ---------------------------------------------------------------------------
# Expressões regulares (ordem importa: mais específica primeiro)
# ---------------------------------------------------------------------------

# CPF: 000.000.000-00 | 00000000000 | 000 000 000 00
_RE_CPF = re.compile(
    r"\b\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2}\b"
)

# CNPJ: 00.000.000/0000-00 | 00000000000000 | várias formatações
_RE_CNPJ = re.compile(
    r"\b\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2}\b"
)

# Email: RFC simplificado — suficiente para DLP
_RE_EMAIL = re.compile(
    r"\b[\w.+\-]+@[\w\-]+\.[\w.\-]+\b",
    re.ASCII,
)

# Telefone BR — E.164 e formatos nacionais
# Ordem: E.164 primeiro (mais específico)
_RE_PHONE = re.compile(
    r"(?:\+55[\s\-]?\d{2}[\s\-]?\d{4,5}[\s\-]?\d{4})"  # E.164 completo
    r"|(?:\(?\d{2}\)?[\s\-]?\d{4,5}[\s\-]\d{4})"        # Nacional: (69) 99999-9999
    r"|(?:\b\d{4,5}[\s\-]\d{4}\b)",                      # Curto: 99999-9999
)

# RG: heurística — alta taxa de falso positivo
_RE_RG = re.compile(
    r"\b\d{1,2}\.\d{3}\.\d{3}[-\s]?[\dXx]\b"
)

# Data de nascimento — somente quando próxima de termos contextuais
_RE_DATE = re.compile(r"\b\d{2}/\d{2}/\d{4}\b")

# Termos contextuais que indicam data de nascimento (até 30 chars de distância)
_BIRTH_TERMS = re.compile(
    r"(?:nasc(?:imento|ido\s+em|\.)?|data\s+de\s+nasc|dob|birthday|data\s+nasc)",
    re.IGNORECASE,
)
_BIRTH_CONTEXT_WINDOW = 30  # caracteres de raio


# ---------------------------------------------------------------------------
# Context-aware: data de nascimento
# ---------------------------------------------------------------------------


def _is_birth_date(text: str, match: re.Match[str]) -> bool:
    """Retorna True se o match de data está dentro da janela de contexto."""
    start = match.start()
    end = match.end()
    # Janela: _BIRTH_CONTEXT_WINDOW chars antes e depois do match
    context_start = max(0, start - _BIRTH_CONTEXT_WINDOW)
    context_end = min(len(text), end + _BIRTH_CONTEXT_WINDOW)
    context = text[context_start:context_end]
    return bool(_BIRTH_TERMS.search(context))


# ---------------------------------------------------------------------------
# Resultado público
# ---------------------------------------------------------------------------


class RedactResult(NamedTuple):
    """Resultado de ``redact_pii``."""

    text: str
    """Texto com PII substituída por tokens estáveis."""

    reverse_map: dict[str, str]
    """Mapeamento ``{token: valor_original}`` — **nunca persistir**."""

    counts: dict[str, int]
    """Contagem por tipo: ``{"CPF": 2, "EMAIL": 1, ...}``."""


# ---------------------------------------------------------------------------
# Função pública
# ---------------------------------------------------------------------------


def redact_pii(
    text: str,
    *,
    existing_map: dict[str, str] | None = None,
) -> RedactResult:
    """Substitui PII em ``text`` por tokens estáveis.

    Args:
        text: Texto que pode conter PII.
        existing_map: Reverse map de uma chamada anterior na mesma conversa,
            para garantir tokens estáveis entre mensagens. Chaves são tokens
            (``<CPF_1>``), valores são os originais.

    Returns:
        ``RedactResult`` com texto mascarado, reverse_map atualizado e contagens.

    Segurança:
        O reverse_map **nunca** deve ser logado, persistido em banco, passado
        para o outbox ou retornado em respostas HTTP. Escopo: memória + conversa.
    """
    # Constrói mapa inverso (original → token) a partir do existing_map
    # para manter estabilidade de tokens entre mensagens da mesma conversa
    value_to_token: dict[str, str] = {}
    if existing_map:
        for token, original in existing_map.items():
            value_to_token[original] = token

    reverse_map: dict[str, str] = dict(existing_map) if existing_map else {}
    counts: dict[str, int] = {}
    result = text

    def _make_token(pii_type: str) -> str:
        """Gera próximo token sequencial para o tipo dado."""
        # Conta quantos tokens desse tipo já existem
        n = sum(1 for k in reverse_map if k.startswith(f"<{pii_type}_"))
        return f"<{pii_type}_{n + 1}>"

    def _replace_match(m: re.Match[str], pii_type: str) -> str:
        """Retorna token estável para o match, criando se necessário."""
        original = m.group(0)
        if original in value_to_token:
            return value_to_token[original]
        token = _make_token(pii_type)
        reverse_map[token] = original
        value_to_token[original] = token
        counts[pii_type] = counts.get(pii_type, 0) + 1
        return token

    # --- CNPJ (deve vir antes do CPF: CNPJ tem 14 dígitos, CPF tem 11)
    def _sub_cnpj(m: re.Match[str]) -> str:
        # Sempre mascarar — DV inválido também é mascarado (vazamento parcial)
        valid = _cnpj_dv_valid(m.group(0))
        if not valid:
            log.debug("dlp_cnpj_invalid_dv_masked", masked=True)
        return _replace_match(m, "CNPJ")

    result = _RE_CNPJ.sub(_sub_cnpj, result)

    # --- CPF
    def _sub_cpf(m: re.Match[str]) -> str:
        valid = _cpf_dv_valid(m.group(0))
        if not valid:
            log.debug("dlp_cpf_invalid_dv_masked", masked=True)
        return _replace_match(m, "CPF")

    result = _RE_CPF.sub(_sub_cpf, result)

    # --- Email
    result = _RE_EMAIL.sub(lambda m: _replace_match(m, "EMAIL"), result)

    # --- Telefone
    result = _RE_PHONE.sub(lambda m: _replace_match(m, "PHONE"), result)

    # --- RG (heurística) — warning obrigatório
    def _sub_rg(m: re.Match[str]) -> str:
        token = _replace_match(m, "RG")
        log.warning(
            "dlp_rg_masked",
            token=token,
            note="RG heuristic — possible false positive",
        )
        return token

    result = _RE_RG.sub(_sub_rg, result)

    # --- Data de nascimento (contextual)
    def _sub_date(m: re.Match[str]) -> str:
        if _is_birth_date(result, m):
            return _replace_match(m, "BIRTH_DATE")
        return m.group(0)  # sem contexto: não mascarar

    # Aplicar sobre o texto já mascarado para evitar conflito de posições
    result = _RE_DATE.sub(_sub_date, result)

    # Log de resumo — sem valores originais
    if counts:
        log.info(
            "dlp_redacted",
            counts=counts,
            total=sum(counts.values()),
        )

    return RedactResult(text=result, reverse_map=reverse_map, counts=counts)


def redact_messages(
    messages: list[dict[str, object]],
    *,
    existing_map: dict[str, str] | None = None,
) -> tuple[list[dict[str, object]], dict[str, str], dict[str, int]]:
    """Aplica ``redact_pii`` em cada mensagem da lista.

    Reutiliza o mesmo reverse_map entre mensagens para manter tokens estáveis
    dentro de uma conversa.

    Args:
        messages: Lista de mensagens OpenAI (``{"role": ..., "content": ...}``).
        existing_map: Reverse map de contexto anterior da conversa.

    Returns:
        Tupla de (lista_mascarada, reverse_map_atualizado, contagens_totais).
        Mensagens sem ``content`` (ex.: tool calls) são passadas sem alteração.

    Segurança:
        A lista original nunca é mutada.
        O reverse_map retornado **nunca** deve ser persistido.
    """
    current_map: dict[str, str] = dict(existing_map) if existing_map else {}
    total_counts: dict[str, int] = {}
    result: list[dict[str, object]] = []

    for msg in messages:
        content = msg.get("content")
        if isinstance(content, str):
            redacted = redact_pii(content, existing_map=current_map)
            current_map = redacted.reverse_map
            # Acumula contagens
            for k, v in redacted.counts.items():
                total_counts[k] = total_counts.get(k, 0) + v
            result.append({**msg, "content": redacted.text})
        else:
            result.append(dict(msg))

    return result, current_map, total_counts


# ---------------------------------------------------------------------------
# Verificação de idempotência (utilitário de debug/teste)
# ---------------------------------------------------------------------------


def is_pii_free(text: str) -> bool:
    """Retorna True se o texto não contém PII detectável pelos padrões ativos.

    Usado em testes e asserções de segurança. Não deve ser usado em hot-path.
    """
    result_obj = redact_pii(text)
    return result_obj.text == text


__all__ = [
    "RedactResult",
    "is_pii_free",
    "redact_messages",
    "redact_pii",
]
