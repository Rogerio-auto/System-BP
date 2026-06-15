---
id: F17-S01
title: Schema — entidade `contracts` + migração `contract_reference` → `contract_id`
phase: F17
task_ref: null
status: review
priority: high
estimated_size: M
agent_id: null
claimed_at: 2026-06-15T19:30:22Z
completed_at: 2026-06-15T19:35:50Z
pr_url: null
depends_on: []
blocks: [F17-S02, F17-S03, F17-S04, F17-S07, F17-S09]
labels: [contracts, schema, lgpd]
source_docs:
  - docs/planejamento-2026-06-evolucao.md#épico-e--contratos-boletos-e-renovação-item-5--épico
  - docs/17-lgpd-protecao-dados.md
---

# F17-S01 — Schema `contracts`

## Objetivo

Criar a entidade de contrato (hoje inexistente — só `payment_dues.contract_reference` string) e ligar as parcelas a ela via FK, com backfill dos dados existentes.

## Contexto

Item 5 / Épico E.1. Decisão D7: **1:N** (cliente pode ter vários contratos ao longo do tempo — habilita win-back). `payment_dues` já tem suporte a boleto (F5-S10).

## Escopo (faz)

- Migration + `apps/api/src/db/schema/contracts.ts`: `id`, `organization_id`, `customer_id` (FK), `contract_reference` (único por org), `product_id`/`rule_version_id` (origem), `principal_amount` (numeric 14,2), `term_months`, `monthly_rate_snapshot`, `status` (`draft`→`signed`→`active`→`settled`/`defaulted`/`cancelled`), `signed_at`, `first_due_date`, `last_due_date`, timestamps. Índices por `customer_id`/`status`.
- Adicionar `payment_dues.contract_id` (FK nullable) + **backfill** a partir de `contract_reference` agrupado por org.
- Exportar em `apps/api/src/db/schema/index.ts`.

## Fora de escopo (NÃO faz)

- CRUD/assinatura (F17-S03); saúde de boletos (F17-S04).
- Remover `contract_reference` (manter por compat; migração de leitura vem depois).

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/db/migrations/00XX_contracts.sql`
- `apps/api/src/db/migrations/meta/_journal.json`
- `apps/api/src/db/schema/contracts.ts`
- `apps/api/src/db/schema/paymentDues.ts`
- `apps/api/src/db/schema/index.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/db/schema/customers.ts`
- `apps/api/src/modules/**`

## Contratos de saída

- Tabela `contracts` + `payment_dues.contract_id` com backfill consistente.

## Definition of Done

- [ ] Tabela + FK + índices; multi-tenant; numeric(14,2) nos valores
- [ ] Backfill cria 1 contrato por `contract_reference` distinto e religa as parcelas
- [ ] Migration idempotente, aplica limpo em DB existente; `check-migrations` OK
- [ ] `pnpm --filter @elemento/api typecheck` verde

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
python scripts/slot.py check-migrations
```

## Notas para o agente

- Use o primeiro número de migration livre (`check-migrations`) — várias fases criam migrations em paralelo (F14-S04, F15-S0x).
- LGPD: contrato/boletos = PII financeira, retenção 5 anos (já documentada em `payment_dues`); sem novo segredo aqui.
