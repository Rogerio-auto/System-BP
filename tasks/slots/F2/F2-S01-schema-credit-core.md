---
id: F2-S01
title: Schema credit_products + product_rules + simulations + seed
phase: F2
task_ref: T2.1
status: in-progress
priority: critical
estimated_size: M
agent_id: db-schema-engineer
claimed_at: '2026-05-14T12:00:00Z'
completed_at: null
pr_url: null
depends_on: [F1-S09, F1-S13]
blocks: [F2-S02, F2-S03, F2-S04, F2-S05, F2-S06]
source_docs:
  - docs/03-modelo-dados.md
  - docs/12-tasks-tecnicas.md
---

# F2-S01 — Schema credit_products + product_rules + simulations + seed

## Objetivo

Criar as 3 tabelas do core de crédito no Drizzle ORM, gerar e aplicar a migration SQL, adicionar FK física `last_simulation_id` em `leads` e `kanban_cards`, e seed idempotente com 1 produto + 1 regra v1.

## Escopo

- `credit_products` — catálogo de produtos de crédito por organização.
- `credit_product_rules` — regras versionadas (parâmetros numéricos) por produto.
- `credit_simulations` — resultado imutável de cada simulação realizada.
- Atualizar `leads.ts`: substituir comentário "FK virtual" por FK física para `credit_simulations`.
- Atualizar `kanbanCards.ts`: adicionar colunas `product_id` e `last_simulation_id` com FKs físicas.
- Migration `0016_credit_core.sql` (0014 e 0015 reservadas para F8).
- Seed idempotente: produto `microcredito_basico` + regra v1 (R$ 500–5000, 3–24m, 2,5%/mês, Price).
- Re-exportar em `db/schema/index.ts`.
- Testes: `__tests__/credit.test.ts` cobrindo insert, unique constraint, FK violations.

## Definition of Done

- [ ] `pnpm --filter @elemento/api db:generate` gera migration 0016.
- [ ] `pnpm --filter @elemento/api db:migrate` aplica sem erros.
- [ ] `pnpm typecheck` passa.
- [ ] `pnpm test` passa (inclusive `credit.test.ts`).
- [ ] Unique `(product_id, version)` testado com tentativa de duplicação que falha.
- [ ] FK `fk_leads_last_simulation` ativa e nomeada.
- [ ] FK `fk_kanban_cards_last_simulation` ativa e nomeada.
- [ ] Seed idempotente: re-rodar não duplica dados.

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api test -- --reporter=verbose
```
