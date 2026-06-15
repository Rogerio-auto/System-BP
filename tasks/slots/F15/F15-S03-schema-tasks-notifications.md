---
id: F15-S03
title: Schema — tabelas `tasks`, `notifications`, `notification_preferences`
phase: F15
task_ref: null
status: in-progress
priority: high
estimated_size: M
agent_id: null
claimed_at: 2026-06-15T18:47:53Z
completed_at: null
pr_url: null
depends_on: []
blocks: [F15-S04, F15-S05, F15-S06, F15-S08]
labels: [tasks, notifications, schema, foundation]
source_docs:
  - docs/planejamento-2026-06-evolucao.md#f2-role-de-cobrança-dashboard-status-spc-item-9
  - docs/10-seguranca-permissoes.md
---

# F15-S03 — Schema das fundações Tarefas + Notificações

## Objetivo

Criar as tabelas reutilizáveis de **tarefas** (atribuídas a role + cidade, decisão D14) e **notificações** (in-app + preferências de canal, decisão D12), que os Épicos E (win-back) e F.3 (advocacia) também consumirão.

## Contexto

Item 9 / Épico F.2d + F.2e. Tarefas são atribuídas a um **role dentro de uma cidade** (não a usuário), reutilizando o modelo `user_city_scopes`. Notificações fazem fan-out por canal a partir de eventos de outbox.

## Escopo (faz)

- Migration (`0058_tasks_notifications.sql`) + schemas Drizzle:
  - `tasks`: `id`, `organization_id`, `assignee_role` (FK/text de role key), `city_id` (FK cities, **nullable** = global), `type` (`spc_inclusion`, `spc_removal`, `winback`, `lawyer_handoff`, `custom`), `entity_type`, `entity_id`, `title`, `description` (nullable), `due_at` (nullable), `status` (`open` → `done`/`cancelled`, default `open`), `claimed_by` (FK users, nullable), `claimed_at`, `completed_by`, `completed_at`, timestamps. Índices: `(organization_id, assignee_role, city_id, status)` e parcial `WHERE status='open'`.
  - `notifications`: `id`, `organization_id`, `user_id` (destinatário in-app), `type`, `title`, `body`, `entity_type`/`entity_id` (nullable), `read_at` (nullable), `created_at`. Índice `(user_id, read_at)`.
  - `notification_preferences`: `id`, `organization_id`, `user_id`, `channel` (`in_app`/`email`/`whatsapp`), `enabled` (default true), unique `(user_id, channel)`.
- Exportar os 3 novos schemas em `apps/api/src/db/schema/index.ts`.

## Fora de escopo (NÃO faz)

- Contratos Zod compartilhados (F15-S04).
- Módulos backend (F15-S05/S06) e worker (F15-S08).

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/db/migrations/0058_tasks_notifications.sql`
- `apps/api/src/db/migrations/meta/_journal.json`
- `apps/api/src/db/schema/tasks.ts`
- `apps/api/src/db/schema/notifications.ts`
- `apps/api/src/db/schema/notificationPreferences.ts`
- `apps/api/src/db/schema/index.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/db/schema/customers.ts` (F15-S02)
- `apps/api/src/modules/**`

## Contratos de saída

- Tabelas + tipos Drizzle inferidos disponíveis para os módulos backend.

## Definition of Done

- [ ] 3 tabelas criadas com FKs, índices e defaults corretos; multi-tenant (`organization_id`)
- [ ] `assignee_role` + `city_id` modelam atribuição regional; `city_id` NULL = global
- [ ] Exports adicionados ao `index.ts` sem quebrar os existentes
- [ ] Migration aplica limpo em DB existente; `check-migrations` OK
- [ ] `pnpm --filter @elemento/api typecheck` verde

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
python scripts/slot.py check-migrations
```

## Notas para o agente

- `tasks.entity_type`/`entity_id` é polimórfico (cliente/contrato/parcela) — não crie FK rígida; valide na borda de aplicação.
- `assignee_role` deve casar com as role keys existentes (`agente`, `cobranca`...). Não duplique enum de role; referencie a chave canônica.
- Use o primeiro número de migration livre (coordene com `check-migrations`; F15-S01/S02 e F14-S04 também criam migrations).
