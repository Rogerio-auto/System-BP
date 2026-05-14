---
id: F2-S01
title: Schema credit_products + product_rules + simulations + seed
phase: F2
task_ref: T2.1
status: done
priority: critical
estimated_size: M
agent_id: db-schema-engineer
claimed_at: 2026-05-14T18:00:00Z
completed_at: 2026-05-14T18:48:35Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/48
depends_on: [F0-S04, F1-S09, F1-S13, F1-S15]
blocks: [F2-S03, F2-S04]
labels: []
source_docs:
  - docs/03-modelo-dados.md
  - docs/05-modulos-funcionais.md
  - docs/11-roadmap-executavel.md
---

# F2-S01 — Schema credit_products + product_rules + simulations

## Objetivo

Tabelas que sustentam todo o módulo de crédito: produto comercial, regras numéricas
versionadas (imutáveis após publicação) e simulações persistidas com snapshot da regra
ativa. Sem isso, F2-S02..F2-S09 ficam todos bloqueados.

## Escopo

Migration `0016_credit_core.sql` + schemas Drizzle em `apps/api/src/db/schema/credit/`.

### `credit_products`

Conforme doc 03 §5.

- `id uuid PK default gen_random_uuid()`
- `organization_id uuid NOT NULL FK organizations ON DELETE RESTRICT`
- `key text NOT NULL` (slug curto — ex: `microcredito_basico`)
- `name text NOT NULL`
- `description text NULL`
- `is_active boolean NOT NULL DEFAULT true`
- `created_at timestamptz NOT NULL DEFAULT now()`
- `updated_at timestamptz NOT NULL DEFAULT now()`
- `deleted_at timestamptz NULL` (soft-delete)
- `UNIQUE (organization_id, key) WHERE deleted_at IS NULL`
- `INDEX idx_products_org_active ON (organization_id, is_active)`

### `credit_product_rules`

Conforme doc 03 §5.

- `id uuid PK`
- `product_id uuid NOT NULL FK credit_products ON DELETE CASCADE`
- `version int NOT NULL`
- `min_amount numeric(14,2) NOT NULL`
- `max_amount numeric(14,2) NOT NULL`
- `min_term_months int NOT NULL`
- `max_term_months int NOT NULL`
- `monthly_rate numeric(8,6) NOT NULL` — decimal (0.025 = 2.5%)
- `iof_rate numeric(8,6) NULL`
- `amortization text NOT NULL CHECK (amortization IN ('price','sac')) DEFAULT 'price'`
- `city_scope uuid[] NULL` — array de city_id; NULL = todas
- `effective_from timestamptz NOT NULL DEFAULT now()`
- `effective_to timestamptz NULL`
- `is_active boolean NOT NULL DEFAULT true`
- `created_at timestamptz NOT NULL DEFAULT now()`
- `created_by_user_id uuid NULL FK users ON DELETE SET NULL`
- `UNIQUE (product_id, version)`
- Constraint: `CHECK (min_amount > 0 AND max_amount >= min_amount AND min_term_months > 0 AND max_term_months >= min_term_months AND monthly_rate >= 0)`
- `INDEX idx_rules_product_active ON (product_id, is_active) WHERE is_active = true`
- `INDEX idx_rules_product_version ON (product_id, version DESC)`

> **Imutabilidade:** uma regra publicada nunca é alterada. Nova taxa = nova `version` +
> antiga marcada `is_active=false` com `effective_to=now()`. Reforço em F2-S03.

### `credit_simulations`

Conforme doc 03 §5.

- `id uuid PK`
- `organization_id uuid NOT NULL FK ON DELETE RESTRICT`
- `lead_id uuid NOT NULL FK leads ON DELETE RESTRICT`
- `customer_id uuid NULL FK customers ON DELETE SET NULL`
- `product_id uuid NOT NULL FK credit_products ON DELETE RESTRICT`
- `rule_version_id uuid NOT NULL FK credit_product_rules ON DELETE RESTRICT` — imutável após criação
- `amount_requested numeric(14,2) NOT NULL`
- `term_months int NOT NULL`
- `monthly_payment numeric(14,2) NOT NULL`
- `total_amount numeric(14,2) NOT NULL`
- `total_interest numeric(14,2) NOT NULL`
- `rate_monthly_snapshot numeric(8,6) NOT NULL`
- `amortization_table jsonb NOT NULL` — array de parcelas `[{n, principal, interest, balance, due_date?}]`
- `origin text NOT NULL CHECK (origin IN ('ai','manual','import'))`
- `created_by_user_id uuid NULL FK users ON DELETE SET NULL`
- `created_by_ai_log_id uuid NULL` — FK virtual; tabela `ai_decision_logs` vem na F3
- `idempotency_key text NULL` — usado pelo endpoint `/internal/simulations`
- `created_at timestamptz NOT NULL DEFAULT now()`
- `INDEX idx_simulations_lead_created ON (lead_id, created_at DESC)`
- `INDEX idx_simulations_org_created ON (organization_id, created_at DESC)`
- `UNIQUE (origin, idempotency_key) WHERE idempotency_key IS NOT NULL` (idempotência para IA)

### Backfill em tabelas existentes

- `kanban_cards.last_simulation_id uuid NULL FK credit_simulations ON DELETE SET NULL` — adicionar se ainda não existir (consultar F1-S13).
- `leads.last_simulation_id uuid NULL FK credit_simulations ON DELETE SET NULL` — adicionar; tirar o "FK virtual" do schema atual (`apps/api/src/db/schema/leads.ts` linha ~155 cita "FK virtual" para tabela futura).

### Seed mínimo

- 1 produto `microcredito_basico` (org default do seed F1-S01).
- 1 regra v1: `min_amount=500, max_amount=5000, min_term=3, max_term=24, monthly_rate=0.025, amortization=price`.

## Arquivos permitidos

- `apps/api/src/db/schema/credit/products.ts`
- `apps/api/src/db/schema/credit/productRules.ts`
- `apps/api/src/db/schema/credit/simulations.ts`
- `apps/api/src/db/schema/credit/index.ts`
- `apps/api/src/db/schema/index.ts` (re-export)
- `apps/api/src/db/schema/leads.ts` (adicionar FK física em `last_simulation_id` — remover comentário "FK virtual")
- `apps/api/src/db/schema/kanbanCards.ts` (adicionar `last_simulation_id` se não existir)
- `apps/api/src/db/schema/__tests__/credit.test.ts`
- `apps/api/src/db/migrations/0016_credit_core.sql`
- `apps/api/src/db/migrations/meta/_journal.json` (se Drizzle exigir)

## Definition of Done

- [ ] 3 tabelas criadas com todos os índices, FKs e checks listados.
- [ ] Imutabilidade documentada nos comentários do schema (regra: app garante; DB não impede update — explicitar).
- [ ] FK física de `leads.last_simulation_id` e `kanban_cards.last_simulation_id` para `credit_simulations`.
- [ ] Seed cria 1 produto + 1 regra v1 idempotente (`ON CONFLICT DO NOTHING`).
- [ ] Tests: `pnpm --filter @elemento/api db:migrate` + assertion de schema via Drizzle introspect.
- [ ] `pnpm --filter @elemento/api typecheck && lint && test` verdes.
- [ ] PR aberto.

## Validação

```powershell
pnpm --filter @elemento/api db:migrate
pnpm --filter @elemento/api test -- credit
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api typecheck
```
