---
id: F27-S06
title: Backend — Web Push (VAPID, sender, endpoints subscribe/unsubscribe, fan-out, LGPD)
phase: F27
task_ref: docs/24-pwa.md
status: review
priority: high
estimated_size: L
agent_id: null
depends_on: [F27-S05]
blocks: []
labels: [backend, notifications, pwa, lgpd-impact]
source_docs:
  [
    docs/24-pwa.md,
    docs/23-notificacoes.md,
    docs/17-lgpd-protecao-dados.md,
    docs/10-seguranca-permissoes.md,
  ]
docs_required: false
claimed_at: 2026-07-20T13:30:09Z
completed_at: 2026-07-20T14:27:41Z
---

# F27-S06 — Web Push backend

## Objetivo

Adicionar o Web Push (VAPID) como quarto sender do motor de notificações F24: config de chaves,
endpoints de subscription, sender `webPush` e integração no fan-out — com payload **sem PII** e o
gate LGPD do doc 17 cumprido.

## Contexto

Doc 24 §5/§9/§10. Os senders vivem em `apps/api/src/modules/notifications/senders/` (`inApp`,
`email`, `whatsapp`) e são invocados pelo fan-out em `apps/api/src/handlers/fanout-notification.ts`.
`pino.redact` está em `apps/api/src/app.ts`. Env em `apps/api/src/config/env.ts`. A tabela
`push_subscriptions` vem do F27-S05. Destinatários = só equipe interna; o push **espelha** o in-app
(não cria destinatário novo) e respeita `notification_preferences`.

## Escopo (faz)

- **Config VAPID** em `config/env.ts`: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
  (validadas via Zod; privada nunca no bundle). Registrar no `.env.example` (sem valores reais).
- **Dependência** `web-push` (justificar no PR — implementação de referência do padrão).
- **Sender** `senders/webPush.ts`: envia via `web-push` para as subscriptions do destinatário;
  remove subscriptions mortas (`404`/`410`). Gate por flag `pwa.enabled` (worker) + env.
- **Repository**: CRUD de `push_subscriptions` (upsert idempotente por `endpoint`, soft-delete,
  busca por `user_id` com escopo).
- **Endpoints** (Zod nas bordas, RBAC, idempotência, rate-limit), gate por flag (API) + env:
  - `POST /api/notifications/push/subscription` — upsert da subscription do usuário autenticado.
  - `DELETE /api/notifications/push/subscription` — opt-out/logout.
  - `GET /api/notifications/push/public-key` — devolve `VAPID_PUBLIC_KEY`.
- **Fan-out**: `handlers/fanout-notification.ts` invoca o sender de push junto do in-app/email
  (mesmas regras de destinatário/preferência).
- **Payload LGPD-mínimo** (doc 24 §5.3): só `title` genérico + `severity` + `entity_type`/`entity_id`
  para deep-link. **Nunca** nome/telefone/CPF/valor/mensagem.
- **`pino.redact`** em `app.ts` cobre `endpoint`, `p256dh`, `auth`.
- Schema compartilhado da subscription em `packages/shared-schemas` (contrato front×API).
- Testes: subscribe/unsubscribe (RBAC + idempotência), fan-out chama push, payload sem PII,
  remoção de subscription morta, gate de flag/env.

## Fora de escopo (NÃO faz)

- SW handlers, opt-in UI, subscribe no browser (F27-S07).
- Tabela/migration (F27-S05).
- Notificação push para o tomador (WhatsApp continua sendo o canal do cliente).

## Arquivos permitidos

- `apps/api/src/modules/notifications/senders/webPush.ts`
- `apps/api/src/modules/notifications/repository.ts`
- `apps/api/src/modules/notifications/routes.ts`
- `apps/api/src/modules/notifications/controller.ts`
- `apps/api/src/modules/notifications/schemas.ts`
- `apps/api/src/modules/notifications/service.ts`
- `apps/api/src/modules/notifications/index.ts`
- `apps/api/src/handlers/fanout-notification.ts`
- `apps/api/src/config/env.ts`
- `apps/api/src/app.ts`
- `apps/api/package.json`
- `.env.example`
- `packages/shared-schemas/src/notifications.ts`
- `packages/shared-schemas/src/index.ts`
- `apps/api/src/**/*.test.ts`

## Arquivos proibidos

- `apps/web/**`
- `apps/langgraph-service/**`
- `apps/api/src/db/migrations/**`
- `apps/api/src/db/schema/**`
- `apps/api/src/modules/notifications/senders/inApp.ts`
- `apps/api/src/modules/notifications/senders/email.ts`
- `apps/api/src/modules/notifications/senders/whatsapp.ts`

## Definition of Done

- [ ] VAPID validado por Zod em `env.ts`; privada fora do bundle; `.env.example` atualizado
- [ ] `POST/DELETE /push/subscription` + `GET /push/public-key` com Zod, RBAC, idempotência, rate-limit, gate de flag/env
- [ ] Sender `webPush` envia via VAPID e remove subscriptions `404/410`; gate de flag/env
- [ ] Fan-out invoca push junto de in-app/email, respeitando preferências (só equipe interna)
- [ ] Payload de push SEM PII (só title genérico + severity + entity_type/entity_id)
- [ ] `pino.redact` cobre `endpoint`/`p256dh`/`auth`
- [ ] Checklist LGPD do doc 17 §14.2 no PR + label `lgpd-impact` + RoPA atualizado (novo tratamento)
- [ ] Dependência `web-push` justificada no PR (PROTOCOL §1.3)
- [ ] `pnpm --filter @elemento/api typecheck` + `lint` + `test` + `build` verdes

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
pnpm --filter @elemento/api build
```

## Notas para o agente

- **LGPD (doc 17 vence):** payload de push é canal de terceiro (FCM/Apple/Mozilla) — trate como
  não-confiável, nada de PII (doc 24 §5.3). `endpoint`/keys são dado pessoal → redact + retenção +
  deleção no logout/opt-out. Atualizar RoPA (novo tratamento) e preencher §14.2 do doc 17 no PR.
- Push **espelha** o in-app (mesmo destinatário/preferência) — não crie destinatário novo nem
  regra nova de fan-out.
- Não tocar `inApp`/`email`/`whatsapp` senders — só adicionar o `webPush` e fiá-lo no fan-out.
- `emit()` do outbox lança em idempotency_key duplicada — não reemitir evento; o push consome o
  fan-out existente, não emite evento novo.
  </content>
