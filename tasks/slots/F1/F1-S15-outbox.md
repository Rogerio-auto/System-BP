---
id: F1-S15
title: Outbox — schema + emit() + worker outbox-publisher
phase: F1
task_ref: T1.15
status: available
priority: critical
estimated_size: L
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F0-S04]
blocks: [F1-S11, F1-S13, F1-S22]
source_docs:
  - docs/04-eventos.md
  - docs/12-tasks-tecnicas.md#T1.15
---

# F1-S15 — Outbox pattern

## Objetivo
Outbox completo: schema, helper `emit(tx, event)`, worker dedicado `outbox-publisher` com `LISTEN/NOTIFY`, idempotência por `(event_id, handler_name)`, DLQ após N tentativas.

## Escopo
- Schemas: `event_outbox`, `event_processing_logs`, `event_dlq`.
- `apps/api/src/events/types.ts` — discriminated union dos eventos do sistema.
- `apps/api/src/events/emit.ts` — `emit(tx: DrizzleTx, event: AppEvent): Promise<void>`.
- `apps/api/src/workers/outbox-publisher.ts` — processo separado:
  - `LISTEN` em canal `outbox_new`.
  - `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 50`.
  - Roteia para handlers registrados.
  - Marca `processed` ou incrementa `attempts`.
  - Move pra DLQ após 5 falhas.
- Trigger Postgres em `event_outbox` que faz `NOTIFY outbox_new`.
- Testes de idempotência e DLQ.

## Arquivos permitidos
- `apps/api/src/db/schema/events.ts`
- `apps/api/src/db/migrations/000X_*.sql`
- `apps/api/src/events/**`
- `apps/api/src/workers/outbox-publisher.ts`
- `apps/api/src/workers/_runtime.ts` (helpers de worker)
- `apps/api/package.json` (script `worker:outbox`)

## Definition of Done
- [ ] Emit + worker testados em integração
- [ ] Idempotência por `(event_id, handler)`
- [ ] DLQ funcional
- [ ] LISTEN/NOTIFY reduz latência (testar)
- [ ] PR aberto
