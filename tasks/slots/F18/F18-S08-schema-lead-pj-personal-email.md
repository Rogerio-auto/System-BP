---
id: F18-S08
title: Schema — lead PJ + personal_email usuários (Onda 2 item 4)
phase: F18
task_ref: docs/planejamento-2026-06-evolucao.md#a2--lead-pj-email-obrigatório-no-manual-unicidade-e-bloqueio-do-email-do-agente-item-4
status: in-progress
priority: high
estimated_size: S
agent_id: null
claimed_at: 2026-06-16T05:21:47Z
completed_at: null
pr_url: null
depends_on: []
blocks: [F18-S09, F18-S10]
labels: [db, schema, migration, leads, lgpd]
source_docs:
  - docs/planejamento-2026-06-evolucao.md
docs_required: false
---
# F18-S08 — Schema: lead PJ + personal_email usuários

## Objetivo

Adicionar campos de Pessoa Jurídica ao lead (`cnpj`, `legal_name`), índice de unicidade de email por org, e `personal_email` nos usuários para bloquear no cadastro de leads.

## Contexto

Item 4 (Onda 2). Decisões: D1=CNPJ texto claro; D2=unicidade por organização; D3=bloquear todos os emails internos da org + cobrar email pessoal do agente no 1º login.

## Escopo (faz)

### Migration `0063_lead_pj_personal_email.sql`

```sql
-- 1. Campos PJ em leads
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS cnpj        TEXT,
  ADD COLUMN IF NOT EXISTS legal_name  TEXT;

-- 2. Unicidade de email por organização (partial — ignora null e soft-deleted)
CREATE UNIQUE INDEX IF NOT EXISTS uq_leads_org_email_active
  ON leads(organization_id, lower(email))
  WHERE email IS NOT NULL AND deleted_at IS NULL;

-- 3. Email pessoal do usuário (para bloqueio no cadastro de leads)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS personal_email CITEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_org_personal_email
  ON users(organization_id, personal_email)
  WHERE personal_email IS NOT NULL;
```

### Drizzle schema

- `apps/api/src/db/schema/leads.ts`: adicionar `cnpj: text('cnpj')` e `legalName: text('legal_name')` (nullable, sem default).
- `apps/api/src/db/schema/users.ts`: adicionar `personalEmail: citext('personal_email')` (nullable).

### shared-schemas

- `packages/shared-schemas/src/leads.ts`:
  - `LeadResponseSchema`: adicionar `cnpj: z.string().nullable()`, `legal_name: z.string().nullable()`.
  - `LeadCreateSchema`: adicionar `cnpj: z.string().min(14).max(18).optional()`, `legal_name: z.string().max(255).optional()`.
- `packages/shared-schemas/src/users.ts` (se existir): adicionar `personal_email: z.string().email().optional().nullable()`.

## Fora de escopo (NÃO faz)

- Validação CNPJ formato (F18-S09).
- Email obrigatório condicional por source (F18-S09).
- UI (F18-S10).
- Migração de dados existentes.

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/db/migrations/0063_lead_pj_personal_email.sql`
- `apps/api/src/db/migrations/meta/_journal.json`
- `apps/api/src/db/schema/leads.ts`
- `apps/api/src/db/schema/users.ts`
- `packages/shared-schemas/src/leads.ts`
- `packages/shared-schemas/src/users.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/modules/**`
- `apps/web/**`

## Definition of Done

- [ ] Migration SQL: coluna `cnpj`, `legal_name`, `personal_email`, índices únicos parciais.
- [ ] Drizzle schema atualizado.
- [ ] shared-schemas atualizados.
- [ ] `pnpm --filter @elemento/api typecheck` verde.
- [ ] E2E Smoke deve passar (migration aplicada no CI) — gate obrigatório.

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
```

## Notas para o agente

- Confirme o número da próxima migration com `python scripts/slot.py check-migrations` — deve ser 0063 (0062 foi usada por F17-S12).
- `citext` já está disponível como extensão no banco (instalada no setup inicial).
- `personal_email` em `users` precisa de `organization_id` no índice único para ser multi-tenant correto.
- O índice de email em leads é `lower(email)` pois `email` é `citext` — confirme que `lower()` é adequado ou se `citext` já garante case-insensitive (pode ser redundante — use o padrão existente do banco).
- LGPD: CNPJ texto claro (D1 confirmado). `personal_email` é dado pessoal do usuário interno — não é PII de lead/cliente, mas adicionar à lista `pino.redact` de qualquer forma.
