---
id: F1-S09
title: Schema leads + customers + history + interactions
phase: F1
task_ref: T1.9
status: available
priority: critical
estimated_size: M
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F1-S01, F1-S05]
blocks: [F1-S11, F1-S13]
source_docs:
  - docs/03-modelo-dados.md
  - docs/12-tasks-tecnicas.md#T1.9
---

# F1-S09 — Schema leads/customers/history/interactions

## Objetivo

Schemas Drizzle do core do CRM com índices, constraints, dedupe por telefone.

## Escopo

- `leads` — `id, organization_id, city_id, agent_id?, name, phone_e164, phone_normalized, source, status, last_simulation_id?, ...`
- `customers` — `id, organization_id, primary_lead_id, ...`
- `lead_history` — append-only, `lead_id, action, before, after, actor_user_id, created_at`
- `interactions` — `id, lead_id, channel (whatsapp|phone|email|in_person), direction, content, metadata, created_at`
- Índice único parcial: `(organization_id, phone_normalized) WHERE deleted_at IS NULL`.
- Índice trgm em `name`.

## Definition of Done

- [ ] Migration aplica
- [ ] Constraints únicas testadas (criar duplicado falha)
- [ ] PR aberto
