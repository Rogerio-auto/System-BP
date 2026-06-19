---
id: F16-S47
title: Fix entrega do reply agêntico (reply channel + messages no response + persist/audit)
phase: F16
task_ref: docs/planejamento-fluxo-conversacional-pre-atendimento.md
status: in-progress
priority: critical
estimated_size: M
agent_id: null
claimed_at: 2026-06-19T13:23:46Z
completed_at: null
pr_url: null
depends_on: []
blocks: []
labels: [lgpd-impact]
source_docs:
  - docs/06-langgraph-agentes.md
  - docs/planejamento-fluxo-conversacional-pre-atendimento.md
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F16-S47 — Fix entrega do reply agêntico (2º smoke real)

## Objetivo

O 2º smoke (flag ON) mostrou: `agent_turn` parseia o `{"messages":[...]}` corretamente
(`parsed_messages_count=4`), mas o cliente NÃO recebe nada e há 400 em `/internal`. Corrigir a cadeia
de entrega completa.

## Bugs (diagnóstico do smoke 2026-06-19 13:14)

1. **CRÍTICO — `state["reply"]` é descartado.** `agent_turn` retorna `res["reply"]`, mas `reply` NÃO é
   campo declarado em `ConversationState` (TypedDict) → o LangGraph não propaga o channel →
   `send_response` lê `state.get("reply")` vazio → `none_delegated` → `_extract_reply` (process.py)
   retorna `type=none`. Fix: declarar `reply` (e o que mais precisar) como campo do `ConversationState`.
2. **CRÍTICO — `messages[]` não chega ao response.** `send_response` põe `output_messages` em
   `tool_results`, e `WhatsAppMessageResponse` tem o campo `messages` (F16-S41), mas `process.py`
   (`process_whatsapp_message`, ~449) monta o response SEM `messages=`. Fix: extrair `messages` do
   `tool_results[node=send_response]` e popular `WhatsAppMessageResponse.messages`.
3. **`POST /internal/ai/decisions` → 400 `correlationId obrigatório`.** `audit_tools` já manda
   `correlationId=inp.correlation_id`; logo `inp.correlation_id` chega vazio na chamada do `agent_turn`
   (FIX-2) e/ou `log_decision`. Garantir correlation_id UUID válido em ambas as chamadas.
4. **`PUT /internal/conversations/:id/state` → erro.** Validação 400 no smoke; e há uma unique
   constraint `uq_ai_conversation_states_org_phone_active` (org+phone+active) cujo upsert tem
   ON CONFLICT só em `conversation_id` → 500 duplicate key em telefone recorrente. Diagnosticar o corpo
   exato e corrigir (produtor langgraph e/ou o upsert no backend para tratar o conflito org+phone).

## Escopo (faz)

- `ConversationState`: declarar `reply` como channel (bug 1).
- `process.py`: extrair e popular `messages` no response (bug 2).
- Corrigir correlation_id nas chamadas de auditoria (bug 3).
- Corrigir persist (bug 4): diagnosticar o 400 e tratar o conflito org+phone+active (upsert idempotente
  por conversation_id quando o telefone já tem estado ativo — decidir no backend ou no produtor).
- Validar com harness/curl contra o stack local: agente responde com `messages[]` não-vazio; ai/decisions
  e PUT state 2xx.

## Arquivos permitidos

- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/state.py`
- `apps/langgraph-service/app/api/process.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/agent_turn.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/log_decision.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/persist_state.py`
- `apps/langgraph-service/app/tools/audit_tools.py`
- `apps/api/src/modules/internal/conversations/**`
- `apps/api/src/modules/internal/conversations/__tests__/**`
- `apps/langgraph-service/tests/**`

## Arquivos proibidos

- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/load_state.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/graph.py`

## Definition of Done

- [ ] Agente responde: `messages[]` não-vazio chega ao `WhatsAppMessageResponse`
- [ ] `reply` propaga de agent_turn → send_response (channel declarado)
- [ ] `POST /internal/ai/decisions` 2xx
- [ ] `PUT /internal/conversations/:id/state` 2xx (inclusive telefone recorrente)
- [ ] Testes (incl. através do grafo compilado, não só retorno de nó)
- [ ] `pytest` + `ruff` + `mypy` (langgraph) e `pnpm typecheck/lint/test` (api, se tocada) verdes
- [ ] PR aberto com link para o slot

## Comandos de validação

```powershell
cd apps/langgraph-service
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check app
```

## Notas

- A causa do bug 1/2 só aparece no grafo compilado (channel-drop) — testes de nó isolado não pegam.
