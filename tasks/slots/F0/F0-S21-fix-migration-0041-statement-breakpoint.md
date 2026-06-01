---
id: F0-S21
title: Fix CI — migration 0041 sem `--> statement-breakpoint` (7ª e última camada)
phase: F0
task_ref: F0.21
status: done
priority: critical
estimated_size: XS
agent_id: db-schema-engineer
depends_on: []
blocks: []
labels: [ci, infra, migrations, db-schema]
source_docs:
  - apps/api/src/db/migrate.ts
  - apps/api/src/db/migrations/0041_leads_notion_page_id.sql
claimed_at: 2026-06-01T20:28:34Z
completed_at: 2026-06-01T20:30:19Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/176
---

# F0-S21 — Migration `0041_leads_notion_page_id` sem statement-breakpoint

## Contexto

F0-S20 destravou o carregamento de `.env` no migrate (6ª camada). Stack
inteira sobe, **39 migrations executam com sucesso** (0000 → 0040). 7ª
camada apareceu no step seguinte:

```
[migrate] Aplicando 0041_leads_notion_page_id (mode=non-transactional)...
[migrate] ERRO em migration não-transacional 0041_leads_notion_page_id:
          CREATE INDEX CONCURRENTLY cannot run inside a transaction block
```

### Causa raiz (provada)

`apps/api/src/db/migrate.ts:122` splita statements pelo marker
`--> statement-breakpoint`. Em modo non-transactional (linha 226-230),
cada statement é enviado separadamente ao pg client (sem `BEGIN/COMMIT`).

**MAS:** `0041_leads_notion_page_id.sql` tem **2 statements** (ALTER TABLE +
CREATE INDEX CONCURRENTLY) e **zero markers** `--> statement-breakpoint`
entre eles. Resultado: o runner trata os 2 como 1 só, e
`client.query(trimmed)` envia múltiplos comandos numa única call — o pg
driver envolve em **transação implícita**. CREATE INDEX CONCURRENTLY recusa.

**Comparação:**

```
grep -c "statement-breakpoint" 0002_cities_agents.sql       # 17 ✅ passa
grep -c "statement-breakpoint" 0041_leads_notion_page_id.sql # 0  ❌ falha
```

`0002` é também `non-transactional` e tem CONCURRENTLY — mas tem 17
breakpoints, por isso o runner spliata corretamente, e o pg driver não
envolve em tx implícita (cada statement chega isolado).

### Por que o F8-S17 não pegou isso

F8-S17 fixou o caso "falha silenciosa" (journal era gravado antes do erro
em transação envelopada). Agora a falha **aparece** com mensagem clara,
mas o split de statements ainda depende do marker. `0041` foi criado
depois (F7-S04) sem o marker.

## Objetivo

Adicionar `--> statement-breakpoint` em `0041_leads_notion_page_id.sql`
entre os 2 statements. Re-executar o E2E Smoke até verde.

## Escopo

### 1. Editar `apps/api/src/db/migrations/0041_leads_notion_page_id.sql`

Conteúdo atual relevante (linhas 28-34):

```sql
ALTER TABLE leads ADD COLUMN IF NOT EXISTS notion_page_id text NULL;

-- CONCURRENTLY não pode rodar dentro de uma transação explícita.
-- O Drizzle runner executa cada statement separadamente por default.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_leads_notion_page_id
  ON leads (organization_id, notion_page_id)
  WHERE notion_page_id IS NOT NULL;
```

Inserir `--> statement-breakpoint` entre o `ALTER TABLE` e o `CREATE INDEX`:

```sql
ALTER TABLE leads ADD COLUMN IF NOT EXISTS notion_page_id text NULL;
--> statement-breakpoint

-- CONCURRENTLY não pode rodar dentro de uma transação explícita.
-- O Drizzle runner executa cada statement separadamente por default.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_leads_notion_page_id
  ON leads (organization_id, notion_page_id)
  WHERE notion_page_id IS NOT NULL;
```

> Atenção: o marker precisa ser exatamente `--> statement-breakpoint` (sem
> espaços extras, sem maiúsculas) — é a sintaxe do drizzle-kit.

### 2. Atualizar o hash no `_journal.json`?

**NÃO.** O hash é calculado pelo runner em `migrate.ts:119`
(`crypto.createHash('sha256').update(content).digest('hex')`), sobre o
conteúdo BRUTO. Se a migration ainda não foi aplicada em prod, o hash
novo é o que será gravado. Em ambiente dev/CI que já tem o DB limpo, não
há conflito.

**Se** a migration já foi aplicada em algum ambiente (prod ou staging),
mudar o conteúdo causa drift detection. Confirmar com o time se já rodou
em algum lugar — provavelmente não, dado que o CI nunca passou desse
ponto até hoje.

### 3. Auditar outras migrations futuras

Não é estritamente parte do slot, mas considerar:

```powershell
# Procurar arquivos não-transacionais sem breakpoint
for f in apps/api/src/db/migrations/*.sql; do
  if grep -qE "(no-transaction|CONCURRENTLY|VACUUM|REINDEX)" "$f"; then
    count=$(grep -c "statement-breakpoint" "$f")
    echo "$f: breakpoints=$count"
  fi
done
```

Hoje só 2 arquivos non-tx: `0002` (17 breakpoints ✅) e `0041` (0 ❌).

## Fora de escopo

- Mudar o runner em `migrate.ts` para detectar múltiplos statements sem
  marker. Discutível — sintaxe oficial drizzle-kit exige o marker, e o
  runner já está alinhado. Adicionar parser SQL seria over-engineering.
- F8-S18 (UI Cobrança/Templates, PR #171) — destrava depois desse merge.

## Arquivos permitidos

- `apps/api/src/db/migrations/0041_leads_notion_page_id.sql`

## Arquivos proibidos

- Tudo o resto, incluindo `migrate.ts` e `_journal.json`.

## Definition of Done

- [ ] Marker `--> statement-breakpoint` adicionado entre o `ALTER TABLE` e o
      `CREATE INDEX CONCURRENTLY`.
- [ ] CI verde no PR: Node + Python + **E2E Smoke** todos PASS.
- [ ] Local: `pnpm --filter @elemento/api db:migrate` aplica `0041` com sucesso.
- [ ] PR documenta a confirmação de que a migration ainda não foi aplicada
      em prod (zero drift risk).

## Validação

```powershell
# Local — DB limpo, aplica todas:
docker compose down -v
docker compose up -d postgres
pnpm --filter @elemento/api db:migrate

# CI faz o resto.
```
