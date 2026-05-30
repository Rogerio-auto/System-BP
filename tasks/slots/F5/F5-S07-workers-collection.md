---
id: F5-S07
title: Workers collection-scheduler + collection-sender (gated)
phase: F5
task_ref: T5.7
status: review
priority: medium
estimated_size: M
agent_id: backend-engineer
claimed_at: 2026-05-29T23:47:51Z
completed_at: 2026-05-30T00:01:36Z
pr_url: null
depends_on: [F5-S06, F5-S03, F1-S15]
blocks: [F5-S08]
labels: [lgpd-impact]
source_docs:
  - docs/05-modulos-funcionais.md
  - docs/07-integracoes-whatsapp-chatwoot.md
---

# F5-S07 — Workers collection-scheduler + collection-sender

## Objetivo

Espelho da régua de followup (F5-S02/S03), aplicada a parcelas vencidas/a vencer. Gated por `billing.scheduler.enabled` e `billing.sender.enabled`.

## Escopo

- `apps/api/src/workers/collection-scheduler.ts`:
  - Para cada `collection_rule WHERE is_active=true`:
    - `days_before_due`: encontra `payment_dues WHERE status='pending' AND due_date = today + abs(wait_hours)/24`
    - `days_after_due`: encontra `payment_dues WHERE status='overdue' AND due_date = today - wait_hours/24`
  - Cria `collection_jobs` com `idempotency_key = <rule_id>:<due_id>:<day_bucket>`
  - Flag-gating em 2 camadas (idem F5-S02)
- `apps/api/src/workers/collection-sender.ts`:
  - Reutiliza cliente Meta de F5-S03 (`apps/api/src/integrations/meta-whatsapp/client.ts`)
  - Renderiza variáveis: `{{customer_name}}`, `{{installment_number}}`, `{{amount}}`, `{{due_date}}`, `{{contract_reference}}`
  - **Skip se `payment_due.status='paid'`** — atualiza job para `paid_before_send` em vez de enviar
  - Atualiza job: `sent`/`failed` + outbox `billing.collection_sent`/`billing.collection_failed`
- Handler de pagamento: ao mudar `payment_due.status` para `paid`, cancela jobs futuros (idempotente)

## LGPD

- Cobrança usa templates Meta `category='utility'` (não-marketing) — base legal: execução de contrato
- Mesmo PII redact e `pino.redact` do F5-S03
- Audit log por envio
- Outbox sem PII bruta

## Fora de escopo

- UI (F5-S08)
- Importação de payment_dues
- Marcar como pago (slot F5-S08)

## Arquivos permitidos

```
apps/api/src/workers/collection-scheduler.ts
apps/api/src/workers/collection-sender.ts
apps/api/src/workers/index.ts
apps/api/src/workers/__tests__/collection-scheduler.test.ts
apps/api/src/workers/__tests__/collection-sender.test.ts
apps/api/src/handlers/cancel-collections-on-payment.ts
apps/api/src/handlers/__tests__/cancel-collections-on-payment.test.ts
apps/api/src/events/types.ts
```

## Definition of Done

- [ ] Scheduler cria jobs com idempotência
- [ ] Sender envia template com renderização correta
- [ ] Flag-gating 2 camadas
- [ ] Skip de envio se `payment_due` já pago
- [ ] Handler de cancelamento on payment idempotente
- [ ] PII redact em logs (`customer_id`, não telefone)
- [ ] Testes: agendamento, envio, paid_before_send, cancelamento on payment
- [ ] PR com label `lgpd-impact`

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- collection
```
