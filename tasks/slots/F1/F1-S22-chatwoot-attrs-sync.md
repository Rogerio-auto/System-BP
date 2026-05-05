---
id: F1-S22
title: Sync de atributos do Chatwoot (handler de eventos)
phase: F1
task_ref: T1.22
status: blocked
priority: medium
estimated_size: S
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
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
