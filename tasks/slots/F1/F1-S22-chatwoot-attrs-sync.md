---
id: F1-S22
title: Sync de atributos do Chatwoot (handler de eventos)
phase: F1
task_ref: T1.22
status: done
priority: medium
estimated_size: S
agent_id: backend-engineer
claimed_at: 2026-05-12T16:45:00Z
completed_at: 2026-05-12T17:11:00Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/33
depends_on: [F1-S20, F1-S15, F1-S11]
blocks: []
source_docs:
  - docs/12-tasks-tecnicas.md#T1.22
---

# F1-S22 — Sync atributos Chatwoot

## Objetivo

Handler do outbox que reage a `leads.created`, `kanban.stage_updated`, `simulations.generated` e atualiza atributos da conversa Chatwoot via cliente.

## Definition of Done

- [ ] Handler registrado no worker outbox
- [ ] Falha de Chatwoot retenta (max 5) e vai pra DLQ
- [ ] PR aberto
