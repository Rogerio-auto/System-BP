---
id: F16-S42
title: Estado leve do agente (campos coletados) + popular customer_name do lead
phase: F16
task_ref: docs/planejamento-fluxo-conversacional-pre-atendimento.md
status: in-progress
priority: high
estimated_size: S
agent_id: null
claimed_at: 2026-06-18T16:31:47Z
completed_at: null
pr_url: null
depends_on: []
blocks: [F16-S40]
labels: []
source_docs:
  - docs/06-langgraph-agentes.md
  - docs/planejamento-fluxo-conversacional-pre-atendimento.md
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F16-S42 — Estado leve do agente (B4)

## Objetivo

Estender `ConversationState` com os campos de **memória do que foi coletado** (não roteamento), dados
como contexto ao nó agêntico (F16-S40), e garantir que `customer_name` seja populado a partir do lead.

Bloco B do `docs/planejamento-fluxo-conversacional-pre-atendimento.md` §4 + §11 (B4).

## Contexto

`ConversationState` (`state.py`) hoje carrega os campos do funil determinístico. O agente novo precisa
de "estado leve": o que já se sabe do lead, para o LLM decidir a próxima pergunta sem repetir. Campos
do §4 do plano que ainda faltam: `activity`, `profile`, `credit_objective`, `scr_authorized`,
`collection_status`, `handoff_active`. Os demais (`customer_name`, `city_id/name`, `requested_amount`,
`requested_term_months`, `last_simulation_id`) já existem.

**Regra LGPD:** `cpf_collected` é só um flag — **nunca** o CPF no estado.

## Escopo (faz)

- Adicionar a `ConversationState` (`state.py`) os campos faltantes do §4, com tipos precisos:
  - `activity: str | None` (produtor/autônomo/MEI/assalariado/comerciante…)
  - `profile: Literal["MICROEMPREENDEDOR", "ASSALARIADO"] | None`
  - `credit_objective: str | None`
  - `scr_authorized: bool | None`
  - `collection_status: Literal["none", "overdue", "negotiation", "legal"] | None`
  - `handoff_active: bool`
  - `cpf_collected: bool` (flag — confirmar que não existe ainda; nunca o CPF)
- Garantir que esses campos são **preservados** no merge do `load_state.py` (override) e extraídos em
  `receive_message.py` quando vierem no payload — senão somem (pegadinha conhecida F16-S36/S37).
- Popular `customer_name` a partir do lead em `identify_or_create_lead.py` (já carrega o lead).
- Atualizar `serialize_state` / `deserialize_state` se necessário (os campos entram em `_KNOWN_KEYS`
  automaticamente por estarem nas annotations — confirmar).

## Fora de escopo (NÃO faz)

- Nó `agent_turn` que consome o estado (F16-S40).
- Schema do backend (`apps/api/**`); estes campos vivem no snapshot jsonb, não em colunas novas.
- Tools de negócio (Bloco C).

## Arquivos permitidos

- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/state.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/load_state.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/receive_message.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/identify_or_create_lead.py`
- `apps/langgraph-service/tests/**`

## Arquivos proibidos

- `apps/api/**`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/graph.py`

## Definition of Done

- [ ] Campos do §4 presentes em `ConversationState` com tipos corretos (sem `Any` solto)
- [ ] Campos novos preservados no override do `load_state` e extraídos em `receive_message` (teste cobre)
- [ ] `customer_name` populado do lead em `identify_or_create_lead`
- [ ] CPF **nunca** no estado — só `cpf_collected: bool` (verificado)
- [ ] `pytest` + `ruff check app` + `mypy app` verdes
- [ ] PR aberto com link para o slot

## Comandos de validação

```powershell
cd apps/langgraph-service
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check app
.\.venv\Scripts\python.exe -m mypy app
```

## Notas para o agente

- Pegadinha (memória do projeto): todo campo novo do `ConversationState` que deve fluir entre nós
  precisa ser **extraído em `receive_message`** E **preservado no override do `load_state`** — senão
  morre num dos dois merges. Nós intermediários usam merge incremental e preservam sozinhos.
