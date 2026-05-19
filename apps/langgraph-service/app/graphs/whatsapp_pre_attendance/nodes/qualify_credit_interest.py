"""Nó qualify_credit_interest — coleta valor e prazo de crédito via LLM.

Fluxo (doc 06 §5.2):
    identify_city → qualify_credit_interest → generate_simulation

Responsabilidades:
- Ler o prompt versionado de ``app/prompts/pre_attendance_qualify.md``.
- Aplicar DLP no texto do cliente antes de enviar ao gateway (LGPD §8.4).
- Chamar o LLM via ``get_gateway()`` com ``for_role("reasoner")`` (modelo capaz
  de extrair entidades de linguagem natural).
- Extrair ``requested_amount`` (float, R$) e ``requested_term_months`` (int, meses)
  da resposta JSON do LLM.
- Atualizar ``missing_fields`` com os campos que ainda faltam.
- Compor a próxima pergunta ao cliente quando dados incompletos.
- Em qualquer falha irrecuperável, acionar handoff humano (``handoff_reason``
  genérico — sem vazar exceção ou URL no estado persistido).

Restrições (doc 06 §5.6):
- O nó não aprova crédito, não vaza dados internos, não chama Postgres diretamente.
- ``handoff_reason`` em falha usa mensagem genérica (sem stack trace, sem URL).
"""
from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any

import structlog

from app.graphs.whatsapp_pre_attendance.state import ConversationState
from app.llm.dlp import redact_pii
from app.llm.factory import for_role, get_gateway

log: structlog.stdlib.BoundLogger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Constantes do prompt
# ---------------------------------------------------------------------------

_PROMPT_PATH = (
    Path(__file__).parent.parent.parent.parent / "prompts" / "pre_attendance_qualify.md"
)

# Campos que este nó é responsável por coletar
_QUALIFY_FIELDS = ("requested_amount", "requested_term_months")

# Mensagem de handoff genérica — sem vazar detalhes internos (LGPD / segurança)
_HANDOFF_REASON_GENERIC = "qualify_credit_interest: falha ao coletar dados de crédito"

# ---------------------------------------------------------------------------
# Carregamento e parse do prompt versionado
# ---------------------------------------------------------------------------


def _load_prompt() -> tuple[str, str, str]:
    """Carrega o prompt versionado e extrai metadados do header YAML.

    Returns:
        Tupla (prompt_key, prompt_version, prompt_body) onde ``prompt_body``
        é o conteúdo sem o bloco frontmatter YAML.

    Raises:
        RuntimeError: Se o arquivo não existir ou o header YAML estiver mal formado.
    """
    if not _PROMPT_PATH.exists():
        raise RuntimeError(f"Prompt não encontrado: {_PROMPT_PATH}")

    raw = _PROMPT_PATH.read_text(encoding="utf-8")

    fm_match = re.match(r"^---\n(.*?)\n---\n", raw, re.DOTALL)
    if not fm_match:
        raise RuntimeError(f"Prompt sem header YAML válido: {_PROMPT_PATH}")

    frontmatter = fm_match.group(1)
    body = raw[fm_match.end():]

    def _extract(field: str) -> str:
        m = re.search(rf"^{field}:\s*(.+)$", frontmatter, re.MULTILINE)
        if not m:
            raise RuntimeError(f"Campo '{field}' ausente no header YAML do prompt.")
        return m.group(1).strip()

    return _extract("key"), _extract("version"), body


# ---------------------------------------------------------------------------
# Extração da resposta JSON do LLM
# ---------------------------------------------------------------------------


def _extract_json(raw: str) -> dict[str, Any]:
    """Extrai e valida o JSON retornado pelo LLM.

    O LLM pode retornar o JSON com ou sem cerca de código markdown.
    Esta função tenta extrair o JSON de forma resiliente.

    Args:
        raw: Texto bruto da resposta do LLM.

    Returns:
        Dict com ``requested_amount``, ``requested_term_months``,
        ``next_question`` e ``ready_to_simulate``.
        Valores ausentes ou inválidos são normalizados para None/False.
    """
    # Remove cerca de código markdown se presente
    text = raw.strip()
    fence_match = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", text)
    if fence_match:
        text = fence_match.group(1)

    try:
        data: dict[str, Any] = json.loads(text)
    except json.JSONDecodeError:
        # Tenta extrair o primeiro bloco JSON do texto
        brace_match = re.search(r"\{[\s\S]+\}", text)
        if brace_match:
            try:
                data = json.loads(brace_match.group(0))
            except json.JSONDecodeError:
                return _empty_extraction()
        else:
            return _empty_extraction()

    return _normalize_extraction(data)


def _empty_extraction() -> dict[str, Any]:
    """Retorna estrutura vazia quando o JSON não pode ser extraído."""
    return {
        "requested_amount": None,
        "requested_term_months": None,
        "next_question": None,
        "ready_to_simulate": False,
    }


def _normalize_extraction(data: dict[str, Any]) -> dict[str, Any]:
    """Normaliza e valida os valores extraídos do JSON do LLM.

    Args:
        data: Dict bruto parseado do JSON.

    Returns:
        Dict normalizado com tipos corretos ou None para valores inválidos.
    """
    # requested_amount: deve ser float > 0
    amount_raw = data.get("requested_amount")
    requested_amount: float | None = None
    if amount_raw is not None:
        try:
            val = float(amount_raw)
            if val > 0:
                requested_amount = val
        except (TypeError, ValueError):
            pass

    # requested_term_months: deve ser int > 0
    term_raw = data.get("requested_term_months")
    requested_term_months: int | None = None
    if term_raw is not None:
        try:
            val_int = int(float(term_raw))
            if val_int > 0:
                requested_term_months = val_int
        except (TypeError, ValueError):
            pass

    # next_question: str ou None
    next_q_raw = data.get("next_question")
    next_question: str | None = None
    if isinstance(next_q_raw, str) and next_q_raw.strip():
        next_question = next_q_raw.strip()

    # ready_to_simulate: bool derivado dos campos extraídos (não confiamos no LLM)
    ready_to_simulate = requested_amount is not None and requested_term_months is not None

    return {
        "requested_amount": requested_amount,
        "requested_term_months": requested_term_months,
        "next_question": next_question,
        "ready_to_simulate": ready_to_simulate,
    }


# ---------------------------------------------------------------------------
# Cálculo de missing_fields
# ---------------------------------------------------------------------------


def _compute_missing_fields(
    existing_missing: list[str],
    requested_amount: float | None,
    requested_term_months: int | None,
) -> list[str]:
    """Atualiza a lista de campos faltantes com base nos dados coletados.

    Preserva campos faltantes de outros nós que não são de responsabilidade
    deste nó (ex.: city, customer_name).

    Args:
        existing_missing: Lista atual de ``missing_fields`` do estado.
        requested_amount: Valor coletado ou None.
        requested_term_months: Prazo coletado ou None.

    Returns:
        Lista atualizada de campos faltantes.
    """
    # Remove campos que este nó gerencia
    filtered = [f for f in existing_missing if f not in _QUALIFY_FIELDS]

    # Adiciona os que ainda estão faltando
    if requested_amount is None:
        filtered.append("requested_amount")
    if requested_term_months is None:
        filtered.append("requested_term_months")

    return filtered


# ---------------------------------------------------------------------------
# Nó principal
# ---------------------------------------------------------------------------


async def qualify_credit_interest(state: ConversationState) -> dict[str, Any]:
    """Nó LangGraph: coleta valor e prazo de crédito do cliente via LLM.

    Aplica DLP no texto do cliente antes do envio ao LLM (LGPD §8.4).
    Extrai ``requested_amount`` e ``requested_term_months`` da resposta JSON.
    Atualiza ``missing_fields`` e compõe a próxima pergunta se dados incompletos.
    Em caso de falha irrecuperável, define ``handoff_required=True`` com
    ``handoff_reason`` genérico (sem vazar detalhes internos).

    Args:
        state: Estado atual do grafo (total=False — LangGraph faz merge incremental).

    Returns:
        Dict com os campos atualizados:
        - ``requested_amount``: float ou None.
        - ``requested_term_months``: int ou None.
        - ``missing_fields``: lista atualizada.
        - ``handoff_required``: True apenas em erro irrecuperável.
        - ``handoff_reason``: mensagem genérica se ``handoff_required`` for True.
        - ``errors``: lista acumulada de erros deste turno.
        - ``tool_results``: metadados do nó para log_decision.
        - ``actions_emitted``: acumulado de ações emitidas.

    Raises:
        Não propaga exceções — erros são capturados e convertidos em handoff.
    """
    start = time.monotonic()

    conversation_id: str = state.get("conversation_id", "")
    lead_id: str | None = state.get("lead_id")

    # Recupera dados já coletados em turnos anteriores (estado parcial)
    existing_amount: float | None = state.get("requested_amount")
    existing_term: int | None = state.get("requested_term_months")

    # Se ambos já coletados em turnos anteriores, não chama o LLM novamente
    if existing_amount is not None and existing_term is not None:
        latency_ms = (time.monotonic() - start) * 1000
        log.info(
            "qualify_credit_interest_already_complete",
            conversation_id=conversation_id,
            lead_id=lead_id,
            requested_amount=existing_amount,
            requested_term_months=existing_term,
            latency_ms=round(latency_ms, 1),
        )
        missing: list[str] = _compute_missing_fields(
            state.get("missing_fields", []), existing_amount, existing_term
        )
        return {
            "requested_amount": existing_amount,
            "requested_term_months": existing_term,
            "missing_fields": missing,
            "handoff_required": False,
        }

    # Monta histórico de mensagens para o LLM
    messages: list[dict[str, Any]] = state.get("messages", [])

    try:
        # --- Carrega prompt versionado
        prompt_key, prompt_version, prompt_body = _load_prompt()

        # --- DLP: remove PII de todas as mensagens do histórico (LGPD §8.4)
        # Aplica DLP apenas no texto do usuário (role=user) para limpar PII
        # antes de enviar ao suboperador internacional.
        safe_messages: list[dict[str, Any]] = []
        for msg in messages:
            role = msg.get("role", "")
            content = msg.get("content", "")
            if role == "user" and isinstance(content, str):
                dlp_result = redact_pii(content)
                if dlp_result.counts:
                    log.info(
                        "qualify_credit_interest_dlp_applied",
                        conversation_id=conversation_id,
                        lead_id=lead_id,
                        pii_types=list(dlp_result.counts.keys()),
                    )
                safe_messages.append({"role": role, "content": dlp_result.text})
            else:
                safe_messages.append(dict(msg))

        # --- Monta payload para o LLM: system + histórico completo
        llm_messages: list[dict[str, Any]] = [
            {"role": "system", "content": prompt_body.strip()},
            *safe_messages,
        ]

        # --- Chama o LLM via gateway (reasoner: modelo capaz de extrair entidades)
        gateway = get_gateway()
        response = await gateway.complete(
            model=for_role("reasoner"),
            messages=llm_messages,
            temperature=0.1,   # baixa temperatura para extração consistente
            max_tokens=256,    # JSON de qualificação é curto
            metadata={
                "node": "qualify_credit_interest",
                "lead_id": lead_id,
                "prompt_key": prompt_key,
                "prompt_version": prompt_version,
                "conversation_id": conversation_id,
            },
            conversation_id=conversation_id,
            dlp=False,  # DLP já aplicado manualmente acima
        )

        # --- Extrai e valida JSON da resposta
        extracted = _extract_json(response.content)
        requested_amount: float | None = extracted["requested_amount"]
        requested_term_months: int | None = extracted["requested_term_months"]
        next_question: str | None = extracted["next_question"]
        ready_to_simulate: bool = extracted["ready_to_simulate"]

        # --- Preserva valores de turnos anteriores se o LLM não retornou novos
        if requested_amount is None and existing_amount is not None:
            requested_amount = existing_amount
        if requested_term_months is None and existing_term is not None:
            requested_term_months = existing_term
            # Recalcula ready_to_simulate após merge com estado anterior
            ready_to_simulate = requested_amount is not None and requested_term_months is not None

        # --- Atualiza missing_fields
        missing_fields = _compute_missing_fields(
            state.get("missing_fields", []),
            requested_amount,
            requested_term_months,
        )

        latency_ms = (time.monotonic() - start) * 1000

        log.info(
            "qualify_credit_interest_done",
            conversation_id=conversation_id,
            lead_id=lead_id,
            requested_amount=requested_amount,
            requested_term_months=requested_term_months,
            ready_to_simulate=ready_to_simulate,
            missing_fields=missing_fields,
            prompt_key=prompt_key,
            prompt_version=prompt_version,
            latency_ms=round(latency_ms, 1),
            model=response.model,
            tokens_used=response.usage.total_tokens,
        )

        # --- Acumula ações: próxima pergunta ao cliente (se houver)
        actions_emitted: list[dict[str, Any]] = list(state.get("actions_emitted", []))
        if next_question:
            actions_emitted.append(
                {
                    "type": "send_message",
                    "node": "qualify_credit_interest",
                    "content": next_question,
                }
            )

        return {
            "requested_amount": requested_amount,
            "requested_term_months": requested_term_months,
            "missing_fields": missing_fields,
            "handoff_required": False,
            "actions_emitted": actions_emitted,
            "tool_results": [
                *state.get("tool_results", []),
                {
                    "node": "qualify_credit_interest",
                    "prompt_key": prompt_key,
                    "prompt_version": prompt_version,
                    "requested_amount": requested_amount,
                    "requested_term_months": requested_term_months,
                    "ready_to_simulate": ready_to_simulate,
                    "latency_ms": round(latency_ms, 1),
                },
            ],
        }

    except Exception as exc:
        latency_ms = (time.monotonic() - start) * 1000
        # Log com detalhe técnico (structlog — não chega ao cliente)
        log.error(
            "qualify_credit_interest_error",
            conversation_id=conversation_id,
            lead_id=lead_id,
            error=str(exc),
            latency_ms=round(latency_ms, 1),
        )
        errors: list[dict[str, Any]] = list(state.get("errors", []))
        errors.append(
            {
                "node": "qualify_credit_interest",
                "error": str(exc),
                "latency_ms": round(latency_ms, 1),
            }
        )
        return {
            "handoff_required": True,
            # Genérico: sem stack trace, sem URL, sem dados internos
            "handoff_reason": _HANDOFF_REASON_GENERIC,
            "errors": errors,
        }


__all__ = ["qualify_credit_interest"]
