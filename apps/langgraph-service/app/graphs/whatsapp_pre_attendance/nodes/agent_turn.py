"""No agent_turn -- loop ReAct de tool-calling com o LLM agentico.

Coracao do Bloco B (F16-S40). Substitui o funil deterministico quando
PRE_ATTENDANCE_AGENTIC_ENABLED=true. O funil antigo permanece intacto.

LGPD (doc 17 par.8.4):
    DLP e aplicado pelo gateway em TODA chamada (dlp=True e o padrao).
    Nenhuma PII bruta sai para o suboperador internacional.
    Logs usam apenas IDs e contadores.
"""
from __future__ import annotations

import json
import re
import time
from typing import Any

import structlog

from app.graphs.whatsapp_pre_attendance.state import (
    MAX_MESSAGES,
    ConversationState,
)
from app.llm.factory import for_role, get_gateway
from app.prompts.loader import PromptNotFoundError, load_active_prompt

log: structlog.stdlib.BoundLogger = structlog.get_logger(__name__)

_PROMPT_KEY = "pre_attendance_agent"

#: Cap de tool-calls por turno -- evita loop custoso.
MAX_TOOL_CALLS_PER_TURN: int = 4

_DEFAULT_TEMPERATURE = 0.3
_DEFAULT_MAX_TOKENS = 1024

# ---------------------------------------------------------------------------
# Helpers de tool schema
# ---------------------------------------------------------------------------


def _prop(typ: str, desc: str, **extra: Any) -> dict[str, Any]:
    d: dict[str, Any] = {"type": typ, "description": desc}
    d.update(extra)
    return d


def _tool(
    name: str,
    desc: str,
    props: dict[str, Any],
    required: list[str],
) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": desc,
            "parameters": {
                "type": "object",
                "properties": props,
                "required": required,
            },
        },
    }


def _build_tool_schemas() -> list[dict[str, Any]]:
    """Retorna definicoes de tools no formato OpenAI tool-calling."""
    return [
        _tool(
            "get_or_create_lead",
            "Garante que existe um lead para o telefone informado.",
            {
                "phone": _prop("string", "Telefone E.164"),
                "name": _prop("string", "Nome do lead"),
                "organization_id": _prop("string", "UUID da org"),
            },
            required=["phone", "organization_id"],
        ),
        _tool(
            "get_customer_context",
            "Retorna ficha resumida de lead sem PII sensivel.",
            {"lead_id": _prop("string", "UUID do lead")},
            required=["lead_id"],
        ),
        _tool(
            "update_lead_profile",
            "Atualiza perfil do lead com dados coletados.",
            {
                "lead_id": _prop("string", "UUID do lead"),
                "name": _prop("string", "Nome"),
                "city_id": _prop("string", "UUID cidade"),
                "requested_amount": _prop("string", "Valor"),
                "requested_term_months": _prop("integer", "Prazo"),
            },
            required=["lead_id"],
        ),
        _tool(
            "identify_city",
            "Identifica a cidade de Rondonia a partir de texto livre.",
            {
                "city_text": _prop("string", "Texto do cliente"),
                "organization_id": _prop("string", "UUID da org"),
                "lead_id": _prop("string", "UUID lead"),
            },
            required=["city_text", "organization_id"],
        ),
        _tool(
            "list_active_cities",
            "Lista as cidades que o Banco do Povo atende ATUALMENTE (ativas). "
            "Use sempre que o cliente perguntar quais cidades sao atendidas, ou "
            "para informar a cobertura. Nunca invente nem assuma a lista — "
            "consulte esta tool, pois a cobertura muda quando ativam/desativam cidades.",
            {
                "organization_id": _prop("string", "UUID da org"),
            },
            required=["organization_id"],
        ),
        _tool(
            "list_credit_products",
            "Lista produtos de credito ativos.",
            {
                "organization_id": _prop("string", "UUID da org"),
                "city_id": _prop("string", "UUID cidade"),
            },
            required=["organization_id"],
        ),
        _tool(
            "generate_credit_simulation",
            "Gera simulacao de credito.",
            {
                "lead_id": _prop("string", "UUID lead"),
                "amount": _prop("number", "Valor reais"),
                "term_months": _prop("integer", "Prazo meses"),
                "product_id": _prop("string", "UUID produto"),
            },
            required=["lead_id", "amount", "term_months"],
        ),
        _tool(
            "request_handoff",
            "Solicita transferencia para atendente humano.",
            {
                "reason": _prop("string", "Motivo"),
                "lead_id": _prop("string", "UUID lead"),
                "chatwoot_conversation_id": _prop("string", "ID Chatwoot"),
                "organization_id": _prop("string", "UUID org"),
                "summary": _prop("string", "Resumo sem PII"),
            },
            required=[
                "reason",
                "chatwoot_conversation_id",
                "organization_id",
                "lead_id",
                "summary",
            ],
        ),
        _tool(
            "log_ai_decision",
            "Registra decisao de IA.",
            {
                "organization_id": _prop("string", "UUID org"),
                "conversation_id": _prop("string", "UUID conversa"),
                "lead_id": _prop("string", "UUID lead"),
                "node_name": _prop("string", "Nome no"),
                "decision": _prop("object", "Output"),
                "correlation_id": _prop("string", "UUID correlacao"),
            },
            required=[
                "organization_id",
                "conversation_id",
                "node_name",
                "decision",
                "correlation_id",
            ],
        ),
    ]


async def _dispatch_tool(
    tool_name: str,
    tool_args: dict[str, Any],
    state: ConversationState,
) -> str:
    """Executa uma tool por nome e retorna o resultado como string JSON.

    Importa as tools em runtime. Injeta organization_id AUTORITATIVO do estado
    (sempre sobrescreve o valor do LLM, que aluciona o UUID de exemplo).
    """
    org_id: str = state.get("organization_id", "")
    lead_id: str | None = state.get("lead_id")
    conversation_id: str = state.get("conversation_id", "")

    # organization_id é AUTORITATIVO do estado — igual ao telefone, NUNCA confiar
    # no valor do LLM. O modelo não vê o UUID real (DLP redige) e tende a alucinar
    # o UUID de exemplo `f47ac10b-58cc-4372-a567-0e02b2c3d479`, causando FK
    # violation (fk_leads_organization) no get_or_create_lead → 500 → conversa
    # travada. Sempre sobrescreve com o org do estado quando disponível.
    if org_id:
        tool_args = {**tool_args, "organization_id": org_id}

    def _dump(res: Any) -> str:
        return json.dumps(
            res.model_dump() if hasattr(res, "model_dump") else dict(res)
        )

    try:
        if tool_name == "get_or_create_lead":
            from app.tools.leads_tools import (
                GetOrCreateLeadInput,
                get_or_create_lead,
            )
            # Telefone autoritativo: vem SEMPRE do estado (numero real do cliente),
            # nunca do LLM. O DLP redige o telefone antes do modelo ver, entao o LLM
            # so chutaria (ex.: +55000...0000) -> lead com telefone errado / 400.
            phone_state: str = state.get("phone", "") or ""
            if phone_state:
                tool_args = {**tool_args, "phone": phone_state}
            # Nome inicial = push name do WhatsApp (state.customer_name) quando o LLM
            # ainda nao coletou o nome real. Evita lead "Desconhecido" no CRM e o 400
            # de name="". update_lead_profile sobrescreve com o nome real depois.
            if not tool_args.get("name") and state.get("customer_name"):
                tool_args = {**tool_args, "name": state["customer_name"]}
            inp = GetOrCreateLeadInput(**tool_args)
            result = await get_or_create_lead.ainvoke(inp.model_dump())
            return _dump(result)

        elif tool_name == "get_customer_context":
            from app.tools.leads_tools import get_customer_context
            result = await get_customer_context.ainvoke(tool_args)
            return _dump(result)

        elif tool_name == "update_lead_profile":
            from app.tools.leads_tools import (
                UpdateLeadProfileInput,
                update_lead_profile,
            )
            inp_upd: UpdateLeadProfileInput = UpdateLeadProfileInput(**tool_args)
            result = await update_lead_profile.ainvoke(inp_upd.model_dump())
            return _dump(result)

        elif tool_name == "identify_city":
            from app.tools.city_tools import (
                IdentifyCityInput,
                identify_city,
            )
            if not tool_args.get("lead_id") and lead_id:
                tool_args = {**tool_args, "lead_id": lead_id}
            inp_city: IdentifyCityInput = IdentifyCityInput(**tool_args)
            result = await identify_city(
                city_text=inp_city.city_text,
                organization_id=inp_city.organization_id,
                lead_id=inp_city.lead_id,
            )
            return _dump(result)

        elif tool_name == "list_active_cities":
            from app.tools.city_tools import list_active_cities

            result = await list_active_cities(
                organization_id=tool_args.get("organization_id") or org_id,
            )
            return _dump(result)

        elif tool_name == "list_credit_products":
            from app.tools.simulation_tools import (
                ListCreditProductsInput,
                list_credit_products,
            )
            inp_lcp: ListCreditProductsInput = ListCreditProductsInput(**tool_args)
            result = await list_credit_products(inp_lcp)
            return _dump(result)

        elif tool_name == "generate_credit_simulation":
            from app.tools.simulation_tools import (
                GenerateCreditSimulationInput,
                generate_credit_simulation,
            )
            inp_sim: GenerateCreditSimulationInput = GenerateCreditSimulationInput(**tool_args)
            result = await generate_credit_simulation(inp_sim)
            return _dump(result)

        elif tool_name == "request_handoff":
            # Live chat próprio: o handoff REAL é executado pelo worker Node
            # (triggerLivechatHandoff em livechat/ai-handoff.ts) a partir da flag
            # handoff_required — usando o UUID nativo de conversations.id, enviando
            # mensagem ao cliente ("um atendente vai te responder"), marcando
            # status=pending, socket e audit. O agent_turn seta hf_tool=True pelo
            # NOME desta tool (ver abaixo), então o handoff dispara pela flag.
            #
            # Esta tool é apenas SINALIZAÇÃO: NÃO chamar POST /internal/handoffs.
            # Aquele endpoint é legado Chatwoot (conversationId = z.coerce.number();
            # int("0")/UUID -> 400) e no live chat próprio sempre falhava sem efeito
            # útil. Chamá-lo só gerava ruído (ValueError/400) e confundia o LLM com
            # um resultado de tool "failed". Ver chatwoot_tools.py:147.
            _hf_reason = tool_args.get("reason") or "cliente_solicitou_atendente"
            log.info(
                "request_handoff_signaled",
                conversation_id=conversation_id,
                lead_id=lead_id,
                reason=_hf_reason,
            )
            return json.dumps(
                {"ok": True, "status": "handoff_requested", "reason": _hf_reason}
            )

        elif tool_name == "log_ai_decision":
            from app.tools.audit_tools import (
                LogAiDecisionInput,
                log_ai_decision,
            )
            if not tool_args.get("conversation_id"):
                tool_args = {**tool_args, "conversation_id": conversation_id}
            if not tool_args.get("correlation_id"):
                tool_args = {**tool_args, "correlation_id": conversation_id}
            inp_log: LogAiDecisionInput = LogAiDecisionInput(**tool_args)
            result = await log_ai_decision(inp_log)
            return json.dumps(
                result.model_dump() if hasattr(result, "model_dump") else {"ok": True}
            )

        else:
            log.warning("agent_turn_unknown_tool", tool_name=tool_name)
            return json.dumps({"error": f"Tool not found: {tool_name}"})

    except Exception as exc:
        log.warning(
            "agent_turn_tool_error",
            tool_name=tool_name,
            error_type=type(exc).__name__,
        )
        log.debug(
            "agent_turn_tool_error_detail",
            tool_name=tool_name,
            error=str(exc),
        )
        return json.dumps({"error": type(exc).__name__, "message": "tool execution failed"})


def _extract_state_updates(
    tool_results_this_turn: list[dict[str, Any]],
) -> dict[str, Any]:
    """Extrai atualizacoes de estado leve dos resultados de tools deste turno."""
    updates: dict[str, Any] = {}
    for entry in tool_results_this_turn:
        tool = entry.get("tool", "")
        data = entry.get("result_data", {})
        if tool == "identify_city":
            if data.get("matched") and data.get("city_id"):
                updates["city_id"] = data["city_id"]
                if data.get("city_name"):
                    updates["city_name"] = data["city_name"]
        elif tool == "update_lead_profile":
            if data.get("ok"):
                if data.get("city_id"):
                    updates["city_id"] = data["city_id"]
                if data.get("name"):
                    updates["customer_name"] = data["name"]
        elif tool == "generate_credit_simulation":
            if data.get("ok") and data.get("simulation_id"):
                updates["last_simulation_id"] = data["simulation_id"]
        elif tool == "get_or_create_lead":
            if data.get("lead_id"):
                updates["lead_id"] = data["lead_id"]
            if data.get("customer_id"):
                updates["customer_id"] = data["customer_id"]
        elif tool == "request_handoff":
            updates["handoff_required"] = True
            updates["handoff_reason"] = "handoff solicitado pelo agente via tool"
    return updates


def _build_state_context(state: ConversationState) -> str:
    """Constroi contexto estruturado do estado leve sem PII."""
    parts: list[str] = []
    if state.get("customer_name"):
        parts.append(f"- Nome do cliente: {state['customer_name']}")
    if state.get("city_name"):
        parts.append(f"- Cidade: {state['city_name']}")
    elif state.get("city_id"):
        parts.append(f"- Cidade identificada (city_id={state['city_id']})")
    if state.get("lead_id"):
        parts.append(f"- Lead registrado (id={state['lead_id']})")
    if state.get("activity"):
        parts.append(f"- Atividade/ocupacao: {state['activity']}")
    if state.get("profile"):
        parts.append(f"- Perfil: {state['profile']}")
    if state.get("credit_objective"):
        parts.append(f"- Objetivo do credito: {state['credit_objective']}")
    if state.get("requested_amount") is not None:
        parts.append(f"- Valor solicitado: R$ {state['requested_amount']:,.2f}")
    if state.get("requested_term_months") is not None:
        parts.append(f"- Prazo solicitado: {state['requested_term_months']} meses")
    if state.get("scr_authorized") is not None:
        val = "sim" if state["scr_authorized"] else "nao"
        parts.append(f"- Autorizacao SCR: {val}")
    if state.get("last_simulation_id"):
        parts.append(f"- Simulacao gerada (id={state['last_simulation_id']})")
    if state.get("collection_status") and state["collection_status"] != "none":
        parts.append(f"- Status de cobranca: {state['collection_status']}")
    if state.get("cpf_collected"):
        parts.append("- CPF coletado: sim (enviado ao backend)")
    return chr(10).join(parts) if parts else "Nenhum dado coletado ainda nesta sessao."


# Regex para extrair bloco JSON de um bloco de codigo markdown (```json ... ```)
_MD_JSON_RE = re.compile(r"```(?:json)?\s*([\s\S]*?)```", re.IGNORECASE)


def _parse_agent_output(raw: str) -> tuple[str, list[str]]:
    """Extrai texto e lista de mensagens do output bruto do LLM (F16-S46 BUG-A).

    O prompt Ana Clara instrui o modelo a responder com:
        {"messages": ["Mensagem 1", "Mensagem 2"]}

    Esta funcao normaliza 3 formatos possiveis:

    1. JSON puro: '{"messages": ["..."]}' -> extrai lista messages[].
    2. JSON em bloco markdown: '```json\\n{"messages": [...]}\\n```' -> limpa e extrai.
    3. Texto puro (fallback): retorna o texto como lista com 1 elemento.

    Args:
        raw: Conteudo bruto de resp.content do gateway.

    Returns:
        Tupla (fin, messages) onde:
        - fin: primeira mensagem (retrocompatibilidade com reply.content)
        - messages: lista de strings para send_response (pode ser [fin] se 1 msg)

    LGPD: nao aplica transformacao de PII -- o DLP foi aplicado antes pelo gateway.
    """
    if not raw or not raw.strip():
        return "", []

    text = raw.strip()

    # Tentativa 1: extrair JSON de bloco markdown
    md_match = _MD_JSON_RE.search(text)
    if md_match:
        text = md_match.group(1).strip()

    # Tentativa 2: parsear como JSON
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            msgs = parsed.get("messages")
            if isinstance(msgs, list) and msgs:
                # Filtrar so strings nao-vazias
                str_msgs: list[str] = [
                    str(m).strip() for m in msgs if isinstance(m, str) and str(m).strip()
                ]
                if str_msgs:
                    return str_msgs[0], str_msgs
            # JSON valido mas sem messages[] -- usa repr do valor como texto
            # (nao deve acontecer com o prompt atual; fallback defensivo)
            _parsed_type = type(parsed).__name__
            _parsed_keys = list(parsed.keys()) if isinstance(parsed, dict) else _parsed_type
            log.warning(
                "agent_turn_json_no_messages",
                parsed_keys=_parsed_keys,
            )
    except (json.JSONDecodeError, ValueError):
        # Nao e JSON -- path de texto puro (fallback ou modelo que nao seguiu o prompt)
        pass

    # Fallback: texto puro -- retorna como mensagem unica
    return text, [text]


async def agent_turn(state: ConversationState) -> dict[str, Any]:
    start = time.monotonic()
    conversation_id: str = state.get("conversation_id", "")
    lead_id: str | None = state.get("lead_id")
    errors: list[dict[str, Any]] = list(state.get("errors", []))
    tool_results: list[dict[str, Any]] = list(state.get("tool_results", []))
    actions_emitted: list[dict[str, Any]] = list(state.get("actions_emitted", []))
    tool_results_this_turn: list[dict[str, Any]] = []

    # FIX 3: valida organization_id antes de qualquer chamada externa.
    # org_id vazio geraria requisicoes /internal com 400 em cascata.
    org_id_early: str = state.get("organization_id", "") or ""
    if not org_id_early:
        lat_early = (time.monotonic() - start) * 1000
        log.warning(
            "agent_turn_missing_org_id",
            conversation_id=conversation_id,
            lead_id=lead_id,
            latency_ms=round(lat_early, 1),
        )
        errors.append({
            "node": "agent_turn",
            "error": "MISSING_ORG_ID",
            "latency_ms": round(lat_early, 1),
        })
        return {
            "handoff_required": True,
            "handoff_reason": "organization_id ausente -- handoff automatico.",
            "errors": errors,
            "tool_results": [
                *tool_results,
                {"node": "agent_turn", "error": "MISSING_ORG_ID"},
            ],
        }

    try:
        active_prompt = await load_active_prompt(_PROMPT_KEY)
        prompt_key = active_prompt.key
        prompt_version = active_prompt.prompt_version
        prompt_body = active_prompt.body
        eff_t = (
            active_prompt.temperature
            if active_prompt.temperature is not None
            else _DEFAULT_TEMPERATURE
        )
        eff_m = (
            active_prompt.max_tokens
            if active_prompt.max_tokens is not None
            else _DEFAULT_MAX_TOKENS
        )

        state_ctx = _build_state_context(state)
        sep = chr(10)
        sys_content = (
            prompt_body.strip()
            + sep + sep
            + "## Estado atual da conversa"
            + sep + state_ctx
        )
        sys_msg: dict[str, Any] = {"role": "system", "content": sys_content}
        hist: list[dict[str, Any]] = list(state.get("messages", []))
        if len(hist) > MAX_MESSAGES:
            hist = hist[-MAX_MESSAGES:]
        msgs: list[dict[str, Any]] = [sys_msg, *hist]

        gw = get_gateway()
        schemas = _build_tool_schemas()
        tc_n = 0
        fin: str = ""
        # F16-S46 BUG-A: lista de mensagens parseadas do JSON {"messages": [...]}
        parsed_messages: list[str] = []
        hf_tool: bool = False
        fr: str = "stop"
        # BUGFIX (prod 2026-06-26): modelos (ex.: Claude) frequentemente emitem a
        # mensagem ao cliente JUNTO com um tool_call e depois encerram o turno final
        # com content VAZIO. O loop so capturava o turno final -> texto perdido ->
        # reply.type=none -> cliente sem resposta. Guardamos o ultimo content
        # nao-vazio de QUALQUER turno para recuperar nesse caso.
        last_nonempty_content: str = ""

        while True:
            mdl = (
                active_prompt.model_recommended
                if active_prompt.model_recommended
                else for_role("reasoner")
            )
            resp = await gw.complete(
                model=mdl,
                messages=msgs,
                tools=schemas,
                temperature=eff_t,
                max_tokens=eff_m,
                metadata={
                    "node": "agent_turn",
                    "lead_id": lead_id,
                    "prompt_key": prompt_key,
                    "tc_n": tc_n,
                },
                conversation_id=conversation_id,
            )
            fr = resp.finish_reason or "stop"
            # Guarda o ultimo content nao-vazio (inclui turnos com tool_calls, onde o
            # modelo costuma escrever a mensagem ao cliente). Recuperado se o turno
            # final vier vazio.
            if resp.content and resp.content.strip():
                last_nonempty_content = resp.content
            raw_ch = resp.raw.get("choices", [])
            raw_msg = raw_ch[0].get("message", {}) if raw_ch else {}
            rtcs = raw_msg.get("tool_calls") or []
            wt = fr == "tool_calls" or bool(rtcs)

            if wt and tc_n < MAX_TOOL_CALLS_PER_TURN:
                msgs.append({
                    "role": "assistant",
                    "content": resp.content or None,
                    "tool_calls": rtcs,
                })
                cap_hit = False
                for tc in rtcs:
                    # FIX 1: verificar o cap POR tool-call antes de despachar.
                    # Sem isso, um batch de N>cap tool_calls burla o limite
                    # porque tc_n so era checado na entrada do while.
                    if tc_n >= MAX_TOOL_CALLS_PER_TURN:
                        log.warning(
                            "agent_turn_tool_cap_reached",
                            conversation_id=conversation_id,
                            lead_id=lead_id,
                            cap=MAX_TOOL_CALLS_PER_TURN,
                            batch_remaining=len(rtcs),
                        )
                        cap_hit = True
                        break

                    tc_n += 1
                    tid = tc.get("id", "call_" + str(tc_n))
                    tfn = tc.get("function", {})
                    tnm = tfn.get("name", "")
                    tar = tfn.get("arguments", "{}")
                    try:
                        ta = json.loads(tar)
                    except json.JSONDecodeError:
                        ta = {}
                    log.info(
                        "agent_turn_tool_call",
                        conversation_id=conversation_id,
                        lead_id=lead_id,
                        tool_name=tnm,
                        call_number=tc_n,
                    )
                    ts = await _dispatch_tool(tnm, ta, state)
                    try:
                        td = json.loads(ts)
                    except json.JSONDecodeError:
                        td = {}
                    tool_results_this_turn.append({
                        "node": "agent_turn",
                        "tool": tnm,
                        "tool_call_id": tid,
                        "result_data": td,
                        "call_number": tc_n,
                    })
                    msgs.append({
                        "role": "tool",
                        "tool_call_id": tid,
                        "content": ts,
                    })
                    if tnm == "request_handoff":
                        hf_tool = True

                if cap_hit or tc_n >= MAX_TOOL_CALLS_PER_TURN:
                    if not cap_hit:
                        # atingiu o cap exatamente no ultimo item do batch
                        log.warning(
                            "agent_turn_tool_cap_reached",
                            conversation_id=conversation_id,
                            lead_id=lead_id,
                            cap=MAX_TOOL_CALLS_PER_TURN,
                        )
                    cap_resp = await gw.complete(
                        model=mdl,
                        messages=msgs,
                        tools=None,
                        temperature=eff_t,
                        max_tokens=eff_m,
                        metadata={"node": "agent_turn", "phase": "cap"},
                        conversation_id=conversation_id,
                    )
                    # F16-S46 BUG-A: parsear {"messages":[...]} do output do modelo.
                    if cap_resp.content and cap_resp.content.strip():
                        last_nonempty_content = cap_resp.content
                    fin, parsed_messages = _parse_agent_output(cap_resp.content or "")
                    if not parsed_messages and last_nonempty_content:
                        # turno final vazio -> recupera o ultimo content nao-vazio
                        fin, parsed_messages = _parse_agent_output(last_nonempty_content)
                    # F16-S50: persistir o reply COMPLETO no historico (todas as msgs),
                    # nao so a 1a -- senao a IA nao ve o que realmente disse e re-sauda.
                    _assistant_hist = (
                        (chr(10) + chr(10)).join(parsed_messages)
                        if parsed_messages
                        else (cap_resp.content or "")
                    )
                    msgs.append({"role": "assistant", "content": _assistant_hist})
                    break
                continue

            else:
                # F16-S46 BUG-A: parsear {"messages":[...]} do output do modelo.
                fin, parsed_messages = _parse_agent_output(resp.content or "")
                if not parsed_messages and last_nonempty_content:
                    # BUGFIX (prod 2026-06-26): turno final vazio (Claude escreveu a
                    # mensagem junto com um tool_call anterior) -> recupera o ultimo
                    # content nao-vazio para nao deixar o cliente sem resposta.
                    fin, parsed_messages = _parse_agent_output(last_nonempty_content)
                # F16-S50: persistir o reply COMPLETO no historico (todas as msgs),
                # nao so a 1a -- senao a IA nao ve o que realmente disse e re-sauda.
                _assistant_hist = (
                    (chr(10) + chr(10)).join(parsed_messages)
                    if parsed_messages
                    else (resp.content or "")
                )
                msgs.append({"role": "assistant", "content": _assistant_hist})
                break

        su = _extract_state_updates(tool_results_this_turn)
        lat = (time.monotonic() - start) * 1000

        # FIX 2: auditoria incondicional ao fim do turno.
        # Antes, log_ai_decision so era chamada se o LLM decidisse invocar a
        # tool -- o que tornava a trilha de auditoria opcional e incompleta.
        # Agora garantimos um registro por turno com apenas IDs + contadores
        # (sem PII), espelhando o comportamento do funil deterministico.
        try:
            await _dispatch_tool(
                "log_ai_decision",
                {
                    "organization_id": org_id_early,
                    "conversation_id": conversation_id,
                    # F16-S47 BUG-3: lead_id deve ser None (omitido) quando ausente.
                    # "" falha a validacao .uuid() do backend -> 400 "leadId deve ser UUID".
                    "lead_id": lead_id,
                    "node_name": "agent_turn",
                    "decision": {
                        "tool_calls": tc_n,
                        "finish_reason": fr,
                        "prompt_version": prompt_version,
                        "handoff_from_tool": hf_tool,
                    },
                    "correlation_id": conversation_id,
                },
                state,
            )
        except Exception as _audit_exc:
            log.warning(
                "agent_turn_audit_error",
                conversation_id=conversation_id,
                error_type=type(_audit_exc).__name__,
            )

        log.info(
            "agent_turn_done",
            conversation_id=conversation_id,
            lead_id=lead_id,
            prompt_key=prompt_key,
            prompt_version=prompt_version,
            tool_calls=tc_n,
            latency_ms=round(lat, 1),
            handoff_from_tool=hf_tool,
        )
        # F16-S46 BUG-A: construir reply_content a partir das mensagens parseadas.
        # Se o modelo retornou {"messages": ["A", "B"]}, juntamos com \n\n para
        # que send_response._content_to_messages (que splitta por \n\n) re-derive
        # a lista correta de mensagens individuais para o cliente.
        # Fallback: fin sozinho (texto puro ou JSON nao-reconhecido).
        reply_content: str = (chr(10) + chr(10)).join(parsed_messages) if parsed_messages else fin
        log.info(
            "agent_turn_reply_content",
            conversation_id=conversation_id,
            lead_id=lead_id,
            parsed_messages_count=len(parsed_messages),
            reply_content_length=len(reply_content),
            fin_is_empty=not bool(fin),
        )

        # Rede de seguranca: se ainda assim a resposta veio vazia, NAO deixar o
        # cliente sem retorno -> handoff humano (o worker dispara a msg de fallback).
        empty_reply: bool = not reply_content.strip()
        if empty_reply and not hf_tool:
            log.warning(
                "agent_turn_empty_reply_handoff",
                conversation_id=conversation_id,
                lead_id=lead_id,
                tool_calls=tc_n,
                finish_reason=fr,
            )

        nm = msgs[1:]
        res: dict[str, Any] = {
            "messages": nm,
            "tool_results": [
                *tool_results,
                *tool_results_this_turn,
                {
                    "node": "agent_turn",
                    "prompt_key": prompt_key,
                    "prompt_version": prompt_version,
                    "tool_calls": tc_n,
                    "latency_ms": round(lat, 1),
                    "finish_reason": fr,
                },
            ],
            "actions_emitted": actions_emitted,
            "errors": errors,
            "handoff_required": hf_tool or empty_reply,
            "handoff_reason": (
                "handoff solicitado pelo agente"
                if hf_tool
                else "resposta vazia do agente -- handoff de seguranca"
                if empty_reply
                else state.get("handoff_reason")
            ),
            # F16-S46 BUG-A: reply.content contem as msgs parseadas do JSON do modelo
            # unidas por \n\n -- send_response._content_to_messages vai re-splitar
            # e gerar messages[] correto para o cliente WhatsApp.
            "reply": {
                "type": "text" if reply_content else "none",
                "content": reply_content,
                "template_name": None,
                "template_variables": None,
            },
        }
        res.update(su)
        return res

    except PromptNotFoundError as exc:
        lat = (time.monotonic() - start) * 1000
        log.error(
            "agent_turn_prompt_not_found",
            conversation_id=conversation_id,
            lead_id=lead_id,
            key=exc.key,
            latency_ms=round(lat, 1),
        )
        errors.append({
            "node": "agent_turn",
            "error": "PROMPT_NOT_FOUND",
            "latency_ms": round(lat, 1),
        })
        return {
            "handoff_required": True,
            "handoff_reason": "Prompt de agente nao encontrado -- handoff automatico.",
            "errors": errors,
            "tool_results": [
                *tool_results,
                *tool_results_this_turn,
                {"node": "agent_turn", "error": "PROMPT_NOT_FOUND"},
            ],
        }

    except Exception as exc:
        lat = (time.monotonic() - start) * 1000
        log.error(
            "agent_turn_error",
            conversation_id=conversation_id,
            lead_id=lead_id,
            error_type=type(exc).__name__,
            latency_ms=round(lat, 1),
        )
        log.debug("agent_turn_error_detail", error=str(exc))
        errors.append({
            "node": "agent_turn",
            "error": type(exc).__name__,
            "latency_ms": round(lat, 1),
        })
        return {
            "handoff_required": True,
            "handoff_reason": "agent_turn falhou: " + type(exc).__name__,
            "errors": errors,
            "tool_results": [
                *tool_results,
                *tool_results_this_turn,
                {"node": "agent_turn", "error": type(exc).__name__},
            ],
        }


__all__ = ["MAX_TOOL_CALLS_PER_TURN", "agent_turn"]
