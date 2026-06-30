---
id: F24-S01
title: DB — schema notification_rules + notification_rule_deliveries + coluna category
phase: F24
task_ref: docs/planejamento-notificacoes.md
status: in-progress
priority: high
estimated_size: M
agent_id: null
depends_on: []
blocks: [F24-S02, F24-S05, F24-S06, F24-S09]
labels: [db-schema, notifications, multi-tenant, lgpd-impact]
source_docs:
  [docs/planejamento-notificacoes.md, docs/03-modelo-dados.md, docs/17-lgpd-protecao-dados.md]
docs_required: false
claimed_at: 2026-06-30T17:04:36Z
---

# F24-S01 — DB: notification_rules + deliveries + category

## Objetivo

Criar a fundação de dados do motor de regras de notificação: tabela `notification_rules`
(regras configuráveis por org), tabela `notification_rule_deliveries` (idempotência/cooldown)
e a coluna `category` em `notification_preferences` (preferência por categoria).

## Contexto

Planejamento §4.2/§4.3/§4.5. Espelhar o padrão de `notifications.ts`/`notificationPreferences.ts`
(já com `organization_id` + FK `organizations`). Multi-tenant-ready: toda tabela nova nasce com
`organization_id NOT NULL`. Próxima migration livre = `0076`. Atualizar `meta/_journal.json`.

## Escopo (faz)

- `notification_rules`: `id`, `organization_id` (FK organizations, NOT NULL), `name`,
  `trigger_kind` (`event`|`stage_inactivity`), `trigger_key`, `category`, `threshold_hours` (nullable),
  `filters` jsonb default `'{}'`, `recipient_mode` (`by_role_city`|`assignee`|`managers`),
  `recipient_roles` text[] default `'{}'`, `channels` text[] default `'{in_app}'`,
  `severity` (`info`|`warning`|`critical`), `cooldown_hours` int default 0, `title_template`,
  `body_template`, `enabled` bool default false, `created_by` (FK users, nullable), timestamps.
  CHECK: `threshold_hours` obrigatório quando `trigger_kind='stage_inactivity'`.
- `notification_rule_deliveries`: `id`, `organization_id`, `rule_id` (FK notification_rules ON DELETE CASCADE),
  `entity_type`, `entity_id`, `bucket` text, `fired_at` timestamptz default now.
  UNIQUE `(rule_id, entity_type, entity_id, bucket)`.
- Coluna `category` (text, nullable) em `notification_preferences`; ajustar UNIQUE para
  `(user_id, channel, category)` (substituindo `(user_id, channel)`) — tratar NULL com índice único
  parcial ou COALESCE conforme padrão do repo.
- Índices: `notification_rules (organization_id, enabled, trigger_kind)`,
  `(organization_id, trigger_key)`; `notification_rule_deliveries (rule_id, fired_at)`.
- Schemas Drizzle correspondentes + migration `.sql` + entry em `_journal.json`.

## Fora de escopo (NÃO faz)

- Seed de permissões/flags (F24-S02).
- Qualquer lógica de aplicação, rota ou worker.
- Backfill de preferências existentes (default permanece opt-out por canal).

## Arquivos permitidos

- `apps/api/src/db/schema/notificationRules.ts`
- `apps/api/src/db/schema/notificationRuleDeliveries.ts`
- `apps/api/src/db/schema/notificationPreferences.ts`
- `apps/api/src/db/schema/index.ts`
- `apps/api/src/db/migrations/0076_notification_rules.sql`
- `apps/api/src/db/migrations/meta/_journal.json`

## Arquivos proibidos

- `apps/web/**`
- `apps/langgraph-service/**`
- `apps/api/src/modules/**`

## Definition of Done

- [ ] Schemas Drizzle de `notification_rules` e `notification_rule_deliveries` com FKs nomeadas
- [ ] Coluna `category` em `notification_preferences` + UNIQUE ajustado
- [ ] CHECK threshold_hours por trigger_kind; índices criados
- [ ] Migration `0076` + entry em `_journal.json`; `db:migrate` aplica limpo
- [ ] `organization_id NOT NULL` + FK organizations em ambas as tabelas novas
- [ ] `pnpm --filter @elemento/api typecheck` verde

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
python scripts/slot.py validate F24-S01
```

## Notas para o agente

- Espelhar comentários/estilo de `apps/api/src/db/schema/notifications.ts`.
- `check-migrations` roda automático porque `files_allowed` lista `db/migrations/`.
- Sem `any`. FKs `organization_id` com `onDelete('restrict')`, `rule_id` com `cascade`.
