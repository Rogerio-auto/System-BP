---
id: F15-S04
title: Contratos compartilhados — tarefas, notificações, SPC, dashboard cobrança
phase: F15
task_ref: null
status: in-progress
priority: high
estimated_size: S
agent_id: null
claimed_at: 2026-06-15T19:44:25Z
completed_at: null
pr_url: null
depends_on: [F15-S03]
blocks: [F15-S05, F15-S06, F15-S07, F15-S09, F15-S10, F15-S11]
labels: [shared-schemas, contracts, cobranca]
source_docs:
  - docs/planejamento-2026-06-evolucao.md#f2-role-de-cobrança-dashboard-status-spc-item-9
  - docs/02-arquitetura-sistema.md
---

# F15-S04 — Contratos Zod compartilhados da fundação de cobrança

## Objetivo

Definir, uma única vez, os contratos Zod (request/response) de tarefas, notificações, SPC e dashboard de cobrança — fonte de verdade compartilhada front×API (evita o drift de contrato conhecido).

## Contexto

Memória `feedback_parallel_contract_drift`: o front deve ler o schema Zod **real** da API. Centralizar os contratos aqui permite backend e frontend evoluírem sem divergência de casing/envelope.

## Escopo (faz)

- `packages/shared-schemas/src/tasks.ts`: `TaskSchema`, `TaskCreateSchema`, `TaskListQuerySchema`, `TaskClaimSchema`, enums de `type`/`status`.
- `packages/shared-schemas/src/notifications.ts`: `NotificationSchema`, `NotificationListResponse`, `NotificationPreferenceSchema`, enum de `channel`.
- `packages/shared-schemas/src/billing.ts`: `SpcStatusSchema` (enum + transição), `SpcUpdateSchema`, `CollectionDashboardResponse` (cards: vencendo, vencidos não cobrados, cobrados, inadimplentes 15+, no SPC).
- Re-exportar tudo em `packages/shared-schemas/src/index.ts`.

## Fora de escopo (NÃO faz)

- Implementação de rotas/services (F15-S05..S09).
- Componentes de UI (F15-S10/S11).

## Arquivos permitidos (`files_allowed`)

- `packages/shared-schemas/src/tasks.ts`
- `packages/shared-schemas/src/notifications.ts`
- `packages/shared-schemas/src/billing.ts`
- `packages/shared-schemas/src/index.ts`

## Arquivos proibidos (`files_forbidden`)

- `packages/shared-schemas/src/auth.ts`
- `packages/shared-schemas/src/leads.ts`
- `packages/shared-schemas/src/cities.ts`

## Contratos de saída

- Schemas Zod importáveis por `@elemento/shared-schemas` no backend e no frontend.

## Definition of Done

- [ ] Schemas cobrem os campos das tabelas de F15-S03 + SPC de F15-S02
- [ ] Sem PII bruta nos response schemas de notificação (só referência por id)
- [ ] `index.ts` re-exporta sem colisão de nomes
- [ ] `pnpm --filter @elemento/shared-schemas build` verde; `pnpm typecheck` verde

## Comandos de validação

```powershell
pnpm --filter @elemento/shared-schemas build
pnpm --filter @elemento/shared-schemas typecheck
```

## Notas para o agente

- Memória `feedback_shared_types_runtime_build`: pacote precisa de `dist` buildado e ordem correta no Dockerfile — rode o build, não só typecheck.
- Mantenha o casing dos campos idêntico ao retornado pela API (snake vs camel) — alinhe com o padrão dos outros módulos (`leads.ts`).
