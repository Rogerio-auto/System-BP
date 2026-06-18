---
id: F16-S43
title: Aposentar o funil determinístico antigo atrás da flag agêntica
phase: F16
task_ref: docs/planejamento-fluxo-conversacional-pre-atendimento.md
status: available
priority: medium
estimated_size: M
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F16-S40, F16-S41]
blocks: []
labels: []
source_docs:
  - docs/06-langgraph-agentes.md
  - docs/planejamento-fluxo-conversacional-pre-atendimento.md
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F16-S43 — Aposentar o funil determinístico (B5)

## Objetivo

Depois que o caminho agêntico (F16-S40/S41) estiver validado e a flag ligada como default, remover os
nós do funil determinístico antigo e simplificar `graph.py`, eliminando código morto.

Bloco B do `docs/planejamento-fluxo-conversacional-pre-atendimento.md` §11 (B5).

## Contexto

- O funil antigo (`classify_intent`, `identify_or_create_lead`, `collect_missing_profile_data`,
  `identify_city`, `qualify_credit_interest`, `generate_simulation`, `save_simulation`,
  `decide_next_step` + as rotas correspondentes) foi mantido sob flag por F16-S40.
- Este slot só deve ser feito **após** confirmar que o caminho agêntico passou nos testes
  conversacionais (Bloco D) e foi promovido a default. É a limpeza final.

## Escopo (faz)

- Tornar o pipeline agêntico o **default** (flag on por padrão ou remover a flag, decisão registrada
  no PR conforme estado de validação).
- Remover os nós do funil e suas rotas que não são mais usados pelo caminho agêntico, mantendo os nós
  reaproveitados (`load_state`, `receive_message`, `persist_state`, `log_decision`, `send_response`,
  `request_handoff`, `agent_turn`, `route_conversation`).
- Limpar imports e `graph_version` (bump major — mudança estrutural de nós/edges).
- Remover/atualizar testes que exercitavam exclusivamente o funil antigo.

## Fora de escopo (NÃO faz)

- Tools de negócio (Bloco C) e judicial (Bloco E).
- Backend Node (`apps/api/**`).
- Qualquer mudança de comportamento do agente (só remoção do caminho morto).

## Arquivos permitidos

- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/graph.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/routes.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/__init__.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/classify_intent.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/collect_missing_profile_data.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/identify_city.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/qualify_credit_interest.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/generate_simulation.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/save_simulation.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/decide_next_step.py`
- `apps/langgraph-service/app/settings.py`
- `apps/langgraph-service/tests/**`

## Arquivos proibidos

- `apps/api/**`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/agent_turn.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/identify_or_create_lead.py`

## Definition of Done

- [ ] Pipeline agêntico é o caminho default (flag on/removida — decisão registrada no PR)
- [ ] Nós e rotas do funil antigo removidos; sem imports órfãos; `graph_version` bumpado
- [ ] Testes do funil antigo removidos/migrados; suíte verde
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

- `identify_or_create_lead` é **reaproveitado** (popula `customer_name`, F16-S42) — não remover sem
  confirmar que o agente não depende dele como tool/nó.
- Slot de limpeza: zero `# TODO`, zero código morto remanescente. Se algo do funil ainda é útil ao
  agente, extrair como tool (Bloco C), não deixar nó solto.
