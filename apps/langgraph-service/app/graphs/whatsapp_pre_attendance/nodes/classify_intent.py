"""Nó classify_intent — classifica a intenção da mensagem do cliente via LLM.

Fluxo (doc 06 §5.2):
    receive_message → load_conversation_state → classify_intent → ...

Responsabilidades:
- Carregar o prompt ativo de prompt_versions (DB) via load_active_prompt() (F9-S09).
- Aplicar DLP no texto do cliente antes de enviar ao gateway (LGPD §8.4).
- Chamar o LLM via ``get_gateway()`` com ``for_role("classifier")`` (modelo barato).
- Validar a saída contra o ``IntentLiteral`` canônico; valor fora do enum → fallback
  ``"nao_entendi"``.
- Registrar ``prompt_key`` e ``prompt_version`` no estado para uso posterior pelo
  nó ``log_decision``.
- F9-S08: aplica temperature/max_tokens/top_p do DB quando presentes
  (campos opcionais — None → usar hardcoded defaults do nó).
- F9-S09: fonte canônica dos prompts é prompt_versions (DB), não arquivos .md.
  Fallback: prompt não encontrado (404) ou timeout → handoff_required=True.

Restrições (doc 06 §5.6):
- O nó não aprova crédito, não vaza dados internos, não chama Postgres diretamente.
- Em qualquer falha irrecuperável, aciona handoff humano.
"""
from __future__ import annotations

import re
import time
from typing import Any, get_args

import structlog

from app.graphs.whatsapp_pre_attendance.state import ConversationState, IntentLiteral
from app.llm.dlp import redact_pii
from app.llm.factory import for_role, get_gateway
from app.prompts.loader import PromptNotFoundError, load_active_prompt

log: structlog.stdlib.BoundLogger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Constantes do prompt
# ---------------------------------------------------------------------------

# Chave canônica do prompt neste nó — fonte de verdade: prompt_versions (DB)
_PROMPT_KEY = "pre_attendance_classify"

# Intenções válidas extraídas do Literal canônico (doc 06 §5.1)
_VALID_INTENTS: frozenset[str] = frozenset(get_args(IntentLiteral))

_FALLBACK_INTENT = "nao_entendi"

# Defaults hardcoded para classify_intent (usados quando o prompt não define os campos)
_DEFAULT_TEMPERATURE = 0.0   # classificação deve ser determinística
_DEFAULT_MAX_TOKENS = 32      # intenção é curta; economiza tokens


# ---------------------------------------------------------------------------
# Validação de intenção
# ---------------------------------------------------------------------------


def _validate_intent(raw: str) -> str:
    """Normaliza e valida o texto retornado pelo LLM.

    Args:
        raw: Texto bruto da resposta do LLM.

    Returns:
        Intenção válida (dentro do ``IntentLiteral``) ou ``"nao_entendi"``
        se o valor estiver fora do enum.
    """
    normalized = raw.strip().lower()
    if normalized in _VALID_INTENTS:
        return normalized
    # Tenta limpar espaços/pontuação que o LLM possa ter adicionado
    cleaned = re.sub(r"[^a-z_]", "", normalized)
    if cleaned in _VALID_INTENTS:
        return cleaned
    return _FALLBACK_INTENT


# ---------------------------------------------------------------------------
# Nó principal
# ---------------------------------------------------------------------------


async def classify_intent(state: ConversationState) -> dict[str, Any]:
    """Nó LangGraph: classifica a intenção da mensagem mais recente do cliente.

    Carrega o prompt ativo do DB via load_active_prompt() (F9-S09).
    Aplica DLP no texto antes do envio ao LLM (LGPD §8.4).
    Em caso de falha irrecuperável, define ``handoff_required=True``.

    Args:
        state: Estado atual do grafo (parcial — total=False).

    Returns:
        Dict com os campos atualizados:
        - ``current_intent``: intenção classificada (sempre dentro do enum).
        - ``handoff_required``: True apenas em erro irrecuperável.
        - ``handoff_reason``: descrição do erro se ``handoff_required`` for True.
        - ``errors``: lista acumulada de erros deste turno.

    Raises:
        Não propaga exceções — erros são capturados e convertidos em handoff.
    """
    start = time.monotonic()

    # Extrai a mensagem mais recente do cliente
    messages: list[dict[str, Any]] = state.get("messages", [])
    user_text = ""
    for msg in reversed(messages):
        if msg.get("role") == "user":
            content = msg.get("content", "")
            if isinstance(content, str):
                user_text = content
            break

    conversation_id: str = state.get("conversation_id", "")
    lead_id: str | None = state.get("lead_id")

    try:
        # --- Carrega prompt ativo do DB (F9-S09)
        # Levanta PromptNotFoundError (404) ou httpx.TimeoutException → handoff
        active_prompt = await load_active_prompt(_PROMPT_KEY)

        prompt_key = active_prompt.key
        prompt_version = active_prompt.prompt_version
        prompt_body = active_prompt.body

        # F9-S08/F9-S09: usa parâmetros do DB quando presentes, defaults caso contrário.
        # None no DB = usar default hardcoded (não force nenhum valor ao gateway).
        effective_temperature = (
            active_prompt.temperature
            if active_prompt.temperature is not None
            else _DEFAULT_TEMPERATURE
        )
        effective_max_tokens = (
            active_prompt.max_tokens
            if active_prompt.max_tokens is not None
            else _DEFAULT_MAX_TOKENS
        )

        # --- DLP: remove PII antes de enviar ao gateway (LGPD §8.4)
        dlp_result = redact_pii(user_text)
        safe_text = dlp_result.text

        if dlp_result.counts:
            log.info(
                "classify_intent_dlp_applied",
                conversation_id=conversation_id,
                lead_id=lead_id,
                pii_types=list(dlp_result.counts.keys()),
            )

        # --- Monta messages para o LLM (system + user)
        llm_messages: list[dict[str, Any]] = [
            {"role": "system", "content": prompt_body.strip()},
            {"role": "user", "content": safe_text},
        ]

        # --- Chama o LLM via gateway (modelo barato para classificação)
        # F9-S08/F9-S09: temperature e max_tokens vêm do DB (ou defaults).
        # top_p é omitido quando None para não forçar valor ao gateway.
        gateway = get_gateway()
        complete_kwargs: dict[str, Any] = {
            "model": for_role("classifier"),
            "messages": llm_messages,
            "temperature": effective_temperature,
            "max_tokens": effective_max_tokens,
            "metadata": {
                "node": "classify_intent",
                "lead_id": lead_id,
                "prompt_key": prompt_key,
                "prompt_version": prompt_version,
                # conversation_id omitido do metadata: já passado como kwarg dedicado
                # ao gateway (evita TypeError "multiple values" no log structlog).
            },
            "conversation_id": conversation_id,
            # F9-S10 CRÍTICO-1 fix: dlp=False removido.
            # redact_pii() é idempotente sobre tokens já mascarados (<CPF_1> etc.)
            # — aplicar DLP duas vezes é no-op. O gateway aplica dlp=True (default)
            # como defesa em profundidade, garantindo que nenhum PII bruto
            # chegue ao suboperador internacional (LGPD §8.4).
        }
        # top_p: inclui no payload apenas quando explicitamente definido no prompt.
        # Omitir é diferente de passar None — evita sobrescrever o default do gateway.
        if active_prompt.top_p is not None:
            complete_kwargs["top_p"] = active_prompt.top_p

        response = await gateway.complete(**complete_kwargs)

        # --- Valida saída contra o enum canônico
        intent = _validate_intent(response.content)
        latency_ms = (time.monotonic() - start) * 1000

        log.info(
            "intent_classified",
            conversation_id=conversation_id,
            lead_id=lead_id,
            intent=intent,
            raw_response=response.content.strip(),
            prompt_key=prompt_key,
            prompt_version=prompt_version,
            latency_ms=round(latency_ms, 1),
            model=response.model,
            tokens_used=response.usage.total_tokens,
        )

        return {
            "current_intent": intent,
            "handoff_required": False,
            # Registra metadados do prompt para log_decision (doc 06 §5.2)
            "tool_results": [
                *state.get("tool_results", []),
                {
                    "node": "classify_intent",
                    "prompt_key": prompt_key,
                    "prompt_version": prompt_version,
                    "intent": intent,
                    "latency_ms": round(latency_ms, 1),
                },
            ],
        }

    except PromptNotFoundError as exc:
        latency_ms = (time.monotonic() - start) * 1000
        log.error(
            "classify_intent_prompt_not_found",
            conversation_id=conversation_id,
            lead_id=lead_id,
            key=exc.key,
            latency_ms=round(latency_ms, 1),
        )
        errors: list[dict[str, Any]] = list(state.get("errors", []))
        errors.append(
            {
                "node": "classify_intent",
                "error": str(exc),
                "latency_ms": round(latency_ms, 1),
            }
        )
        return {
            "current_intent": _FALLBACK_INTENT,
            "handoff_required": True,
            "handoff_reason": str(exc),
            "errors": errors,
        }

    except Exception as exc:
        latency_ms = (time.monotonic() - start) * 1000
        log.error(
            "classify_intent_error",
            conversation_id=conversation_id,
            lead_id=lead_id,
            error=str(exc),
            latency_ms=round(latency_ms, 1),
        )
        errors = list(state.get("errors", []))
        errors.append(
            {
                "node": "classify_intent",
                "error": str(exc),
                "latency_ms": round(latency_ms, 1),
            }
        )
        return {
            "current_intent": _FALLBACK_INTENT,
            "handoff_required": True,
            "handoff_reason": f"classify_intent falhou: {exc}",
            "errors": errors,
        }


__all__ = ["classify_intent"]
