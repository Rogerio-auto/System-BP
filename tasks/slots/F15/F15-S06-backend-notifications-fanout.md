---
id: F15-S06
title: Backend — notificações in-app + fan-out por canal (email/WhatsApp)
phase: F15
task_ref: null
status: review
priority: high
estimated_size: M
agent_id: null
claimed_at: 2026-06-15T21:01:40Z
completed_at: 2026-06-15T21:22:01Z
pr_url: null
depends_on: [F15-S01, F15-S03, F15-S04, F15-S05]
blocks: [F15-S08, F15-S10]
labels: [notifications, backend, outbox, lgpd]
docs_required: false
source_docs:
  - docs/planejamento-2026-06-evolucao.md#f2-role-de-cobrança-dashboard-status-spc-item-9
  - docs/04-eventos.md
  - docs/17-lgpd-protecao-dados.md
---

# F15-S06 — Backend notificações + fan-out por canal

## Objetivo

Entregar o subsistema de notificações: API "minhas notificações" (in-app) + fan-out por canal (in-app grava linha, email e WhatsApp para o time interno) acionado por eventos de outbox (decisão D12).

## Contexto

Item 9 / Épico F.2e. Notificações nascem de eventos (`task.created`, `task.assigned`, `payment_due.overdue_15d`) e fazem fan-out conforme `notification_preferences`. WhatsApp/email são para o **time interno**, não para o titular. Sem PII bruta no payload do outbox; conteúdo final montado no sender com `pino.redact` nos logs.

## Escopo (faz)

- Módulo `apps/api/src/modules/notifications/`: `routes.ts`, `controller.ts`, `service.ts`, `repository.ts`, `schemas.ts`, `index.ts`, `__tests__/`, e subpasta `senders/` (`inApp.ts`, `email.ts`, `whatsapp.ts`).
- Endpoints: `GET /api/notifications` (minhas, com badge count), `POST /api/notifications/:id/read`, `POST /api/notifications/read-all`, `GET/PUT /api/notifications/preferences`.
- Handler de outbox `apps/api/src/handlers/fanout-notification.ts` que, ao receber o evento, resolve destinatários (role+city ou usuário) e dispara cada canal habilitado. Registrar em `apps/api/src/handlers/index.ts`.
- Sender WhatsApp reaproveita `templates/metaClient` (template aprovado para time interno); email via provedor configurado; in-app grava `notifications`.
- RBAC `notifications:read`; respeitar escopo regional ao resolver destinatários.

## Fora de escopo (NÃO faz)

- Emissão dos eventos de domínio (tarefas em F15-S05; overdue em F15-S08).
- UI do badge (F15-S10).

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/modules/notifications/**`
- `apps/api/src/handlers/fanout-notification.ts`
- `apps/api/src/handlers/index.ts`
- `apps/api/src/app.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/modules/tasks/**`
- `apps/api/src/events/types.ts` (F15-S05/S08 são donos)
- `apps/api/src/db/schema/**`

## Contratos de entrada

- Tabelas `notifications`/`notification_preferences` (F15-S03), contratos (F15-S04), eventos já tipados por F15-S05.

## Contratos de saída

- API de notificações + handler de fan-out registrado, consumindo eventos do outbox.

## Definition of Done

- [ ] Fan-out resolve destinatários por role+city e respeita `notification_preferences`
- [ ] Sem PII bruta no payload do outbox; logs com `pino.redact`
- [ ] in-app/email/whatsapp como senders desacoplados (1 evento → N canais)
- [ ] RBAC + testes positivos/negativos; idempotência no consumo do evento
- [ ] `pnpm --filter @elemento/api typecheck && lint && test` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- notifications
```

## Notas para o agente

- `app.ts` e `handlers/index.ts` são compartilhados — este slot roda após F15-S05 (ver `depends_on`), não em paralelo.
- Senders devem falhar isolados (um canal cair não derruba os outros); use o padrão de retry/tenacity já presente.
- LGPD: WhatsApp/email ao time interno carrega referência ao cliente — checklist §14.2 do doc 17.
