---
id: F16-S02
title: Schema multicanal do live chat — channels, channel_secrets, conversations, messages, webhook_events
phase: F16
task_ref: docs/planejamento-live-chat-proprio.md#4-dados-schema-multicanal-decisao-d2
status: review
priority: critical
estimated_size: L
agent_id: null
claimed_at: 2026-06-14T22:25:29Z
completed_at: 2026-06-14T23:39:54Z
pr_url: null
depends_on: []
blocks: [F16-S04, F16-S06, F16-S07, F16-S11]
labels: [lgpd-impact]
source_docs:
  - docs/planejamento-live-chat-proprio.md
  - docs/03-modelo-dados.md
  - docs/17-lgpd-protecao-dados.md
docs_required: false
docs_audience: [dev]
docs_artifacts: []
---

# F16-S02 — Schema multicanal do live chat

## Objetivo

Criar o schema canônico do live chat (decisão D2, shape do tagix): `channels`, `channel_secrets`
(cifrado), `conversations`, `messages`, `webhook_events` — multi-tenant (`organization_id`) e com
escopo de cidade, sem tocar nas tabelas legadas `whatsapp_messages`/`chatwoot_*`.

## Contexto

O estado de mensagem hoje vive em `whatsappMessages.ts`/`chatwootEvents.ts`, amarrado a WhatsApp+Chatwoot.
A decisão D2 adota o schema multicanal do tagix como store canônico; o legado vira bridge (slot de
migração futuro, fora desta fase). Este slot desbloqueia transporte, webhook, domínio e workers.

## Escopo (faz)

- `channels.ts`: `id`, `organization_id`, `city_id?`, `provider` (`meta_whatsapp|meta_instagram|waha`),
  `name`, `display_handle`, campos por provider (`phone_number`, `phone_number_id`, `waba_id`,
  `meta_app_id`, `ig_user_id`, `ig_username`, `ig_account_type`, `fb_page_id`, `waha_session_id`),
  `is_active`, `is_default`, timestamps, soft-delete. CHECK de coerência por provider.
- `channelSecrets.ts`: `channel_id` FK, `access_token_enc`, `app_secret_enc?`, `api_key_enc?` (colunas
  cifradas via `lib/crypto` — nunca texto plano). FK `on delete cascade`.
- `conversations.ts`: `organization_id`, `city_id?`, `channel_id` FK, `contact_remote_id`, `contact_name?`,
  `contact_phone_enc?`, `lead_id?`/`customer_id?` FK, `status` (`open|pending|resolved|snoozed`),
  `assigned_user_id?`, `last_inbound_at`, `last_message_at`, `kind` (`dm|group|comment_thread`), `unread_count`.
- `messages.ts`: `conversation_id` FK, `channel_id`, `direction` (`in|out`), `external_id`, `type`
  (taxonomia da §3 do planejamento), `content?`, `media_url?`/`media_mime?`/`media_size_bytes?`/`media_sha256?`,
  `interactive_payload jsonb?`, `view_status` (`pending|sent|delivered|read|failed`), `metadata jsonb`, timestamps.
- `webhookEvents.ts`: dedup `(provider, event_id)` único, `raw_payload jsonb`, `processed_at`, retenção 30d.
- Índices: `conversations(organization_id, channel_id, last_message_at desc)`, `messages(conversation_id, created_at)`,
  unique parcial `messages(channel_id, external_id)`, unique `channels(organization_id, provider, phone_number_id)`.
- Migration via `drizzle-kit generate` + entry no `_journal.json`.
- Re-export em `db/schema/index.ts` (ordem alfabética).

## Fora de escopo (NÃO faz)

- Bridge/backfill do legado `whatsapp_messages` (slot de migração futuro).
- Repository/serviço (S07).
- Tabela de notas internas / routing history.

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/db/schema/channels.ts`
- `apps/api/src/db/schema/channelSecrets.ts`
- `apps/api/src/db/schema/conversations.ts`
- `apps/api/src/db/schema/messages.ts`
- `apps/api/src/db/schema/webhookEvents.ts`
- `apps/api/src/db/schema/index.ts`
- `apps/api/src/db/migrations/**`
- `apps/api/src/db/schema/__tests__/livechat.test.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/db/schema/whatsappMessages.ts` (legado — não tocar)
- `apps/api/src/db/schema/chatwootEvents.ts` (legado — não tocar)
- `apps/api/src/modules/**`

## Contratos de saída

- Tabelas + tipos Drizzle inferidos (`Channel`, `Conversation`, `Message`, etc.) consumidos por S04/S06/S07/S11.

## Definition of Done

- [ ] 5 tabelas criadas com `organization_id` + soft-delete + timestamps padrão
- [ ] Colunas PII cifradas (`*_enc`) — nunca texto plano (doc 17 §8)
- [ ] CHECK de coerência por provider em `channels`
- [ ] Índices e uniques parciais conforme escopo
- [ ] Migration gerada + `_journal.json` sincronizado (`slot.py check-migrations` verde)
- [ ] **LGPD:** checklist §14.2 no PR; label `lgpd-impact`; inventário de PII atualizado (doc 17)
- [ ] `pnpm --filter @elemento/api typecheck` / `lint` / `test` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- livechat
python scripts/slot.py check-migrations
```

## Notas para o agente

- Reaproveitar o DATA_MODEL do tagix como referência de colunas, mas adaptar naming ao projeto
  (snake_case, `organization_id`, `city_id`, soft-delete `deleted_at`).
- `contact_phone_enc` segue o mesmo padrão de CPF cifrado + (se precisar dedupe) hash HMAC.
- FKs com `on delete` explícito pensado (cascade em secrets/messages; set null em lead/customer/assigned).
