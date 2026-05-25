---
id: F5-S01
title: Schema followup_rules + followup_jobs + whatsapp_templates
phase: F5
task_ref: T5.1
status: review
priority: high
estimated_size: M
agent_id: db-schema-engineer
claimed_at: 2026-05-25T15:52:01Z
completed_at: 2026-05-25T16:06:14Z
pr_url: null
depends_on: [F0-S04, F1-S09, F1-S15, F1-S23]
blocks: [F5-S02, F5-S03, F5-S04, F5-S05]
labels: []
source_docs:
  - docs/03-modelo-dados.md
  - docs/05-modulos-funcionais.md
  - docs/09-feature-flags.md
  - docs/11-roadmap-executavel.md
---

# F5-S01 — Schema followup_rules + followup_jobs + whatsapp_templates

## Objetivo

Criar a base de dados da régua de follow-up — visível na UI mas **desligada** por flag (`followup.enabled=disabled`). Habilita o trabalho dos workers (F5-S02/S03) e da UI (F5-S05) sem disparar mensagens em produção até o cliente autorizar.

## Escopo

- Migration `0034_followup_and_templates.sql` cria:
  - `whatsapp_templates` (catálogo de templates Meta aprovados)
  - `followup_rules` (catálogo de regras: gatilho + tempo de espera + template)
  - `followup_jobs` (instâncias agendadas por lead/regra)
- Schemas Drizzle correspondentes em `apps/api/src/db/schema/`
- Entry no `meta/_journal.json` no mesmo commit

### Tabela `whatsapp_templates`

| Coluna                 | Tipo                                                                 | Notas                     |
| ---------------------- | -------------------------------------------------------------------- | ------------------------- |
| id                     | uuid PK                                                              |                           |
| organization_id        | uuid NOT NULL FK organizations                                       |                           |
| meta_template_id       | text NOT NULL                                                        | id no Meta Business       |
| name                   | text NOT NULL                                                        | slug interno              |
| language               | text NOT NULL default 'pt_BR'                                        |                           |
| category               | text NOT NULL CHECK IN (`utility`, `marketing`, `authentication`)    |                           |
| body                   | text NOT NULL                                                        | corpo com `{{variables}}` |
| variables              | text[] NOT NULL default '{}'                                         | nomes esperados           |
| status                 | text NOT NULL CHECK IN (`pending`, `approved`, `rejected`, `paused`) |                           |
| created_at, updated_at | timestamptz                                                          |                           |

Índices: `unique (organization_id, name)`, `idx_templates_meta_id`.

### Tabela `followup_rules`

| Coluna                 | Tipo                                                       | Notas                                 |
| ---------------------- | ---------------------------------------------------------- | ------------------------------------- |
| id                     | uuid PK                                                    |                                       |
| organization_id        | uuid NOT NULL FK organizations                             |                                       |
| key                    | text NOT NULL                                              | slug (`d1`, `d3`, `d7`, `d15`)        |
| name                   | text NOT NULL                                              | descrição operacional                 |
| trigger_type           | text NOT NULL CHECK IN (`stage_inactivity`, `event_based`) |                                       |
| wait_hours             | int NOT NULL CHECK > 0                                     |                                       |
| template_id            | uuid NOT NULL FK whatsapp_templates ON DELETE RESTRICT     |                                       |
| applies_to_stage       | text NULL                                                  | filtro: só roda se card neste stage   |
| applies_to_outcome     | text NULL                                                  | filtro: só roda se card neste outcome |
| is_active              | bool NOT NULL default false                                | gated por flag — default off          |
| max_attempts           | int NOT NULL default 3                                     |                                       |
| created_at, updated_at | timestamptz                                                |                                       |

Índices: `unique (organization_id, key)`, `idx_followup_rules_active (organization_id, is_active)`.

### Tabela `followup_jobs`

| Coluna                 | Tipo                                                                                                 | Notas                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------- | --------------------- |
| id                     | uuid PK                                                                                              |                       |
| organization_id        | uuid NOT NULL FK organizations                                                                       |                       |
| lead_id                | uuid NOT NULL FK leads ON DELETE CASCADE                                                             |                       |
| rule_id                | uuid NOT NULL FK followup_rules ON DELETE RESTRICT                                                   |                       |
| scheduled_at           | timestamptz NOT NULL                                                                                 | quando enviar         |
| status                 | text NOT NULL CHECK IN (`scheduled`, `triggered`, `sent`, `failed`, `cancelled`, `customer_replied`) |                       |
| attempt_count          | int NOT NULL default 0                                                                               |                       |
| last_error             | text NULL                                                                                            |                       |
| sent_message_id        | text NULL                                                                                            | wamid Meta após envio |
| idempotency_key        | text NOT NULL                                                                                        | dedupe inserção       |
| created_at, updated_at | timestamptz                                                                                          |                       |

Índices:

- `unique (lead_id, rule_id, idempotency_key)` — dedupe
- `idx_followup_jobs_scheduled (status, scheduled_at) where status='scheduled'` (parcial — performance scheduler)
- `idx_followup_jobs_lead (lead_id, created_at DESC)`

### Seed de feature flag

- `followup.enabled` = `disabled` (default)
- `followup.scheduler.enabled` = `disabled`
- `followup.sender.enabled` = `disabled`

(Ou confirmar que F1-S23 já criou; senão adicionar em seed.)

## Fora de escopo

- Workers (F5-S02/S03)
- UI (F5-S05)
- Cliente Meta templates (F5-S03)

## Arquivos permitidos

```
apps/api/src/db/schema/whatsappTemplates.ts
apps/api/src/db/schema/followupRules.ts
apps/api/src/db/schema/followupJobs.ts
apps/api/src/db/schema/index.ts
apps/api/src/db/migrations/0034_followup_and_templates.sql
apps/api/src/db/migrations/meta/_journal.json
apps/api/src/db/seeds/featureFlags.ts
```

## Definition of Done

- [ ] Migration 0034 criada com header padrão (contexto F5, dependências, comentário de gating)
- [ ] 3 tabelas com FKs explícitas e índices nomeados
- [ ] Trigger `set_updated_at` aplicado nas 3 tabelas
- [ ] Entry em `_journal.json` no mesmo commit
- [ ] `python scripts/slot.py check-migrations` verde
- [ ] Schemas Drizzle exportados
- [ ] Flags `followup.*` semeadas em `disabled`

## Validação

```powershell
python scripts/slot.py check-migrations
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api db:migrate
```
