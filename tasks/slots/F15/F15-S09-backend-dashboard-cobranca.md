---
id: F15-S09
title: Backend — métricas do dashboard de cobrança
phase: F15
task_ref: null
status: in-progress
priority: medium
estimated_size: S
agent_id: null
claimed_at: 2026-06-15T20:10:00Z
completed_at: null
pr_url: null
depends_on: [F15-S01, F15-S02, F15-S04]
blocks: [F15-S11]
labels: [dashboard, cobranca, backend]
source_docs:
  - docs/planejamento-2026-06-evolucao.md#f2-role-de-cobrança-dashboard-status-spc-item-9
---

# F15-S09 — Backend métricas de cobrança

## Objetivo

Expor os agregados que o dashboard do role `cobranca` precisa, derivados de `payment_dues` + `collection_jobs` + `customers.spc_status`.

## Contexto

Item 9 / Épico F.2c. Visão centralizada (role global): vencendo (D-3..D0), vencidos não cobrados, cobrados (jobs enviados), inadimplentes 15+ dias, no SPC, além da régua de cobrança do cliente.

## Escopo (faz)

- Endpoint `GET /api/dashboard/collection` no módulo `dashboard` existente (já registrado em `app.ts`), retornando o `CollectionDashboardResponse` de F15-S04.
- Repository com as queries de agregação (índices já existentes em `payment_dues`/`collection_jobs`).
- RBAC `billing:read`; role `cobranca` é global (sem city-scope obrigatório, mas suportar filtro por cidade opcional).

## Fora de escopo (NÃO faz)

- UI (F15-S11).
- Mudança de status SPC (F15-S07).

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/modules/dashboard/service.ts`
- `apps/api/src/modules/dashboard/repository.ts`
- `apps/api/src/modules/dashboard/routes.ts`
- `apps/api/src/modules/dashboard/controller.ts`
- `apps/api/src/modules/dashboard/schemas.ts`
- `apps/api/src/modules/dashboard/__tests__/**`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/app.ts` (dashboard já registrado)
- `apps/api/src/db/schema/**`

## Contratos de entrada

- `customers.spc_status` (F15-S02), `CollectionDashboardResponse` (F15-S04), permissões (F15-S01).

## Contratos de saída

- `GET /api/dashboard/collection` consumível pela UI (F15-S11).

## Definition of Done

- [ ] Cards calculados corretamente (teste com seed de parcelas em estados variados)
- [ ] RBAC testado; performance OK (sem N+1; usa índices existentes)
- [ ] `pnpm --filter @elemento/api typecheck && lint && test` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- dashboard
```

## Notas para o agente

- Reaproveite os helpers de agregação já usados em `dashboard/repository.ts` (ex.: `countKanbanCardsByStage`) como referência de estilo.
