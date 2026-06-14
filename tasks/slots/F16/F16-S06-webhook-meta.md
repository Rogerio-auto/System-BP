---
id: F16-S06
title: Webhook Meta (Fastify) — verify por-app, HMAC por-canal, dedup, publish inbound
phase: F16
task_ref: docs/planejamento-live-chat-proprio.md#53-consequencias-arquiteturais-do-app-por-cliente
status: blocked
priority: high
estimated_size: M
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F16-S02, F16-S03, F16-S04]
blocks: [F16-S08]
labels: [lgpd-impact]
source_docs:
  - docs/planejamento-live-chat-proprio.md
  - docs/07-integracoes-whatsapp-chatwoot.md
  - docs/10-seguranca-permissoes.md
  - docs/17-lgpd-protecao-dados.md
docs_required: false
docs_audience: [dev]
docs_artifacts: []
---

# F16-S06 — Webhook Meta (ingestão)

## Objetivo

Receber os webhooks da Meta (WhatsApp/Instagram) num endpoint Fastify, validar (verify token por-app,
HMAC por-canal), deduplicar via `webhook_events` e publicar `inbound.message` no RabbitMQ — respondendo
200 em < 5s. Processamento pesado é assíncrono (worker S08).

## Contexto

Diverge do tagix (Tech Provider único, 1 app_secret): aqui o modelo app-por-cliente exige resolver o
`app`/`channel` pelo envelope (`entry[].id` = WABA id) e validar com o secret daquele canal (S04).
Em Express no tagix; aqui é **Fastify 5**.

## Escopo (faz)

- `modules/meta-webhook/routes.ts`: `GET /api/webhooks/meta` (verify `hub.verify_token` por-app) +
  `POST /api/webhooks/meta` (HMAC por-canal via S04 → dedup → publish → 200).
- `modules/meta-webhook/schemas.ts`: Zod do envelope (`object`, `entry[]`).
- `modules/meta-webhook/dedup.ts`: idempotência por `(provider, event_id)` em `webhook_events` (S02).
- `modules/meta-webhook/service.ts`: despacho por `body.object` (`whatsapp_business_account|instagram`) →
  `publish('inbound.message', {provider, channelId, payload})`.
- Rate-limit no endpoint público; raw body preservado para HMAC.

## Fora de escopo (NÃO faz)

- Parsing de conteúdo / persistência (S08 + adapter S05).
- Webhook WAHA (canal não-oficial — slot futuro, fallback D5).
- Connect de canal (S11).

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/modules/meta-webhook/**`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/modules/whatsapp/**` (legado)
- `apps/api/src/integrations/channels/**` (S04/S05 donos)
- `apps/api/src/workers/**`

## Contratos de entrada

- `verifyMetaSignature` por-canal (S04), `webhook_events` (S02), `publish()` (S01), envelope schema (S03).

## Contratos de saída

- Mensagem `inbound.message` na fila `hm.q.inbound.message` com `{provider, channelId, rawPayload}`.

## Definition of Done

- [ ] GET verify responde challenge só com token correto (por-app)
- [ ] POST valida HMAC por-canal; assinatura inválida = 401/403 (e métrica zero em prod)
- [ ] Dedup: mesmo `event_id` não publica duas vezes
- [ ] Publica em < 5s e responde 200 mesmo com payload grande
- [ ] Rate-limit aplicado; raw body disponível para HMAC
- [ ] **LGPD:** não logar corpo do webhook; só ids + provider; label `lgpd-impact`; checklist §14.2
- [ ] `pnpm --filter @elemento/api typecheck` / `lint` / `test` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- meta-webhook
```

## Notas para o agente

- Fastify: registrar `rawBody` (ou `preParsing`) para o HMAC; cuidado com o parser JSON consumindo o stream.
- `entry[].id` (WABA id) é a chave para resolver o canal/secret. Se canal desconhecido → 200 + log warn (não vazar).
- Não confundir com `modules/whatsapp` legado (cobrança) — este é o webhook novo multicanal.
