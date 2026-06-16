---
id: F17-S02
title: Contratos compartilhados — Zod de contrato + saúde de boletos
phase: F17
task_ref: null
status: done
priority: high
estimated_size: S
agent_id: null
claimed_at: 2026-06-15T19:55:59Z
completed_at: 2026-06-15T20:00:35Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/235
depends_on: [F17-S01]
blocks: [F17-S03, F17-S04, F17-S05, F17-S06, F17-S07, F17-S08]
labels: [shared-schemas, contracts]
source_docs:
  - docs/planejamento-2026-06-evolucao.md#épico-e--contratos-boletos-e-renovação-item-5--épico
---

# F17-S02 — Contratos Zod de contrato

## Objetivo

Definir os contratos compartilhados front×API de contrato, assinatura, saúde de boletos e visão cliente (fonte única — evita drift).

## Escopo (faz)

- `packages/shared-schemas/src/contracts.ts`: `ContractSchema`, `ContractCreateSchema`, `ContractSignSchema`, enum de `status`, `BoletoHealthSchema` (em dia/a vencer/vencido/inadimplente, % pago), `CustomerOverviewResponse` (dados + histórico + contratos + boletos).
- Re-exportar em `packages/shared-schemas/src/index.ts`.

## Fora de escopo (NÃO faz)

- Implementação de rotas/UI.

## Arquivos permitidos (`files_allowed`)

- `packages/shared-schemas/src/contracts.ts`
- `packages/shared-schemas/src/index.ts`

## Arquivos proibidos (`files_forbidden`)

- `packages/shared-schemas/src/tasks.ts`
- `packages/shared-schemas/src/notifications.ts`
- `packages/shared-schemas/src/billing.ts`

## Definition of Done

- [ ] Schemas cobrem os campos de `contracts` (F17-S01) + saúde derivada
- [ ] `index.ts` sem colisão de nomes; `pnpm --filter @elemento/shared-schemas build` verde

## Comandos de validação

```powershell
pnpm --filter @elemento/shared-schemas build
pnpm --filter @elemento/shared-schemas typecheck
```

## Notas para o agente

- Memória `feedback_shared_types_runtime_build`: buildar `dist`, não só typecheck. Casing idêntico ao retornado pela API.
