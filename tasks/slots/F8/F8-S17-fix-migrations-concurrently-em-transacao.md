---
id: F8-S17
title: Fix migrator Drizzle — `CREATE INDEX CONCURRENTLY` falha silenciosamente em transação
phase: F8
task_ref: hotfix
status: in-progress
priority: high
estimated_size: S
agent_id: ''
claimed_at: 2026-05-26T22:41:47Z
completed_at: ''
pr_url: ''
depends_on: []
blocks: []
labels: []
source_docs:
  - tasks/PROTOCOL.md
  - apps/api/src/db/migrate.ts
  - apps/api/src/db/migrations/0002_cities_agents.sql
  - apps/api/src/db/migrations/0041_leads_notion_page_id.sql
  - docs/02-arquitetura-sistema.md
---

# F8-S17 — Fix migrator Drizzle com `CONCURRENTLY` em transação

## Contexto (incidente 2026-05-26)

Após o fix F8-S16, Rogério reiniciou o dev server e o erro 500 em
`GET /api/leads?search=...` persistiu com stack:

```
error: coluna "notion_page_id" não existe
    at findLeads (apps/api/src/modules/leads/repository.ts:171:29)
```

A coluna existe no schema Drizzle (`apps/api/src/db/schema/leads.ts:232`) e
no SQL da migration (`0041_leads_notion_page_id.sql:27`), mas **não existia
no banco local**. Rodar `pnpm --filter @elemento/api db:migrate` reportou
`✅ Migrations aplicadas` sem aplicar nada — o journal
`drizzle.__drizzle_migrations` já tinha o hash da `0041` registrado, mas a
coluna não existia.

### Causa raiz

`apps/api/src/db/migrations/0041_leads_notion_page_id.sql` faz dois statements:

```sql
ALTER TABLE leads ADD COLUMN IF NOT EXISTS notion_page_id text NULL;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_leads_notion_page_id
  ON leads (organization_id, notion_page_id)
  WHERE notion_page_id IS NOT NULL;
```

`drizzle-orm/node-postgres/migrator` (em `migrate.ts:8`) executa o arquivo
**inteiro** dentro de um `BEGIN/COMMIT` único. Postgres recusa
`CREATE INDEX CONCURRENTLY` dentro de transação com `25001 ACTIVE_SQL_TRANSACTION`.

O comportamento observado em dev: o `ALTER TABLE` foi aplicado, o
`CREATE INDEX CONCURRENTLY` falhou, a transação inteira fez rollback,
**mas o Drizzle migrator gravou o hash no journal mesmo assim** (bug conhecido
upstream — o runner grava o journal antes de validar o resultado do statement
final, ou o ordem do `INSERT INTO __drizzle_migrations` é fora da transação).

O hotfix manual que destravou o ambiente local foi rodar fora de transação:

```sql
ALTER TABLE leads ADD COLUMN notion_page_id text NULL;
CREATE UNIQUE INDEX CONCURRENTLY uq_leads_notion_page_id
  ON leads (organization_id, notion_page_id)
  WHERE notion_page_id IS NOT NULL;
```

### Migrations afetadas (audit preliminar)

- `apps/api/src/db/migrations/0002_cities_agents.sql` — contém referência a
  CONCURRENTLY (verificar se há statement real).
- `apps/api/src/db/migrations/0041_leads_notion_page_id.sql` — confirmadamente
  quebrada no DB do Rogério.

Outros ambientes (CI, prod futuro) podem ter o mesmo drift se rodarem essas
migrations agora.

## Objetivo

1. Migrations com `CONCURRENTLY` (ou qualquer statement que não roda em
   transação) executam corretamente sem deixar o journal mentindo.
2. Devs/CI/prod podem rodar `pnpm db:migrate` em DB limpo ou existente sem
   schema drift silencioso.
3. Detectar drift do journal vs schema real (smoke check) antes do dev server
   subir.

## Escopo

### 1. `apps/api/src/db/migrate.ts` — runner customizado

Substituir `migrate()` do drizzle-orm por um runner próprio que:

1. Lê o journal `drizzle.__drizzle_migrations` (criar schema/tabela se não existirem).
2. Lê os arquivos SQL ordenados em `src/db/migrations/`.
3. Para cada migration não-aplicada:
   - Lê o conteúdo do `.sql`.
   - **Detecta** se o arquivo contém `CONCURRENTLY`, `VACUUM`, `REINDEX`, ou
     comentário-marker `-- no-transaction` na primeira linha.
   - Se sim → executa os statements **fora** de transação (`Client.query` direto, statement por statement).
   - Se não → roda dentro de `BEGIN/COMMIT` (padrão atual).
4. Após sucesso, insere `{hash, created_at}` no journal.
5. Se falhou:
   - Modo transacional → o `ROLLBACK` reverte o statement e o journal **não** é gravado.
   - Modo não-transacional → grava o erro e aborta antes de gravar no journal; deixa o banco em estado parcial mas explícito (loga "migration partially applied: rerun manually after fixing").

Hash: usar o mesmo algoritmo do drizzle-kit (SHA-256 do conteúdo). Confirmar
implementação lendo `node_modules/drizzle-orm/node-postgres/migrator.js`.

### 2. Smoke check de drift (script novo, opt-in)

`apps/api/scripts/check-schema-drift.ts`:

- Conecta no DB.
- Para cada tabela do schema Drizzle, faz `SELECT * FROM <tabela> LIMIT 0`.
- Postgres erra se uma coluna referenciada no schema não existir.
- Útil pra rodar antes de `pnpm dev` ou em CI.

Adicionar comando `db:check-drift` em `apps/api/package.json`.

### 3. Reconciliação do journal das duas migrations afetadas

Não tocar nas migrations existentes (`0002`, `0041`) — elas estão corretas no
SQL. Apenas garantir que o novo runner executa o `0041` direito em DBs novos.
Para DBs em drift (caso do Rogério), o runner deve detectar via smoke check
(item 2) e instruir o operador a rodar manualmente.

**Não escrever migration de "fix forward"** — operadores em drift devem rodar
manualmente o hotfix (documentar em `docs/19-runbook-go-live.md` numa seção
de troubleshooting).

### 4. Documentação

- Atualizar `docs/19-runbook-go-live.md` com seção "Migrations não-transacionais"
  e troubleshooting "schema drift por journal mentiroso".
- Adicionar header padrão em todas as migrations com CONCURRENTLY:
  `-- no-transaction` na primeira linha (para o novo runner detectar).

## Fora de escopo

- Não reescrever migrations existentes — só auditar.
- Não criar migrations de "fix forward" — drift se resolve via comando manual
  documentado no runbook.
- Não trocar pg/postgres por outro driver.
- Não tocar em `drizzle.config.ts` nem no `db:generate` (geração).
- Não mexer em outros módulos além de `db/`.

## Arquivos permitidos

- `apps/api/src/db/migrate.ts` (reescrita do runner)
- `apps/api/scripts/check-schema-drift.ts` (novo script)
- `apps/api/package.json` (adicionar `db:check-drift`)
- `apps/api/src/db/__tests__/migrate.test.ts` (criar — testes do runner)
- `docs/19-runbook-go-live.md` (seção troubleshooting)
- `apps/api/src/db/migrations/0002_cities_agents.sql` (adicionar marker `-- no-transaction` se aplicável)
- `apps/api/src/db/migrations/0041_leads_notion_page_id.sql` (adicionar marker `-- no-transaction`)

## Arquivos proibidos

- `apps/api/src/db/schema/**` (schema não muda)
- `apps/api/src/db/migrations/0001-0040` (mantém história)
- `apps/api/src/db/migrations/0042+` (não há)
- Qualquer arquivo fora dos diretórios listados.

## Definition of Done

- [ ] `pnpm --filter @elemento/api db:migrate` em DB limpo aplica todas as
      migrations (incluindo `0041` com `CONCURRENTLY`) sem erro.
- [ ] `pnpm --filter @elemento/api db:migrate` em DB existente é idempotente
      (não roda nada se journal está em dia).
- [ ] Quando uma migration com `-- no-transaction` falha no meio: - Journal **não** é gravado. - Erro é logado claramente: "migration X partially applied, fix manually
      and rerun".
- [ ] `pnpm --filter @elemento/api db:check-drift` detecta colunas faltando
      (testar dropando `notion_page_id` num DB de teste e rodando o script —
      deve falhar com mensagem clara).
- [ ] Teste vitest `migrate.test.ts` cobre: - Aplica migration transacional simples. - Aplica migration com `CONCURRENTLY` (verifica que rodou fora de transação). - Migration que falha em modo transacional → rollback + journal vazio. - Migration que falha em modo não-transacional → journal vazio + erro claro.
- [ ] Runbook atualizado.
- [ ] `pnpm --filter @elemento/api typecheck` + `lint` + `test` verdes.
- [ ] PR descreve passos manuais: - Drop coluna `notion_page_id` no DB local. - `pnpm db:migrate` → aplica `0041` corretamente. - `pnpm db:check-drift` → verde.

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

- Bug origem: F7-S04 (PR que introduziu `0041`). O CI rodou em DB limpo e por
  algum motivo a `CONCURRENTLY` não bateu o erro lá (ou o erro foi ignorado).
  Documentar isso no PR — pode haver outro bug latente no CI.
- Drizzle issue upstream: https://github.com/drizzle-team/drizzle-orm/issues
  (procurar "CONCURRENTLY" e "transaction" antes de abrir novo). Referenciar
  no PR.
- Esse slot **não corrige** o drift no DB local — o Rogério já corrigiu
  manualmente. Corrige o **runner** pra não criar mais drifts no futuro.
