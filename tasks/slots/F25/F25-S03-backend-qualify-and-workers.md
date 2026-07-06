---
id: F25-S03
title: Backend — /internal qualify_lead + evento leads.qualified + workers por canonical_role
phase: F25
task_ref: docs/22-agente-interno-acoes.md
status: available
priority: high
estimated_size: L
agent_id: null
depends_on: [F25-S01, F25-S02]
blocks: [F25-S04, F25-S06]
labels: [backend, ai-agent, outbox, rbac, idempotency]
source_docs: [docs/22-agente-interno-acoes.md, docs/06-langgraph-agentes.md, docs/04-eventos.md]
docs_required: false
---

# F25-S03 — Backend: qualify_lead (/internal) + worker de qualificação + refactor canonical_role

## Objetivo

Implementar, no backend Node, a Frente A do doc 22 §6.1: a ação de negócio "qualificar lead"
consumível pela IA, e refatorar os workers de Kanban para resolver stage por `canonical_role`
(remover o `orderIndex` mágico).

## Contexto

Doc 22 §6: a IA propõe fato → backend valida e emite evento → worker determinístico reage. A tool
`qualify_lead` (F25-S04, Python) chama este endpoint. O ator é a IA (`actor_type='ai'`, §8.A).

## Escopo (faz)

- Endpoint `POST /internal/leads/:id/qualify` (auth `X-Internal-Token`, Zod request/response):
  transição `leads.status: new → qualifying` (idempotente — no-op se já qualifying+), append em
  `lead_history` (actor `ai`), `emit('leads.qualified')` na mesma transação, `auditLog` com
  `actor_type='ai'`. Idempotency key `leads.qualified:<lead_id>`. Respeita `organization_id`.
- Novo worker `apps/api/src/workers/kanban-on-qualification.ts`: consome `leads.qualified` e reflete
  no card (badge/priority no stage `pre_atendimento`) **sem pular etapa** — não move para `simulacao`.
  actor `null`/system no histórico, idempotente.
- Refactor `kanban-on-simulation.ts` e `kanban-on-analysis.ts` para resolver stages por
  `canonical_role` (F25-S01) em vez de `orderIndex`/nome; manter comportamento idêntico + fallback
  logado se a org não tiver o `canonical_role` esperado.
- Registrar o worker em `apps/api/src/workers/index.ts`.

## Fora de escopo (NÃO faz)

- Tool Python / prompt (F25-S04).
- Worker proativo de estagnação/abandono (F25-S05).
- Endpoints de reversão / painel (F25-S06).

## Arquivos permitidos

- `apps/api/src/modules/internal/leads/routes.ts`
- `apps/api/src/modules/internal/leads/schemas.ts`
- `apps/api/src/modules/leads/service.ts`
- `apps/api/src/workers/kanban-on-qualification.ts`
- `apps/api/src/workers/kanban-on-simulation.ts`
- `apps/api/src/workers/kanban-on-analysis.ts`
- `apps/api/src/workers/index.ts`
- `apps/api/src/workers/__tests__/kanban-on-qualification.test.ts`

## Arquivos proibidos

- `apps/web/**`
- `apps/langgraph-service/**`
- `apps/api/src/db/schema/**`
- `apps/api/src/db/migrations/**`

## Definition of Done

- [ ] `POST /internal/leads/:id/qualify` idempotente, Zod nas bordas, escopo org
- [ ] Evento `leads.qualified` emitido em transação; audit com `actor_type='ai'`
- [ ] Worker `kanban-on-qualification` reflete no card sem pular etapa; idempotente + testado
- [ ] Workers de simulação/análise resolvem stage por `canonical_role` (sem regressão)
- [ ] `pnpm --filter @elemento/api typecheck` + `lint` + `test` verdes

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
python scripts/slot.py validate F25-S03
```

## Notas para o agente

- Espelhar `kanban-on-simulation.ts` (transação + histórico + emit + audit) como referência de estilo.
- Idempotência de `emit`: usar `onConflictDoNothing` p/ chave determinística (ver histórico de bug do outbox).
- Nunca repassar PII em payload de evento. `qualify` não recebe nem loga CPF.
