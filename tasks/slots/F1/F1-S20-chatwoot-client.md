---
id: F1-S20
title: Cliente HTTP Chatwoot
phase: F1
task_ref: T1.20
status: review
priority: medium
estimated_size: M
agent_id: null
claimed_at: null
completed_at: 2026-05-12T06:06:31Z
pr_url: null
depends_on: [F0-S03]
blocks: [F1-S21, F1-S22]
source_docs:
  - docs/07-integracoes-whatsapp-chatwoot.md
  - docs/12-tasks-tecnicas.md#T1.20
---

# F1-S20 — Cliente Chatwoot

## Objetivo

`apps/api/src/integrations/chatwoot/client.ts` com métodos: `updateAttributes`, `createMessage`, `createNote`, `assignAgent`. Mocks para testes.

## Definition of Done

- [ ] Métodos tipados com Zod nos retornos
- [ ] Retry em 5xx
- [ ] Testes com `nock`/`msw`
- [ ] PR aberto
