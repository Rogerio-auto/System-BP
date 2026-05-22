---
id: F5-S04
title: Cancelamento de followup por resposta do cliente
phase: F5
task_ref: T5.4
status: available
priority: high
estimated_size: S
agent_id: backend-engineer
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F5-S01, F5-S03, F1-S19, F1-S15]
blocks: []
labels: []
source_docs:
  - docs/05-modulos-funcionais.md
  - docs/07-integracoes-whatsapp-chatwoot.md
---

# F5-S04 — Cancelamento de followup por resposta do cliente

## Objetivo

Quando o cliente responde no WhatsApp, todos os `followup_jobs` futuros com `status='scheduled'` para esse lead viram `cancelled` com motivo `customer_replied`. Evita disparar lembretes após o lead já ter interagido — requisito básico de UX e compliance (não importunar).

## Escopo

- Handler de outbox `apps/api/src/handlers/cancel-followups-on-inbound-message.ts`:
  - Consome `whatsapp.inbound_message_received` (já emitido por F1-S19)
  - `UPDATE followup_jobs SET status='cancelled', last_error='customer_replied', updated_at=now() WHERE lead_id=$1 AND status='scheduled'`
  - Idempotente via `event_processing_logs` (mesma evento processado 2x → 1 update)
  - Log estruturado: `lead_id`, `jobs_cancelled`
- Registrar handler em `apps/api/src/workers/outbox-publisher.ts` (ou onde handlers são registrados)
- Audit log: `actor_kind='system'`, `action='followup_cancelled_on_reply'`
- Teste de integração: simula evento → confere que jobs futuros do lead viraram cancelled

## Fora de escopo

- UI de cancelamento manual (F5-S05)
- Cancelamento por mudança de estágio (deferred)

## Arquivos permitidos

```
apps/api/src/handlers/cancel-followups-on-inbound-message.ts
apps/api/src/workers/outbox-publisher.ts
apps/api/src/handlers/__tests__/cancel-followups-on-inbound-message.test.ts
```

## Definition of Done

- [ ] Handler registrado e processa o evento correto
- [ ] Idempotente
- [ ] Log + audit emitidos
- [ ] Teste cobre: 0 jobs (no-op), N jobs cancelados, evento já processado (no-op idempotente)

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- cancel-followups
```
