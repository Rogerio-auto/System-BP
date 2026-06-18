---
id: F16-S38
title: Sweep org_id — todas as escritas /internal do LangGraph (cities, handoffs, persist, decisions)
phase: F16
task_ref: docs/planejamento-fluxo-conversacional-pre-atendimento.md
status: review
priority: critical
estimated_size: S
agent_id: null
claimed_at: 2026-06-18T14:58:00Z
completed_at: 2026-06-18T15:20:44Z
pr_url: null
depends_on: []
blocks: []
labels: []
source_docs:
  - docs/06-langgraph-agentes.md
  - docs/planejamento-fluxo-conversacional-pre-atendimento.md
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F16-S38 — Sweep org_id nas escritas /internal restantes

## Objetivo

Fazer **todas** as chamadas `/internal` de escrita do grafo whatsapp_pre_attendance retornarem 2xx,
eliminando os 400 que ainda restam (`/cities/identify`, `/handoffs`, `PUT /state`, `/ai/decisions`).

## Contexto

A cadeia org_id foi fechada (F16-S34/S35/S36/S37) e `state["organization_id"]` agora chega aos nós.
`get-or-create` já retorna 200. Mas no log real (2026-06-18 13:43) ainda dão **400**:

- `POST /internal/cities/identify` — `city_tools` **não envia org_id** (schema exige, confirmado).
- `POST /internal/handoffs` — handoff tool não envia org_id (e talvez outros campos do schema §7.4 doc 06).
- `PUT /internal/conversations/:id/state` — S35 mexeu, mas ainda 400: **reverificar** (org_id e/ou outro campo).
- `POST /internal/ai/decisions` — idem: S35 mexeu, ainda 400 — **reverificar** o corpo do erro.

Bloco A do `docs/planejamento-fluxo-conversacional-pre-atendimento.md`. Pré-requisito da reconstrução
agêntica (Bloco B) — essas tools serão reusadas pelo nó `agent_turn`.

## Escopo (faz)

- **Diagnosticar o corpo exato de cada 400** (reproduzir via curl contra o backend rodando, como nos
  slots anteriores) e corrigir o que falta em cada tool/nó:
  - `tools/city_tools.py` → incluir `organization_id` no payload de `/cities/identify`.
  - tool de handoff (`request_handoff`) → incluir `organization_id` (+ campos exigidos pelo schema
    `/internal/handoffs`: `lead_id`, `conversation_id`, `reason`, `summary`, `simulation_id?`).
  - `nodes/persist_state.py` → confirmar/forçar `organization_id` no `PUT /state` (e qualquer campo
    faltante do schema).
  - `tools/audit_tools.py` → confirmar `organizationId` (camelCase, é o que `/ai/decisions` espera) +
    demais campos obrigatórios (`conversationId`, `nodeName`, etc.).
- Garantir que `organization_id` vem de `state["organization_id"]` (fonte autoritativa já presente).
- Teste por write-tool: cada chamada monta o payload com org_id (e campos obrigatórios) corretamente.

## Fora de escopo (NÃO faz)

- Reescrita agêntica do grafo (Bloco B) — outro slot.
- Backend Node (`apps/api/**`) — os schemas já estão corretos; o gap é no produtor (LangGraph).
- Regras de negócio da simulação / RAG / SCR (Bloco C).

## Arquivos permitidos (`files_allowed`)

- `apps/langgraph-service/app/tools/city_tools.py`
- `apps/langgraph-service/app/tools/audit_tools.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/persist_state.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/request_handoff.py`
- `apps/langgraph-service/tests/**`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/**`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/load_state.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/receive_message.py`

## Contratos

- Cada endpoint `/internal/*` de escrita exige `organization_id`/`organizationId` (uuid) + seus campos.
  Casing por endpoint: leads/cities/state = snake_case; ai/decisions = camelCase (confirmado).

## Definition of Done

- [ ] `/cities/identify`, `/handoffs`, `PUT /state`, `/ai/decisions` retornam 2xx (validado contra backend real)
- [ ] Nenhum 400 por campo faltante nas escritas do grafo
- [ ] org_id sempre de `state["organization_id"]`
- [ ] Testes cobrindo o payload de cada write-tool
- [ ] `python -m pytest` + `ruff check app` verdes
- [ ] PR aberto com link para o slot

## Comandos de validação

```powershell
cd apps/langgraph-service
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check app
```

## Notas para o agente

- `org_id` NÃO é PII — pode logar.
- Reproduza cada 400 com curl (token em `.env` `LANGGRAPH_INTERNAL_TOKEN`, org real no banco) para ver
  o campo exato faltando — não assuma; alguns podem faltar mais que org_id.
- O caminho legado `chatwoot/notes` do `request_handoff` é separado (chatwoot) — se aparecer, registrar
  como achado para o Bloco E/limpeza, sem expandir escopo aqui.
