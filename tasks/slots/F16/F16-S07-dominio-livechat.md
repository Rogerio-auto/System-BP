---
id: F16-S07
title: Domínio livechat — repository + service de persistência (contact/conversation/message + janela)
phase: F16
task_ref: docs/planejamento-live-chat-proprio.md#4-dados-schema-multicanal-decisao-d2
status: in-progress
priority: high
estimated_size: L
agent_id: null
claimed_at: 2026-06-16T04:51:34Z
completed_at: null
pr_url: null
depends_on: [F16-S02, F16-S03]
blocks: [F16-S08, F16-S10, F16-S12, F16-S14]
labels: [lgpd-impact]
source_docs:
  - docs/planejamento-live-chat-proprio.md
  - docs/03-modelo-dados.md
  - docs/10-seguranca-permissoes.md
  - docs/17-lgpd-protecao-dados.md
docs_required: false
docs_audience: [dev]
docs_artifacts: []
---

# F16-S07 — Domínio livechat (repository + service)

## Objetivo

Camada de domínio compartilhada que persiste e lê conversas/mensagens — usada por inbound worker,
outbound worker, API de conversas e socket relay. Centraliza a lógica para evitar colisão de
`files_allowed` entre esses slots.

## Contexto

Webhook só publica; workers e API precisam de uma única fonte de persistência (ensure contact,
ensure conversation, persist message, update last\_\*, window state). Sem essa camada, inbound/outbound/API
disputariam os mesmos arquivos. Este slot é o "core" do domínio.

## Escopo (faz)

- `modules/livechat/repo.ts`: acesso Drizzle a `channels`/`conversations`/`messages` com
  `applyCityScope` + `organization_id` (RBAC/escopo de cidade first-class).
- `modules/livechat/service.ts`:
  - `ensureContactConversation(channelId, contactRemoteId, name?)` → conversation (cria se não existe).
  - `persistInboundMessage(event)` → insere `messages` (idempotente por `(channel_id, external_id)`),
    atualiza `conversation.last_inbound_at`/`last_message_at`/`unread_count`.
  - `persistOutboundMessage(...)` + `updateViewStatus(messageId, status)`.
  - `getConversation`, `listConversations(filter)`, `getMessages(conversationId, cursor)`.
  - `getComposerState(conversation, channel)` → janela 24h por provider (WA/IG/WAHA, planejamento §3.3).
- `modules/livechat/schemas.ts`: Zod de filtros/entrada (re-using contratos de S03).
- Espelho mínimo em `interactions` (bridge p/ follow-up/CRM) quando aplicável — sem PII bruta no outbox.

## Fora de escopo (NÃO faz)

- Rotas HTTP (S11/S12/S13) e workers (S08/S09/S10) — só a camada de domínio que eles chamam.
- Socket emit (S14).

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/modules/livechat/repo.ts`
- `apps/api/src/modules/livechat/service.ts`
- `apps/api/src/modules/livechat/schemas.ts`
- `apps/api/src/modules/livechat/__tests__/**`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/modules/livechat/routes.ts` (não existe nesta fase aqui — conversas ficam em modules/conversations)
- `apps/api/src/workers/**`
- `apps/api/src/modules/conversations/**`

## Contratos de saída

- `livechatService` com persistência + leitura + `getComposerState` — consumido por S08/S10/S12/S14.

## Definition of Done

- [ ] `persistInboundMessage` idempotente (mesmo external_id não duplica)
- [ ] `listConversations`/`getMessages` aplicam `organization_id` + escopo de cidade (teste positivo + negativo)
- [ ] `getComposerState` retorna janela correta por provider (WA bloqueia >24h → template; IG human_agent tag; WAHA livre)
- [ ] Bridge para `interactions` sem PII bruta no outbox (doc 17 §8.5)
- [ ] **LGPD:** logs com ids + telefone mascarado, sem conteúdo; label `lgpd-impact`; checklist §14.2
- [ ] `pnpm --filter @elemento/api typecheck` / `lint` / `test` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- livechat
```

## Notas para o agente

- Toda escrita que emite evento → grava em `event_outbox` na mesma transação (regra nº7), sem PII bruta.
- `unread_count` e `last_message_at` são a base do ChatList do front — manter consistentes.
- Escopo de cidade: conversa herda `city_id` do canal/lead; queries de inbox filtram por escopo do usuário.
