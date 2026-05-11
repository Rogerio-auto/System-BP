---
id: F0-S04
title: Drizzle — primeira migration vazia + smoke test
phase: F0
task_ref: T0.3
status: review
priority: high
estimated_size: S
agent_id: claude-opus-4-7
claimed_at: 2026-05-11T00:00:00Z
completed_at: 2026-05-11T10:40:00Z
pr_url: null
depends_on: [F0-S01]
blocks: [F1-S01]
source_docs:
  - docs/12-tasks-tecnicas.md#T0.3
  - apps/api/drizzle.config.ts
---

# F0-S04 — Drizzle migration inicial

## Objetivo
`pnpm db:generate` + `pnpm db:migrate` funcionam end-to-end contra o Postgres do compose. Pipeline de migration validado antes da Fase 1 começar.

## Escopo
- Criar uma migration "marco zero" em `apps/api/src/db/migrations/0000_init.sql` que:
  - Garante extensions (no-op se já existem via `init/01-extensions.sql`).
  - Cria tabela técnica `_schema_meta(applied_at timestamptz default now())` com 1 linha.
- Testar que `pnpm db:migrate` aplica e é idempotente.
- Atualizar README do `apps/api` com fluxo `generate → review → migrate`.

## Fora de escopo
- Schemas de domínio (cada um vira slot próprio em F1+).

## Arquivos permitidos
- `apps/api/src/db/migrations/0000_init.sql`
- `apps/api/src/db/migrations/meta/_journal.json` (gerado pelo drizzle-kit)
- `apps/api/README.md`

## Definition of Done
- [ ] Migration aplica em DB limpo
- [ ] Re-rodar migration não falha
- [ ] CI roda migration em job dedicado
- [ ] PR aberto

## Validação
```powershell
docker compose up -d postgres
pnpm --filter @elemento/api db:migrate
# Rodar de novo: deve ser no-op
pnpm --filter @elemento/api db:migrate
```
