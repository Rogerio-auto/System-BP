"""Nó generate_simulation — lista produtos, gera simulação e compõe resposta.

Fluxo (doc 06 §5.2 / §5.3):
    qualify_credit_interest → generate_simulation → save_simulation → decide_next_step

Responsabilidades:
- Chamar ``list_credit_products`` (F3-S15) para obter produtos ativos da cidade.
- Selecionar o produto compatível com o valor/prazo solicitados pelo cliente.
- Chamar ``generate_credit_simulation`` (F3-S16) com o produto selecionado.
- Gravar ``last_simulation_id`` e ``selected_product_id`` no estado.
- Usar o LLM ``for_role("reasoner")`` para compor a resposta em linguagem natural.
- Em erros de range (``AMOUNT_OUT_OF_RANGE``, ``TERM_OUT_OF_RANGE``, etc.) →
  mensagem clara ao cliente sem inventar taxa ou prazo (doc 06 §5.6).
- Em falha de tool ou gateway → handoff humano seguro.

Restrições (doc 06 §5.6):
- Não aprova/recusa crédito.
- Nunca inventa taxa, prazo ou parcela — usa exclusivamente os dados do backend.
- Nunca acessa Postgres diretamente.
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
from app.tools.simulation_tools import (
    GenerateCreditSimulationInput,
    GenerateCreditSimulationOutput,
    ListCreditProductsInput,
    SimulationErrorCode,
    generate_credit_simulation,
    list_credit_products,
)

log: structlog.stdlib.BoundLogger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Constantes do prompt
# ---------------------------------------------------------------------------

_PROMPT_PATH = (
    Path(__file__).parent.parent.parent.parent / "prompts" / "simulation.md"
)

# ---------------------------------------------------------------------------
# Carregamento do prompt versionado
# ---------------------------------------------------------------------------


def _load_prompt() -> tuple[str, str, str]:
    """Carrega o prompt versionado e extrai metadados do header YAML.

    Returns:
        Tupla (prompt_key, prompt_version, prompt_body).

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
# Helpers de seleção de produto
# ---------------------------------------------------------------------------


def _select_compatible_product(
    products: list[Any],
    amount: float,
    term_months: int,
) -> str | None:
    """Seleciona o primeiro produto compatível com valor e prazo.

    Critério: amount dentro de [min_amount, max_amount] E term_months dentro de
    [min_term, max_term]. Retorna o ``id`` do produto ou None se nenhum for
    compatível.

    Args:
        products: Lista de ``CreditProductItem`` retornada pelo backend.
        amount: Valor solicitado pelo cliente.
        term_months: Prazo solicitado pelo cliente.

    Returns:
        UUID do produto compatível, ou None.
    """
    for product in products:
        try:
            min_amount = float(product.min_amount)
            max_amount = float(product.max_amount)
            min_term = int(product.min_term)
            max_term = int(product.max_term)
        except (ValueError, AttributeError):
            continue

        amount_ok = min_amount <= amount <= max_amount
        term_ok = min_term <= term_months <= max_term
        if amount_ok and term_ok:
            return str(product.id)

    return None


# ---------------------------------------------------------------------------
# Mensagens de erro de negócio (sem inventar taxa/prazo — doc 06 §5.6)
# ---------------------------------------------------------------------------

_ERROR_MESSAGES: dict[SimulationErrorCode, str] = {
    SimulationErrorCode.AMOUNT_OUT_OF_RANGE: (
        "O valor que você solicitou está fora do intervalo permitido para os produtos "
        "disponíveis na sua cidade. Por favor, informe um valor diferente ou fale com "
        "um de nossos atendentes para verificar outras opções."
    ),
    SimulationErrorCode.TERM_OUT_OF_RANGE: (
        "O prazo que você escolheu não está disponível para esse produto. "
        "Por favor, informe um prazo diferente ou fale com um atendente."
    ),
    SimulationErrorCode.NO_RULE_FOR_CITY: (
        "Não encontrei uma regra de crédito ativa para a sua cidade no momento. "
        "Por favor, fale com um de nossos atendentes para verificar a disponibilidade."
    ),
    SimulationErrorCode.NO_ACTIVE_PRODUCT: (
        "Não há produto de crédito ativo disponível para a combinação de valor e prazo "
        "que você informou. Por favor, fale com um atendente para explorar alternativas."
    ),
    SimulationErrorCode.UNKNOWN: (
        "Não consegui gerar a simulação no momento. Por favor, tente novamente em "
        "instantes ou fale com um de nossos atendentes."
    ),
}


def _error_reply(error_code: SimulationErrorCode | None) -> str:
    """Retorna mensagem de erro de negócio adequada ao código.

    Nunca inventa taxa, prazo ou parcela (doc 06 §5.6).
    """
    code = error_code if error_code is not None else SimulationErrorCode.UNKNOWN
    return _ERROR_MESSAGES.get(code, _ERROR_MESSAGES[SimulationErrorCode.UNKNOWN])


# ---------------------------------------------------------------------------
# Composição da resposta via LLM
# ---------------------------------------------------------------------------


async def _compose_reply(
    *,
    simulation: GenerateCreditSimulationOutput,
    product_name: str,
    amount: float,
    term_months: int,
    customer_name: str | None,
    conversation_id: str,
    lead_id: str | None,
    prompt_key: str,
    prompt_version: str,
    prompt_body: str,
) -> str:
    """Chama o LLM reasoner para compor a resposta em linguagem natural.

    DLP aplicado antes do envio (LGPD §8.4). Em falha do gateway, retorna
    mensagem de fallback com os dados da simulação sem texto gerado por IA.

    Args:
        simulation: Resultado bem-sucedido de generate_credit_simulation.
        product_name: Nome do produto selecionado.
        amount: Valor solicitado.
        term_months: Prazo solicitado.
        customer_name: Nome do cliente (opcional, para personalização).
        conversation_id: ID da conversa para escopo DLP.
        lead_id: UUID do lead (para logging).
        prompt_key: Chave do prompt versionado.
        prompt_version: Versão do prompt versionado.
        prompt_body: Corpo do prompt (sem frontmatter).

    Returns:
        Texto da resposta ao cliente.
    """
    sim_context = json.dumps(
        {
            "produto": product_name,
            "valor_solicitado": amount,
            "prazo_meses": term_months,
            "parcela_mensal": simulation.installment or "—",
            "total_a_pagar": simulation.total or "—",
            "total_juros": simulation.interest or "—",
            "taxa_mensal": simulation.rate or "—",
        },
        ensure_ascii=False,
    )

    # Adiciona nome do cliente ao contexto do usuário se disponível
    user_content = f"Nome do cliente: {customer_name}\n\n" if customer_name else ""
    user_content += f"Dados da simulação:\n{sim_context}"

    # DLP: aplica redação de PII no conteúdo do usuário (LGPD §8.4)
    dlp_result = redact_pii(user_content)
    safe_user_content = dlp_result.text

    if dlp_result.counts:
        log.info(
            "generate_simulation_dlp_applied",
            conversation_id=conversation_id,
            lead_id=lead_id,
            pii_types=list(dlp_result.counts.keys()),
        )

    llm_messages: list[dict[str, Any]] = [
        {"role": "system", "content": prompt_body.strip()},
        {"role": "user", "content": safe_user_content},
    ]

    try:
        gateway = get_gateway()
        response = await gateway.complete(
            model=for_role("reasoner"),
            messages=llm_messages,
            temperature=0.3,
            max_tokens=512,
            metadata={
                "node": "generate_simulation",
                "lead_id": lead_id,
                "prompt_key": prompt_key,
                "prompt_version": prompt_version,
                "conversation_id": conversation_id,
            },
            conversation_id=conversation_id,
            dlp=False,  # DLP já aplicado manualmente acima
        )
        return response.content.strip()
    except Exception:
        log.exception(
            "generate_simulation_llm_error",
            conversation_id=conversation_id,
            lead_id=lead_id,
        )
        # Fallback seguro: apresenta os dados sem texto gerado por IA.
        # Não inventa taxa/prazo (doc 06 §5.6).
        installment = simulation.installment or "—"
        total = simulation.total or "—"
        return (
            f"Sua simulação de *R$ {amount:,.2f}* em *{term_months} meses* pelo "
            f"produto *{product_name}* resultou em parcelas de *R$ {installment}/mês*, "
            f"totalizando *R$ {total}*. Deseja prosseguir com essa proposta?"
        )


# ---------------------------------------------------------------------------
# Nó principal
# ---------------------------------------------------------------------------


async def generate_simulation(state: ConversationState) -> dict[str, Any]:
    """Nó LangGraph: lista produtos, gera simulação e compõe resposta ao cliente.

    Fluxo:
    1. Obtém ``requested_amount`` e ``requested_term_months`` do estado.
    2. Chama ``list_credit_products`` filtrando por cidade.
    3. Seleciona produto compatível com valor e prazo.
    4. Chama ``generate_credit_simulation`` com o produto selecionado.
    5. Grava ``last_simulation_id`` e ``selected_product_id`` no estado.
    6. Usa LLM reasoner para compor a resposta.

    Em erros de range/produto/regra → mensagem clara, sem inventar taxa (§5.6).
    Em falha de tool/gateway → handoff humano.

    Args:
        state: Estado atual do grafo. Deve conter ``requested_amount``,
               ``requested_term_months``, ``lead_id``.

    Returns:
        Dict com campos atualizados: ``last_simulation_id``, ``selected_product_id``,
        ``messages`` (com a resposta composta), ``tool_results``, ``current_stage``.
        Em falha: ``handoff_required=True`` + ``handoff_reason``.
    """
    t0 = time.monotonic()

    conversation_id: str = state.get("conversation_id", "")
    lead_id: str | None = state.get("lead_id")
    city_id: str | None = state.get("city_id")
    customer_name: str | None = state.get("customer_name")
    requested_amount: float | None = state.get("requested_amount")
    requested_term_months: int | None = state.get("requested_term_months")

    log.info(
        "generate_simulation_start",
        conversation_id=conversation_id,
        lead_id=lead_id,
        city_id=city_id,
    )

    # --- Validação de pré-condições ---
    if lead_id is None:
        log.error(
            "generate_simulation_missing_lead_id",
            conversation_id=conversation_id,
        )
        return {
            **state,
            "handoff_required": True,
            "handoff_reason": "generate_simulation: lead_id ausente no estado.",
            "errors": [
                *list(state.get("errors") or []),
                {
                    "node": "generate_simulation",
                    "error_code": "MISSING_LEAD_ID",
                    "message": "lead_id ausente no estado ao entrar em generate_simulation.",
                },
            ],
        }

    if requested_amount is None or requested_term_months is None:
        log.error(
            "generate_simulation_missing_qualification",
            conversation_id=conversation_id,
            lead_id=lead_id,
            requested_amount=requested_amount,
            requested_term_months=requested_term_months,
        )
        return {
            **state,
            "handoff_required": True,
            "handoff_reason": (
                "generate_simulation: valor ou prazo não qualificados no estado."
            ),
            "errors": [
                *list(state.get("errors") or []),
                {
                    "node": "generate_simulation",
                    "error_code": "MISSING_QUALIFICATION",
                    "message": (
                        f"requested_amount={requested_amount}, "
                        f"requested_term_months={requested_term_months}"
                    ),
                },
            ],
        }

    try:
        # --- Carrega prompt versionado ---
        prompt_key, prompt_version, prompt_body = _load_prompt()

        # --- Passo 1: lista produtos compatíveis ---
        products_input = ListCreditProductsInput(city_id=city_id)
        products_output = await list_credit_products(products_input)
        products = products_output.products

        if not products:
            log.warning(
                "generate_simulation_no_products",
                conversation_id=conversation_id,
                lead_id=lead_id,
                city_id=city_id,
            )
            reply = _error_reply(SimulationErrorCode.NO_ACTIVE_PRODUCT)
            latency_ms = round((time.monotonic() - t0) * 1000, 1)
            return {
                **state,
                "handoff_required": True,
                "handoff_reason": "Nenhum produto ativo encontrado para a cidade.",
                "current_stage": "simulacao",
                "messages": [
                    *list(state.get("messages") or []),
                    {"role": "assistant", "content": reply},
                ],
                "tool_results": [
                    *list(state.get("tool_results") or []),
                    {
                        "node": "generate_simulation",
                        "step": "list_products",
                        "products_count": 0,
                        "latency_ms": latency_ms,
                    },
                ],
                "errors": [
                    *list(state.get("errors") or []),
                    {
                        "node": "generate_simulation",
                        "error_code": "NO_ACTIVE_PRODUCT",
                        "message": "Backend retornou lista vazia de produtos.",
                    },
                ],
            }

        # --- Passo 2: seleciona produto compatível ---
        product_id = _select_compatible_product(
            products=products,
            amount=requested_amount,
            term_months=requested_term_months,
        )

        # Obtém o nome do produto selecionado para a resposta
        product_name = "Microcrédito"  # fallback legível
        if product_id is not None:
            for p in products:
                if str(p.id) == product_id:
                    product_name = p.name
                    break

        # Se nenhum produto for compatível, deixa o backend decidir (product_id=None).
        # O backend pode ter regras de compatibilidade mais refinadas.

        # --- Passo 3: gera a simulação ---
        sim_input = GenerateCreditSimulationInput(
            lead_id=lead_id,
            amount=requested_amount,
            term_months=requested_term_months,
            product_id=product_id,
        )
        sim_result = await generate_credit_simulation(sim_input)

        latency_ms = round((time.monotonic() - t0) * 1000, 1)

        # --- Erro de negócio (range, produto, regra) ---
        if not sim_result.ok:
            reply = _error_reply(sim_result.error_code)
            log.warning(
                "generate_simulation_business_error",
                conversation_id=conversation_id,
                lead_id=lead_id,
                error_code=str(sim_result.error_code),
                latency_ms=latency_ms,
            )
            # Range/produto inválido: não faz handoff automático — permite ao cliente
            # reformular. Mas registra o erro para o nó decide_next_step decidir.
            return {
                **state,
                "current_stage": "simulacao",
                "messages": [
                    *list(state.get("messages") or []),
                    {"role": "assistant", "content": reply},
                ],
                "tool_results": [
                    *list(state.get("tool_results") or []),
                    {
                        "node": "generate_simulation",
                        "prompt_key": prompt_key,
                        "prompt_version": prompt_version,
                        "step": "generate_simulation",
                        "error_code": str(sim_result.error_code),
                        "latency_ms": latency_ms,
                    },
                ],
                "errors": [
                    *list(state.get("errors") or []),
                    {
                        "node": "generate_simulation",
                        "error_code": str(sim_result.error_code),
                        "message": sim_result.error_message or "Erro de negócio na simulação.",
                    },
                ],
            }

        # --- Passo 4: simulação bem-sucedida → compõe resposta via LLM ---
        reply = await _compose_reply(
            simulation=sim_result,
            product_name=product_name,
            amount=requested_amount,
            term_months=requested_term_months,
            customer_name=customer_name,
            conversation_id=conversation_id,
            lead_id=lead_id,
            prompt_key=prompt_key,
            prompt_version=prompt_version,
            prompt_body=prompt_body,
        )

        latency_ms = round((time.monotonic() - t0) * 1000, 1)

        log.info(
            "generate_simulation_ok",
            conversation_id=conversation_id,
            lead_id=lead_id,
            simulation_id=sim_result.simulation_id,
            product_id=product_id,
            prompt_key=prompt_key,
            prompt_version=prompt_version,
            latency_ms=latency_ms,
        )

        return {
            **state,
            "last_simulation_id": sim_result.simulation_id,
            "selected_product_id": product_id,
            "current_stage": "simulacao",
            "messages": [
                *list(state.get("messages") or []),
                {"role": "assistant", "content": reply},
            ],
            "tool_results": [
                *list(state.get("tool_results") or []),
                {
                    "node": "generate_simulation",
                    "prompt_key": prompt_key,
                    "prompt_version": prompt_version,
                    "simulation_id": sim_result.simulation_id,
                    "product_id": product_id,
                    "latency_ms": latency_ms,
                },
            ],
            "actions_emitted": [
                *list(state.get("actions_emitted") or []),
                {
                    "action": "simulation_generated",
                    "simulation_id": sim_result.simulation_id,
                    "product_id": product_id,
                    "lead_id": lead_id,
                },
            ],
        }

    except Exception as exc:
        latency_ms = round((time.monotonic() - t0) * 1000, 1)
        log.error(
            "generate_simulation_error",
            conversation_id=conversation_id,
            lead_id=lead_id,
            error=str(exc),
            latency_ms=latency_ms,
        )
        return {
            **state,
            "handoff_required": True,
            # LGPD/segurança: handoff_reason e errors são persistidos no estado
            # (jsonb). str(exc) de httpx expõe a URL interna — texto genérico +
            # nome da exceção. O detalhe completo fica só no log estruturado acima.
            "handoff_reason": "Erro ao gerar simulação. Transferindo para atendimento.",
            "errors": [
                *list(state.get("errors") or []),
                {
                    "node": "generate_simulation",
                    "error": type(exc).__name__,
                    "latency_ms": latency_ms,
                },
            ],
        }


__all__ = ["generate_simulation"]
