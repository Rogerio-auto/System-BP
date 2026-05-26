---
id: F8-S13
title: Fix seed.ts ROLES sem scope — quebra db:seed pós-migration 0021
phase: F8
task_ref: hotfix
status: done
priority: high
estimated_size: XS
agent_id: ''
claimed_at: 2026-05-26T17:00:10Z
completed_at: 2026-05-26T17:02:54Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/158
depends_on: []
blocks: []
labels: []
source_docs:
  - tasks/PROTOCOL.md
  - apps/api/src/db/migrations/0021_roles_scope_column.sql
  - apps/api/src/db/schema/roles.ts
  - docs/10-seguranca-permissoes.md
---

# F8-S13 — Fix seed.ts ROLES sem `scope` (quebra db:seed)

## Contexto (incidente 2026-05-26)

Após merge de F8-S12, Rogério rodou `pnpm --filter @elemento/api db:seed` para
materializar `credit_analyses:*` no admin. Falhou:

```
[seed] Inserindo roles...
ERRO: o valor nulo na coluna "scope" da relação "roles" viola a restrição de não-nulo
Registro que falhou contém (..., admin, Administrador, Acesso ..., null).
code: 23502
```

### Causa raiz

`apps/api/src/db/schema/roles.ts:47` declara:

```ts
scope: roleScopeEnum('scope').notNull(),
```

Sem `.default(...)`. Migration `0021_roles_scope_column.sql` (F8-S07):

1. Adicionou a coluna nullable.
2. Backfill das 6 roles canônicas.
3. `ALTER COLUMN "scope" SET NOT NULL`.

Mas o array `ROLES` em `apps/api/scripts/seed.ts:88-120` **nunca foi atualizado**
para incluir `scope`. O INSERT do seed:

```sql
INSERT INTO "roles" ("id", "key", "label", "description", "scope")
VALUES (default, $1, $2, $3, default), ...
ON CONFLICT ("key") DO NOTHING
```

`default` para `scope` resolve para `NULL` (sem default declarado) → violação
NOT NULL **antes** do conflict check do Postgres. Bug latente desde F8-S07
porque ninguém re-rodou `db:seed` em ambiente já populado até agora.

### Mapeamento canônico (doc 10 §3.1 + migration 0021 §2)

| key               | scope    |
| ----------------- | -------- |
| `admin`           | `global` |
| `gestor_geral`    | `global` |
| `gestor_regional` | `city`   |
| `agente`          | `city`   |
| `operador`        | `city`   |
| `leitura`         | `city`   |

## Objetivo

`pnpm --filter @elemento/api db:seed` roda sem erro em DB existente
(idempotente) e em DB recém-criado (cria as 6 roles com scope correto).

## Escopo

### 1. `apps/api/scripts/seed.ts`

- Adicionar `scope: 'global' | 'city'` (literal) a cada entrada do array
  `ROLES` (linhas 88-120) conforme a tabela acima.
- O type do array é `as const` — TypeScript vai inferir o literal sem cast.
- O insert no Drizzle (`.insert(roles).values(ROLES)`) deve passar `scope`
  automaticamente já que está no objeto. Verificar que o tipo `NewRole`
  (de `roles.ts`) aceita o literal — caso contrário, type-narrowing trivial.

### 2. Verificação adicional

- Garantir que após o fix o seed inserir as 6 roles em DB vazio (não
  reproduzir só o caso "DB com roles preexistentes"). O `as const` mais
  o `.notNull()` no schema deve garantir typecheck.

## Fora de escopo

- Não tocar em `apps/api/src/db/schema/roles.ts` — schema está correto.
- Não tocar em `apps/api/src/db/migrations/0021_roles_scope_column.sql` —
  migration está correta.
- Não adicionar default ao `scope` no schema — scope é campo de negócio,
  não tem default razoável. Forçar declaração explícita no seed é mais
  honesto.
- Não tocar nas outras entries de `seed.ts` (PERMISSIONS, ROLE_PERMISSIONS,
  ORG_DATA etc.) — fora de escopo.

## Arquivos permitidos

- `apps/api/scripts/seed.ts`

## Arquivos proibidos

- `apps/api/src/db/schema/**`
- `apps/api/src/db/migrations/**`
- Qualquer outro arquivo.

## Definition of Done

- [ ] Array `ROLES` em `seed.ts` tem `scope: 'global' | 'city'` em todas
      as 6 entradas conforme tabela canônica.
- [ ] `pnpm --filter @elemento/api typecheck` verde.
- [ ] `pnpm --filter @elemento/api lint --max-warnings 0` verde.
- [ ] `pnpm --filter @elemento/api test` verde (sem regressão).
- [ ] PR descreve passos de validação manual: Rogério roda
      `pnpm --filter @elemento/api db:seed` em DB existente → sem erro;
      log `[seed] Seed concluído.` aparece no final.

## Validação

```powershell
pnpm --filter @elemento/api typecheck
```

```powershell
pnpm --filter @elemento/api lint
```

```powershell
pnpm --filter @elemento/api test
```

## Notas

- Bug origem: F8-S07 (commit que introduziu migration 0021). O slot escreveu
  a migration correta + atualizou o schema, mas esqueceu de propagar para
  o seed.ts. Falha de revisão de PR à época.
- Após o merge, Rogério precisa rodar `pnpm --filter @elemento/api db:seed`
  novamente para completar o objetivo original do F8-S12 (popular
  `credit_analyses:*` no admin).
