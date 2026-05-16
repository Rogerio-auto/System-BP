---
id: F8-S07
title: Promover roles.scope a coluna real (migration + backfill) e ler do banco
phase: F8
task_ref: F8.7
status: available
priority: medium
estimated_size: S
agent_id: backend-engineer
claimed_at:
completed_at:
pr_url:
depends_on: [F8-S06]
blocks: []
labels: []
source_docs:
  - docs/10-seguranca-permissoes.md
---

# F8-S07 — `roles.scope` como coluna real

## Contexto (gap descoberto em F8-S06)

F8-S06 entregou `GET /api/admin/roles` retornando `{ id, key, name, scope }`. Mas a
tabela `roles` **não tem coluna `scope`** (`apps/api/src/db/schema/roles.ts` só tem
`id`, `key`, `label`, `description`). O agente resolveu o gap **derivando `scope` do
`key` em runtime** — workaround funcional, mas:

- `scope` é um atributo de domínio do papel (doc 10 §3.1), não algo que se infere do
  nome. Acoplar à convenção de `key` é frágil: criar uma role com key fora do padrão
  quebra a derivação silenciosamente.
- Não há fonte de verdade única — o `scope` "real" não existe no banco.

Este slot promove `scope` a coluna persistida e faz o endpoint ler do banco.

## Objetivo

Adicionar `scope` como coluna real em `roles`, com backfill das roles canônicas, e
substituir a derivação por `key` pela leitura da coluna.

## Escopo

### 1. Schema — `apps/api/src/db/schema/roles.ts`

- Adicionar coluna `scope`. Valores: `global | city` (doc 10 §3.1).
- Usar `pgEnum('role_scope', ['global', 'city'])` (preferível a `text` solto — domínio
  fechado, força integridade). `NOT NULL`.
- Exportar o enum em `db/schema/index.ts` se o padrão do projeto exigir.

### 2. Migration — `0021_roles_scope_column.sql`

- Gerar via `pnpm --filter @elemento/api db:generate` (NÃO escrever o `.sql` à mão —
  deixar o Drizzle gerar enum + coluna + snapshot).
- A migration gerada adiciona a coluna nullable; **complementar com o backfill** das
  roles canônicas e só então `SET NOT NULL`. Sequência segura:
  1. `CREATE TYPE role_scope ...` + `ADD COLUMN scope role_scope` (nullable).
  2. `UPDATE roles SET scope = ...` por `key` conforme doc 10 §3.1.
  3. `ALTER COLUMN scope SET NOT NULL`.
- Backfill: mapear as 6 keys canônicas (`admin`, `gestor_geral`, `gestor_regional`,
  `agente`, `operador`, `leitura`) para `global`/`city` **conforme doc 10 §3.1** — ler
  o doc, não chutar. Se alguma role existir no banco com key fora dessas 6, a migration
  deve falhar de forma explícita (ou logar) em vez de deixar `NULL` — não silenciar.
- **`_journal.json`:** garantir que a entrada `0021` seja adicionada com `when`
  estritamente maior que o de `0019` (`1748822400000`). Migration com `when` não
  monotônico é silenciosamente pulada pelo migrator — incidente já ocorreu neste repo.
  Rodar `python scripts/slot.py check-migrations` antes de fechar.

### 3. Módulo roles — `apps/api/src/modules/roles/**`

- Remover a lógica que **deriva** `scope` a partir do `key`.
- `GET /api/admin/roles` passa a ler `roles.scope` direto da query (selecionar a
  coluna no repository).
- Contrato da resposta **não muda** — `scope` continua sendo `global | city`. É só a
  origem do dado que muda (coluna em vez de derivação). F8-S04 (frontend de agentes) e
  qualquer consumidor continuam funcionando sem alteração.

### 4. Testes

- Atualizar testes de F8-S06 que dependiam da derivação.
- Teste: `GET /api/admin/roles` retorna `scope` correto lido da coluna para as roles
  canônicas (ex: `admin` → `global`, `agente` → `city`).
- Teste de migration/seed: após migrate, nenhuma role fica com `scope` nulo.

## Permissão / city scope / audit

- Reusa `users:admin` (já existe). **Sem nova permissão, sem migration de seed de
  permissão.** A única migration é a da coluna.
- `GET` não muta — sem audit log (consistente com o módulo).

## Arquivos permitidos

- `apps/api/src/db/schema/roles.ts`
- `apps/api/src/db/schema/index.ts`
- `apps/api/src/db/migrations/0021_roles_scope_column.sql`
- `apps/api/src/db/migrations/meta/_journal.json`
- `apps/api/src/db/migrations/meta/0021_snapshot.json`
- `apps/api/src/modules/roles/**`

> Uma única migration neste slot: a coluna `scope`. Se concluir que precisa de outra,
> pare e reporte.

## Definition of Done

- [ ] `roles.scope` existe como coluna `NOT NULL` (`pgEnum role_scope`).
- [ ] Migration `0021` gerada pelo Drizzle, com backfill das 6 roles canônicas conforme
      doc 10 §3.1, e `SET NOT NULL` no fim.
- [ ] `_journal.json` com entrada `0021` e `when` monotônico; `slot.py check-migrations`
      verde.
- [ ] `GET /api/admin/roles` lê `scope` da coluna — derivação por `key` removida (sem
      código morto).
- [ ] Contrato da resposta inalterado — F8-S04 não quebra.
- [ ] Testes de F8-S06 atualizados + teste de leitura da coluna + teste de backfill.
- [ ] `pnpm --filter @elemento/api db:migrate && test -- roles && lint && typecheck`
      verdes (typecheck pode ter erro pré-existente de `anonymizedAt` — reportar, não
      arrumar).
- [ ] PR aberto.

## Validação

```powershell
pnpm --filter @elemento/api db:migrate
python scripts/slot.py check-migrations
pnpm --filter @elemento/api test -- roles
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api typecheck
```
