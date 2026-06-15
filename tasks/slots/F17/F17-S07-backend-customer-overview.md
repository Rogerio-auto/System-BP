---
id: F17-S07
title: Backend — visão cliente (dados + histórico + contratos + boletos)
phase: F17
task_ref: null
status: in-progress
priority: medium
estimated_size: M
agent_id: null
claimed_at: 2026-06-15T21:30:05Z
completed_at: null
pr_url: null
depends_on: [F17-S01, F17-S02, F17-S03]
blocks: [F17-S08]
labels: [contracts, crm, backend]
source_docs:
  - docs/planejamento-2026-06-evolucao.md#épico-e--contratos-boletos-e-renovação-item-5--épico
---

# F17-S07 — Backend visão cliente (drill-down)

## Objetivo

Expor a visão consolidada do cliente pós-conversão: dados, histórico, contratos e boletos — base do drill-down do CRM.

## Contexto

Item 5 / Épico E.4. Hoje o CRM é centrado em **lead**; falta a visão **cliente** conectando `customers ↔ contracts ↔ payment_dues` + `lead_history`/`interactions`.

## Escopo (faz)

- Módulo `apps/api/src/modules/customers/`: endpoint `GET /api/customers/:id/overview` retornando `CustomerOverviewResponse` (F17-S02).
- Repository agregando customer + contratos (F17-S01) + parcelas/boletos + histórico/interactions.
- RBAC `contracts:read` (+ leitura de lead); city-scope via `customer → lead → city_id`.
- Registrar rota em `apps/api/src/app.ts`.

## Fora de escopo (NÃO faz)

- UI (F17-S08); win-back (F17-S09).

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/modules/customers/**`
- `apps/api/src/app.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/modules/contracts/**`
- `apps/api/src/modules/internal/customers/**`
- `apps/api/src/db/schema/**`

## Definition of Done

- [ ] Overview agrega contratos + boletos + histórico sem N+1
- [ ] RBAC + city-scope testados (positivo/negativo); sem PII além do necessário
- [ ] `pnpm --filter @elemento/api typecheck && lint && test` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api test -- customers
```

## Notas para o agente

- `app.ts` é compartilhado — coordene ordem com outros slots de backend desta/outras fases.
- Não confundir com `modules/internal/customers` (rotas `/internal/*` do agente IA) — é outro módulo.
