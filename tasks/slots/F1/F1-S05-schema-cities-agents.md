---
id: F1-S05
title: Schema cities + agents + seed cidades de Rondônia
phase: F1
task_ref: T1.5
status: review
priority: high
estimated_size: M
agent_id: db-schema-engineer
claimed_at: 2026-05-11T00:00:00Z
completed_at: 2026-05-12T03:36:45Z
pr_url: null
depends_on: [F1-S01]
blocks: [F1-S06, F1-S07, F1-S09]
source_docs:
  - docs/03-modelo-dados.md
  - docs/12-tasks-tecnicas.md#T1.5
---

# F1-S05 — Schema cities + agents

## Objetivo

Tabelas `cities` (com `aliases text[]` para fuzzy match) e `agents` (operadores humanos), com índices `pg_trgm` em `name_normalized` e seed das cidades de Rondônia atendidas.

## Escopo

- `apps/api/src/db/schema/cities.ts` — `id, organization_id, name, name_normalized (unaccent+lower), aliases (text[]), state, is_active, ...`
- `apps/api/src/db/schema/agents.ts` — `id, organization_id, user_id (nullable, FK), full_name, primary_city_id (FK), is_active, ...`
- `apps/api/src/db/schema/agent_cities.ts` — `(agent_id, city_id)` PK composta (assignments multi-cidade)
- Migration com índice GIN em `cities.name_normalized` usando `gin_trgm_ops`.
- Seed em `apps/api/scripts/seed-cities.ts` populando Porto Velho + cidades atendidas (lista completa em `docs/01-prd-produto.md` ou aproximação razoável — registrar fonte no PR).

## Fora de escopo

- CRUD endpoints (slot F1-S06).
- Resolução fuzzy (slot dedicado em F3 ou helper aqui se trivial).

## Arquivos permitidos

- `apps/api/src/db/schema/cities.ts`
- `apps/api/src/db/schema/agents.ts`
- `apps/api/src/db/schema/agent_cities.ts`
- `apps/api/src/db/schema/index.ts` (re-export)
- `apps/api/src/db/migrations/000X_*.sql`
- `apps/api/scripts/seed-cities.ts`

## Definition of Done

- [ ] Migration aplica
- [ ] Seed popula >= 8 cidades reais
- [ ] Aliases preenchidos (variações de grafia comuns)
- [ ] PR aberto
