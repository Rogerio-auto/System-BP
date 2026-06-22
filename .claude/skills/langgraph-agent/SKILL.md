---
name: langgraph-agent
description: Criar ou estender um agente LangGraph agêntico (LLM + tool-calling) no apps/langgraph-service do Elemento — adicionar tool, threading de estado, fiação no worker Node, prompt, DLP, /internal e testes. Use quando o slot envolver o pré-atendimento agêntico (Ana Clara), uma nova tool, ou um novo grafo/agente. Carrega as pegadinhas reais que já travaram produção.
---

# /langgraph-agent — Criar/estender agente LangGraph (Elemento)

Guia operacional para construir um agente agêntico (LLM raciocina + chama tools em
loop) dentro de `apps/langgraph-service`. Complementa o agente `python-engineer` e o
`docs/06-langgraph-agentes.md` (consulte com `Grep -A`, não leia inteiro).

> **Arquitetura inegociável:** LangGraph é **isolado**. Recebe HTTP do backend Node,
> chama o backend só via `InternalApiClient` (header `X-Internal-Token`), chama LLM só
> via `app/llm/gateway.py` (OpenRouter). **Nunca** toca Postgres/WhatsApp/Chatwoot direto.
> Postgres é fonte de verdade — toda escrita passa por `/internal/*`.

## Mapa mental do fluxo agêntico

```
webhook Meta → worker livechat-ai (Node) ──POST /process/whatsapp/message──▶ FastAPI
   monta request + metadata                                                   │
                                                                              ▼
                            receive_message → load_state → route → agent_turn (loop ReAct)
                                                                              │
                              ┌───────────────────────────────────────────────┤
                              ▼ (a cada tool_call do LLM)                      ▼ (sem mais tools)
                   _dispatch_tool → tool → InternalApiClient → /internal/*    reply {"messages":[...]}
```

Arquivos-âncora (todos em `apps/langgraph-service/app`):

- `graphs/whatsapp_pre_attendance/nodes/agent_turn.py` — loop ReAct, `_build_tool_schemas`, `_dispatch_tool`.
- `graphs/whatsapp_pre_attendance/nodes/receive_message.py` — payload→`state` (threading).
- `graphs/whatsapp_pre_attendance/state.py` — `ConversationState` (TypedDict, `total=False`).
- `tools/*.py` — tools (wrappers finos sobre `/internal/*`). `tools/_base.py` = `InternalApiClient`.
- `prompts/<key>.md` — prompt seed; ativo vem do backend (`/internal/prompts/active/<key>`).
- `llm/gateway.py` + `llm/factory.py` — gateway OpenRouter, DLP, budget.

Worker Node: `apps/api/src/workers/livechat-ai.ts`. Schema do request: `apps/api/src/integrations/langgraph/schemas.ts`.

## Receita: adicionar uma TOOL nova

1. **Schema + impl da tool** em `tools/<dominio>_tools.py`: `@tool(args_schema=...)`, Pydantic
   in/out, chama `InternalApiClient`. Mapeie erros tipados (404/409/422) e trate timeout/5xx
   como erro de negócio (nunca derrube o turno por exceção crua).
2. **Endpoint `/internal`** correspondente no backend Node (se não existir): rota +
   schema Zod + service + `X-Internal-Token` + RBAC/escopo + outbox + audit. Veja
   `apps/api/src/modules/internal/leads/` como referência.
3. **Declare o schema** em `_build_tool_schemas()` no `agent_turn.py` (formato OpenAI
   tool-calling). Só exponha args que o LLM **legitimamente** decide. Args de
   contexto/PII (org_id, phone, conversation_id) **não** vão como decisão do LLM.
4. **Roteie** no `_dispatch_tool()`: injete os args autoritativos do `state` (veja §DLP),
   instancie o input Pydantic, `await tool.ainvoke(...)`, retorne JSON.
5. **Propague o estado** em `_extract_state_updates()` se o resultado muda o `state`
   (ex.: `lead_id`, `city_id`).
6. **Prompt:** referencie a capacidade no `prompts/<key>.md` (em linguagem de negócio).
   Edições reais de produção são via UI de prompts (F9), não no .md.
7. **Teste** com mock do gateway e `respx` para o `/internal` (ver §Testes).

## As 7 pegadinhas que JÁ travaram produção (não repita)

1. **DLP esconde PII do LLM → injete do `state`.** O gateway redige telefone/CPF antes
   do LLM. O modelo nunca vê o telefone real → **alucina** (`+5569999999999`). Toda arg
   PII é sobrescrita no `_dispatch_tool` a partir do estado, igual ao `organization_id`:
   ```python
   if tool_name == "get_or_create_lead":
       tool_args = {**tool_args, "phone": state.get("phone", "")}  # autoritativo
   ```
2. **Opcional vazio (`""`) → 400.** Schemas Zod usam `min(1)`. Nas tools, derrube
   string vazia antes do POST: `if name:` (não `if name is not None`). Senão o
   `/internal` responde 400 e a tool mascara como `BACKEND_UNAVAILABLE`.
3. **400 no `/internal` trava o turno todo** → `lead_id` fica `null` → não avança →
   IA **re-saúda / "parece sem memória"**. Reproduza o POST com `curl` antes de culpar o LLM:
   ```bash
   TOKEN=$(grep -E '^LANGGRAPH_INTERNAL_TOKEN=' .env | sed 's/.*=//' | tr -d '"\r')
   curl -s -X POST http://localhost:3333/internal/leads/get-or-create \
     -H "X-Internal-Token: $TOKEN" -H "Content-Type: application/json" \
     -d '{"phone":"+55699...","source":"whatsapp","organization_id":"<uuid>"}'
   ```
4. **`organization_id` obrigatório no `state`** (F16-S35). Sem ele todo `/internal` dá
   400 e o `agent_turn` cai em handoff (`MISSING_ORG_ID`). Threading:
   worker → request → `metadata`/campo → `receive_message` → `state` → `_dispatch_tool`.
   `load_state` DESCARTA campos fora do seu override — cuidado. Cf. `[[feedback_langgraph_orgid_threading]]`.
5. **Cadeia de timeout.** `LANGGRAPH_AI_TIMEOUT_MS` (worker, `apps/api/src/config/env.ts`)
   **>** `GRAPH_TIMEOUT_SEC` (`app/config.py`) **+ overhead**. Turno real ~8-12s. Invertido →
   Node aborta no meio → fallback de handoff indevido ("um atendente vai te responder").
6. **Threading worker→state explícito.** Dado que o agente precisa (ex.: `customer_name`
   = push name do WhatsApp, vindo de `conversations.contact_name`) entra via `metadata`
   do request do worker → `receive_message.py` mapeia `metadata.X` → `state["X"]`. Worker
   mandando `null` = dado perdido. Nome inicial do lead = push name; a IA sobrescreve com
   o nome real via `update_lead_profile` depois.
7. **`--reload` pode rodar `.pyc` velho.** Ao validar um fix de comportamento, limpe o
   cache e dê restart **hard**:
   ```powershell
   Get-ChildItem -Recurse -Directory __pycache__ | Remove-Item -Recurse -Force
   .\dev.ps1 -Force
   ```
   Confirme o que o runtime carrega com `inspect.getsource(modulo)`.

## Rodar localmente + troubleshooting

```powershell
cd apps/langgraph-service
.\dev.ps1 -Force        # carrega .env do ROOT, libera a 8000 (netstat, não Get-NetTCPConnection), sobe uvicorn
```

- O `.env` é o do **root** do monorepo (o serviço não tem `.env` próprio). Vars
  obrigatórias: `BACKEND_INTERNAL_URL`, `LANGGRAPH_INTERNAL_TOKEN`, `OPENROUTER_API_KEY`.
- Venv deve ser **Python 3.12** (`pyproject` exige `>=3.12`; CI/Docker usam 3.12).
- Backend Node tem de estar de pé na 3333 (`/internal` + `/internal/prompts/active/...`).
- `dev.ps1` usa `netstat` p/ checar a porta — `Get-NetTCPConnection` **pendura** em
  algumas máquinas Windows (não reintroduza).
- Sintomas → causa: turno re-saúda → tool 400 (curl); fallback "atendente" → LangGraph
  fora do ar OU timeout invertido; fix não vale → `.pyc` stale.

## Testes (obrigatório antes de fechar slot)

```powershell
cd apps/langgraph-service
uv run ruff check .
uv run mypy app          # --strict
uv run pytest
```

- Toda tool: teste com **mock do gateway** + `respx` para o `/internal`. Cubra o caminho
  de erro (400/timeout) — é onde mora o bug.
- Cenários conversacionais ficam em `tests/fixtures/conversations/*.yaml` + `tests/graphs/`.
- Prompt-injection: `tests/test_prompt_injection.py` (não regrida).

## Checklist de DoD (agente/tool)

- [ ] Tool não recebe PII como decisão do LLM (injeta do `state`).
- [ ] Strings opcionais vazias derrubadas antes do `/internal`.
- [ ] `organization_id` (e ids de contexto) garantidos no `state`.
- [ ] Erros do `/internal` viram resultado de negócio, não exceção crua → sem derrubar o turno.
- [ ] `customer_name`/campos novos threaded worker→request→state.
- [ ] Timeout do worker > timeout do grafo + overhead.
- [ ] ruff + mypy --strict + pytest verdes; teste cobre o caminho de erro.
- [ ] Prompt em `prompts/<key>.md`, nunca inline.
- [ ] LGPD: sem PII bruta em log (só sufixo/contadores) nem no outbox (doc 17).

```

```
