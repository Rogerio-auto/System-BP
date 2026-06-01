---
id: F0-S22
title: Fix CI — testes E2E desatualizados em relação ao schema (8ª camada)
phase: F0
task_ref: F0.22
status: available
priority: critical
estimated_size: XS
agent_id: qa-tester
depends_on: []
blocks: []
labels: [ci, e2e, tests, schema-drift]
source_docs:
  - apps/api/src/db/schema/leads.ts
  - apps/api/src/db/schema/events.ts
---

# F0-S22 — Testes E2E desatualizados em relação ao schema

## Contexto

F0-S21 destravou a 7ª camada (statement-breakpoint em migration 0041).
Stack inteira sobe, **todas as migrations rodam**, e o E2E Smoke chegou
no step final — **"Run E2E smoke tests"** — os testes de fluxo crítico
em si. Falha por 2 bugs nos próprios testes (não na infra):

### Bug 1 — `outbox_events` não existe (nome de tabela)

`apps/api/test/e2e/seed.ts:204` (na função `cleanE2eData`):

```ts
await db.execute(sql`
  DELETE FROM outbox_events
  WHERE organization_id = ${E2E_ORG_ID}
    AND created_at > NOW() - INTERVAL '1 hour';
`);
```

A tabela real do outbox é **`event_outbox`** (ver
`apps/api/src/db/schema/events.ts:41`: `pgTable('event_outbox', …)`).

Erro no CI:

```
error: relation "outbox_events" does not exist
 ❯ Module.cleanE2eData test/e2e/seed.ts:203:3
```

Provavelmente quem escreveu o teste inverteu o nome (`outbox_events` é
intuitivo, mas o canônico é `event_outbox` — substantivo + adjetivo na
ordem do domínio).

### Bug 2 — Insert de lead sem `name` (NOT NULL violado)

`apps/api/test/e2e/handoff-on-langgraph-failure.e2e.test.ts:57-67`:

```ts
const leadRows = await db
  .insert(leads)
  .values({
    organizationId: E2E_ORG_ID,
    source: 'whatsapp',
    status: 'new',
    phoneE164: '+556900000099',
    phoneNormalized: '556900000099',
  })
  .returning({ id: leads.id });
```

Falta `name`. Em `apps/api/src/db/schema/leads.ts:112`:

```ts
name: text('name').notNull();
```

Erro no CI:

```
error: null value in column "name" of relation "leads" violates not-null constraint
 ❯ test/e2e/handoff-on-langgraph-failure.e2e.test.ts:57:20
```

Esses testes nunca rodaram completos antes — o E2E Smoke quebrava muito
antes (camadas 1-7). Agora que a stack chega até eles, expõem o drift.

## Objetivo

Corrigir os 2 testes para alinhar com o schema atual. Após esse fix, o
E2E Smoke deve ficar 100% verde — completando o destrava-CI iniciado em
F0-S17.

## Escopo

### 1. `apps/api/test/e2e/seed.ts`

Linha ~204 — trocar `outbox_events` por `event_outbox`:

```ts
// ANTES
await db.execute(sql`
  DELETE FROM outbox_events
  WHERE organization_id = ${E2E_ORG_ID}
    AND created_at > NOW() - INTERVAL '1 hour';
`);

// DEPOIS
await db.execute(sql`
  DELETE FROM event_outbox
  WHERE organization_id = ${E2E_ORG_ID}
    AND created_at > NOW() - INTERVAL '1 hour';
`);
```

**Verificar também outras ocorrências:**

```powershell
grep -rn "outbox_events" apps/api/test apps/api/src
```

Se houver mais de uma, corrigir todas.

### 2. `apps/api/test/e2e/handoff-on-langgraph-failure.e2e.test.ts`

Linhas 57-67 — adicionar `name` ao insert:

```ts
// ANTES
.values({
  organizationId: E2E_ORG_ID,
  source: 'whatsapp',
  status: 'new',
  phoneE164: '+556900000099',
  phoneNormalized: '556900000099',
})

// DEPOIS
.values({
  organizationId: E2E_ORG_ID,
  name: 'E2E Test Lead (handoff)',
  source: 'whatsapp',
  status: 'new',
  phoneE164: '+556900000099',
  phoneNormalized: '556900000099',
})
```

**Verificar outras chamadas a `.insert(leads)` nos testes E2E:**

```powershell
grep -rnE "\.insert\(leads\)\s*\.values" apps/api/test/e2e
```

Cada uma precisa ter `name`. Se houver mais, corrigir todas com nome
descritivo do contexto do teste.

### 3. Validação local antes de pushar

```powershell
docker compose up -d postgres
pnpm --filter @elemento/api db:migrate
pnpm --filter @elemento/api e2e
```

Os testes E2E devem rodar verdes localmente.

## Fora de escopo

- Refatorar a estrutura geral dos testes E2E.
- Adicionar novos testes.
- Mexer no schema do banco.
- F8-S18 (UI Cobrança/Templates, PR #171) — destrava depois desse merge.

## Arquivos permitidos

- `apps/api/test/e2e/seed.ts`
- `apps/api/test/e2e/handoff-on-langgraph-failure.e2e.test.ts`
- Outros arquivos `apps/api/test/e2e/**.ts` se a auditoria acima achar
  mais ocorrências (escopo expandido proativamente, declarando no PR).

## Arquivos proibidos

- Schema do DB (`apps/api/src/db/schema/**`).
- Migrations (`apps/api/src/db/migrations/**`).
- Código de produção (`apps/api/src/**` exceto a pasta `test/`).
- Tudo fora de `apps/api/test/e2e/`.

## Definition of Done

- [ ] `outbox_events` → `event_outbox` em todas as ocorrências dos testes E2E.
- [ ] `.insert(leads).values({...})` em testes E2E sempre tem `name`.
- [ ] `pnpm --filter @elemento/api e2e` verde local (com postgres + api +
      langgraph rodando via docker compose).
- [ ] CI verde no PR: Node + Python + **E2E Smoke** todos PASS.
- [ ] PR documenta a lista total de arquivos modificados e qualquer
      ocorrência extra encontrada na auditoria.

## Validação

```powershell
# Garante stack limpa
docker compose down -v
docker compose up -d postgres
pnpm --filter @elemento/api db:migrate

# Sobe api + langgraph
docker compose up -d api langgraph

# Roda E2E
pnpm --filter @elemento/api e2e
```
