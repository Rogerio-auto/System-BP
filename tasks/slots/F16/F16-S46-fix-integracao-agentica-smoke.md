---
id: F16-S46
title: Fix integração agêntica do pré-atendimento (bugs do smoke real)
phase: F16
task_ref: docs/planejamento-fluxo-conversacional-pre-atendimento.md
status: in-progress
priority: critical
estimated_size: M
agent_id: null
claimed_at: 2026-06-19T00:23:59Z
completed_at: null
pr_url: null
depends_on: []
blocks: []
labels: [lgpd-impact]
source_docs:
  - docs/06-langgraph-agentes.md
  - docs/planejamento-fluxo-conversacional-pre-atendimento.md
  - apps/langgraph-service/app/prompts/pre_attendance_agent.md
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F16-S46 — Fix integração agêntica (bugs do smoke real, 2026-06-19)

## Objetivo

Corrigir os 3 bugs de integração encontrados no **primeiro smoke real** do agente `agent_turn` (flag
`PRE_ATTENDANCE_AGENTIC_ENABLED=true`) — que os testes mockados (F16-S45) não pegaram porque
devolviam texto puro e `LLMResponse` já construído, sem passar pelo gateway/contrato real.

**O stack local está saudável** (api local na 3333, postgres docker, migration 0070 aplicada, prompt
`pre_attendance_agent@v1` seedado). Dá pra reproduzir cada bug com curl autenticado (`x-internal-token`
do `.env`) e/ou rodando o `dev.ps1` do langgraph com a flag ON.

## Bugs a corrigir

### A — CRÍTICO: agente não responde (`send_response_none_delegated`)

No run real, `agent_turn` terminou com `resp.content` **vazio** (LLM: 108 completion tokens,
finish_reason=stop, `tc_n=0`) → `fin=""` → `reply.type="none"` → `send_response` cai no else
(`none_delegated`) → usuário não recebe nada.

Duas causas a investigar/corrigir:

1. **Contrato `{"messages":[...]}` não é parseado.** O prompt Ana Clara (§2) manda o modelo responder
   **um objeto JSON `{"messages":[...]}`**. Hoje `agent_turn` (nodes/agent_turn.py ~544) faz
   `fin = resp.content` e `send_response` (nodes/send_response.py ~238) faz split por `\n\n`
   (`_content_to_messages`). **Ninguém faz `json.loads` do `{"messages":[...]}`.** Corrigir: o
   `agent_turn` (ou send_response) deve **parsear o JSON** do output do modelo e extrair o array
   `messages` (com fallback robusto: se vier texto puro, tratar como 1 mensagem; se vier o JSON em
   bloco markdown ```json, limpar — ver workaround do MVP n8n em ARQUITETURA §2.8).
2. **Gateway pode não extrair `tool_calls`.** `app/llm/openrouter.py::_parse_response` (~249-269) só lê
   `message.content`/`finish_reason`/`usage`. Verificar se `tool_calls` da resposta OpenRouter é
   extraído para o `LLMResponse` — se NÃO for, toda tool-call do agente é perdida e `content` vem
   vazio. Reproduzir com log do `resp` cru (model `anthropic/claude-sonnet-4`) antes de assumir.
   Se o gap existir, extrair `tool_calls` no `_parse_response` e mapear para o `LLMResponse`.

### B — `POST /internal/ai/decisions` → 400 `correlationId é obrigatório`

A api exige **`correlationId`** (camelCase) — confirmado por curl. O payload do `log_ai_decision`
(chamado incondicionalmente no fim do `agent_turn`, FIX 2 de F16-S40, ~556-573) manda
`correlation_id` (snake) e/ou a tool `audit_tools.log_ai_decision` não mapeia para `correlationId`.
Corrigir o mapeamento da tool e/ou o payload para enviar `correlationId` (+ confirmar os demais campos
camelCase: `organizationId`, `conversationId`, `nodeName`, `decision`).

### C — `PUT /internal/conversations/:id/state` → 400

`PUT` com `{organization_id, phone, state}` válidos retorna **200** (testado). O `persist_state`
(nodes/persist_state.py ~96) manda `{state: snapshot, phone, organization_id}`. O 400 ocorre porque
**`phone` (e/ou `organization_id`) chega vazio** ao persist no caminho agêntico — provavelmente não
preservado através do retorno do `agent_turn`. Garantir que `phone` e `organization_id` fluem do
`load_state` → `agent_turn` → `persist_state` (a pegadinha de merge já conhecida — ver
[[feedback_langgraph_orgid_threading]]). Validar o corpo exato do 400 e corrigir a origem.

## Escopo (faz)

- Corrigir A (parse do `{"messages":[...]}` + investigar/corrigir extração de `tool_calls` no gateway),
  B (correlationId), C (phone/org_id no persist).
- Testes que reproduzam cada bug SEM mock do contrato: parse do JSON real do modelo (incl. JSON em
  bloco markdown e texto puro de fallback); payload de `log_ai_decision` com `correlationId`; persist
  com phone/org_id preservados.
- Reproduzir contra o stack local (curl autenticado) e confirmar 2xx em ai/decisions e PUT state, e
  que o agente produz `messages[]` não-vazio.

## Fora de escopo (NÃO faz)

- Mudar a flag (continua default OFF).
- SCR / RAG (2ª onda). Worker Node (já fechado em F16-S44).
- Backend Node (`apps/api/**`) — os schemas estão certos; o gap é no produtor (langgraph).

## Arquivos permitidos

- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/agent_turn.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/send_response.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/persist_state.py`
- `apps/langgraph-service/app/tools/audit_tools.py`
- `apps/langgraph-service/app/llm/openrouter.py`
- `apps/langgraph-service/tests/**`

## Arquivos proibidos

- `apps/api/**`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/graph.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/load_state.py`

## Definition of Done

- [ ] Agente responde: `{"messages":[...]}` do modelo é parseado e vira `messages[]` não-vazio
      (fallback p/ texto puro e p/ JSON em bloco markdown)
- [ ] `tool_calls` do gateway investigado; se faltava extração, corrigido (agente consegue chamar tools)
- [ ] `POST /internal/ai/decisions` 2xx (correlationId presente) — validado contra a api local
- [ ] `PUT /internal/conversations/:id/state` 2xx (phone/org_id preservados) — validado contra a api local
- [ ] Testes determinísticos cobrindo os 3 bugs (sem mockar o contrato de saída)
- [ ] `pytest -q` + `ruff check app` + `mypy app` verdes
- [ ] LGPD §14.2 no PR (toca produtor LLM/DLP/persist)
- [ ] PR aberto com link para o slot

## Comandos de validação

```powershell
cd apps/langgraph-service
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check app
.\.venv\Scripts\python.exe -m mypy app
```

## Notas para o agente

- Reproduzir é barato: `curl -H "x-internal-token: <LANGGRAPH_INTERNAL_TOKEN do .env>" ...` contra
  `http://localhost:3333/internal/...`. org real de teste: `576a8121-838a-4904-b6bb-574648d9c32b`.
- O log real do smoke (2026-06-19 00:09) confirma: load_state 200, route→agent_turn, prompt@v1 carregado,
  DLP ok, LLM 200 (108 tokens) → mas `agent_turn_done tool_calls=0` + `send_response_none_delegated` +
  `ai/decisions 400` + `PUT state 400`.
- Não duplicar regra de negócio (taxas etc.) — o cálculo é do backend (ver
  [[feedback_simulacao_usa_engine_existente]]). Aqui é só fluxo/contrato.
