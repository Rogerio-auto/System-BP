---
id: F1-S23
title: Feature flags — schema + admin UI + middleware backend + hook frontend
phase: F1
task_ref: T1.23
status: review
priority: high
estimated_size: L
agent_id: backend-engineer
claimed_at: '2026-05-12T01:30:00Z'
completed_at: '2026-05-12T01:45:00Z'
pr_url: null
depends_on: [F1-S04]
blocks: []
source_docs:
  - docs/09-feature-flags.md
  - docs/12-tasks-tecnicas.md#T1.23
---

# F1-S23 — Feature flags (4 camadas)

## Objetivo

Sistema de flags real bloqueando UI + API + worker + tools de IA. Admin alterna via UI.

## Escopo

- Schema `feature_flags` (key, status: enabled|disabled|hidden, ui_label, audience, updated_by, ...).
- Endpoints CRUD admin + endpoint público autenticado `/api/feature-flags/me`.
- Middleware Fastify `featureGate('crm.import.enabled')` retornando 403 com payload claro quando `disabled`.
- Hook `useFeatureFlag` no frontend (cache no bootstrap, invalidação por evento ou polling 30s).
- Helper de worker `requireFlag(key)` que pula job se flag desligada.
- Helper Python `require_flag` para tools (chama `/internal/feature-flags/check`).
- Audit log em toggle.

## Definition of Done

- [ ] Toggle pela UI atualiza em ≤ 30s no client
- [ ] 4 camadas testadas
- [ ] Hidden no UI esconde, Disabled mostra "Em desenvolvimento"
- [ ] PR aberto
