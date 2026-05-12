---
id: F1-S21
title: Webhook Chatwoot — entrada + idempotência
phase: F1
task_ref: T1.21
status: review
priority: medium
estimated_size: M
agent_id: claude-code
claimed_at: 2026-05-12T17:49:44Z
completed_at: 2026-05-12T23:39:30Z
pr_url: null
depends_on: [F1-S20, F1-S15]
blocks: []
source_docs:
  - docs/12-tasks-tecnicas.md#T1.21
---

# F1-S21 — Webhook Chatwoot

## Objetivo

Receber `message_created`, `conversation_status_changed`, `conversation_assignee_changed`. Validar HMAC. Idempotência por `id+updated_at`.

## Definition of Done

- [ ] HMAC validado
- [ ] Eventos persistidos via outbox
- [ ] PR aberto
