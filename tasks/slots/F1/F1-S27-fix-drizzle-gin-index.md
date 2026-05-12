---
id: F1-S27
title: Fix encadeamento .using('gin') em schemas Drizzle (cities, leads)
phase: F1
task_ref: hotfix
status: review
priority: critical
estimated_size: XS
agent_id: claude-code
claimed_at: 2026-05-12T16:16:43Z
completed_at: 2026-05-12T16:18:30Z
pr_url: null
depends_on: []
blocks: []
source_docs: []
---

# F1-S27 — Fix encadeamento `.using('gin')` em schemas Drizzle

## Contexto

Três índices GIN em `apps/api/src/db/schema/cities.ts` (linhas 130 e 133) e `apps/api/src/db/schema/leads.ts` (linha 282) usam o encadeamento `index(...).on(col).using('gin')`. Em Drizzle ORM 0.34.1 (versão fixada em `apps/api/package.json`), o builder `IndexBuilderOn` expõe `using(method, ...columns)` **antes** de `.on(...)` — após `.on(...)` o objeto retornado (`IndexBuilder`) não tem mais `.using`.

Resultado: crash `TypeError: index(...).on(...).using is not a function` em **module-load** do `schema/index.ts`. Isso bloqueia tudo que importa o schema:

- `pnpm --filter @elemento/api db:migrate`
- `pnpm --filter @elemento/api db:seed`
- `pnpm --filter @elemento/api db:seed-cities`
- `pnpm --filter @elemento/api typecheck` (tsc consegue, mas o `tsx` runtime quebra qualquer script)
- `pnpm dev` da API
- Qualquer teste de integração que toque `db`

Os índices em si **já existem** no Postgres porque as migrations SQL (`0002_cities_agents.sql`, `0007_leads_core.sql`) foram escritas à mão com o `gin_trgm_ops` correto (a NOTA acima de cada linha quebrada explica isso). As declarações no schema TS são puramente decorativas (Drizzle não consegue expressar `gin_trgm_ops` natively) — não geram SQL, apenas precisam carregar sem crash.

Origem: introduzido em `abe3454 feat(db): F1-S05 cities + agents + seed Rondonia (#14)` e replicado em F1-S09 (leads). Não detectado porque nenhuma validação automatizada de F1-S05/F1-S09 carregava o schema em runtime (apenas `db:generate` da Drizzle, que usa o introspector, não roda o módulo de schema diretamente).

## Objetivo

Trocar o encadeamento quebrado para a forma suportada em Drizzle 0.34.1:

```ts
// Antes (quebrado):
index('nome').on(col).using('gin');

// Depois (correto):
index('nome').using('gin', col);
```

## Escopo

Três substituições literais:

- `apps/api/src/db/schema/cities.ts:130` — `idx_cities_name_normalized_trgm`
- `apps/api/src/db/schema/cities.ts:133` — `idx_cities_aliases_gin`
- `apps/api/src/db/schema/leads.ts:282` — `idx_leads_name_trgm`

## Fora de escopo

- Migrar para `gin_trgm_ops` expressado em Drizzle (não suportado em 0.34.1 — manter o SQL hand-written).
- Tocar nas migrations SQL (`0002_*`, `0007_*`) — já estão corretas no banco.
- Adicionar testes de carga do schema (carregamento já é validado por `pnpm typecheck` + `pnpm test`).
- Upgrade do Drizzle para versão que suporte `gin_trgm_ops` nativamente.

## Arquivos permitidos

- `apps/api/src/db/schema/cities.ts`
- `apps/api/src/db/schema/leads.ts`

## Arquivos proibidos

- `apps/api/src/db/migrations/**` — migrations já corretas, mexer aqui é fora de escopo.
- Qualquer outro arquivo — fix é cirúrgico, sem refactor adjacente.

## Definition of Done

- [ ] 3 linhas trocadas para `.using('gin', col)`.
- [ ] `pnpm --filter @elemento/api typecheck` verde.
- [ ] `pnpm --filter @elemento/api db:migrate` carrega o schema sem crash (idempotente — não deve aplicar nada novo já que migrations já estão aplicadas).
- [ ] PR aberto com referência ao commit `abe3454` (F1-S05) na descrição.

## Validação

```powershell
pnpm --filter @elemento/api typecheck
```

```powershell
pnpm --filter @elemento/api lint
```

## Notas

- Não há mudança de comportamento de runtime do banco — os índices GIN com `gin_trgm_ops` continuam existindo idênticos no Postgres.
- Validado manualmente em 2026-05-12: após o fix, `db:migrate` e `db:seed` rodam até o fim, admin é criado e seed idempotente passa.
