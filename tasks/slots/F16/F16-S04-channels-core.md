---
id: F16-S04
title: packages/channels core — IChannelAdapter, graphClient, hmac por-canal, errors
phase: F16
task_ref: docs/planejamento-live-chat-proprio.md#53-consequencias-arquiteturais-do-app-por-cliente
status: available
priority: high
estimated_size: M
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F16-S02, F16-S03]
blocks: [F16-S05, F16-S06]
labels: []
source_docs:
  - docs/planejamento-live-chat-proprio.md
  - docs/07-integracoes-whatsapp-chatwoot.md
docs_required: false
docs_audience: [dev]
docs_artifacts: []
---

# F16-S04 — Núcleo do transporte de canais (channels core)

## Objetivo

Portar do tagix o núcleo compartilhado da camada de transporte: a interface `IChannelAdapter`, o
`graphClient` (graph.facebook.com v23.0 com retry + refresh), o **`verifyMetaSignature` por-canal** e
os erros compartilhados — sem ainda implementar nenhum provider concreto.

## Contexto

Decisão D3 (app-por-cliente) **quebra o `verifyMetaSignature` do tagix**, que usa um único `app_secret`.
Aqui o `app_secret` é por canal/app: a verificação precisa resolver o secret correto (por `waba_id`/
`app_id` do envelope, via `channel_secrets`) **antes** de validar. Este slot estabelece esse contrato.

## Escopo (faz)

- `apps/api/src/integrations/channels/adapter.types.ts`: `IChannelAdapter` (parseInbound, sendText,
  sendMedia, sendTemplate, sendInteractive, downloadMedia, markAsRead, sendTypingIndicator, `capabilities`).
- `apps/api/src/integrations/channels/shared/graphClient.ts`: cliente HTTP (httpx-like) v23.0, retry com
  backoff, refresh de token, timeouts, allowlist de host.
- `apps/api/src/integrations/channels/shared/hmac.ts`: `verifyMetaSignature(rawBody, signatureHeader, resolveSecret)`
  — **resolve o `app_secret` por canal** (callback que busca em `channel_secrets` por `waba_id`/`app_id`).
- `apps/api/src/integrations/channels/shared/errors.ts`: `MetaError` + códigos compartilhados.
- `apps/api/src/integrations/channels/registry.ts`: `getAdapter(provider)` (registro vazio — providers entram em S05+).

## Fora de escopo (NÃO faz)

- Adapter WhatsApp/Instagram concreto (S05 / fase IG).
- Rota de webhook (S06) — aqui só a função de verificação.

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/integrations/channels/adapter.types.ts`
- `apps/api/src/integrations/channels/registry.ts`
- `apps/api/src/integrations/channels/shared/**`
- `apps/api/src/integrations/channels/__tests__/shared.test.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/integrations/meta-whatsapp/**` (legado — não tocar)
- `apps/api/src/integrations/channels/meta/**` (S05 é dono)
- `apps/api/src/lib/whatsappHmac.ts` (legado — não tocar)

## Contratos de saída

- `IChannelAdapter`, `GraphClient`, `verifyMetaSignature(...)` por-canal, `getAdapter()` — consumidos por S05/S06.

## Definition of Done

- [ ] `verifyMetaSignature` valida com secret **resolvido por canal** (teste: secret certo passa, secret errado falha, assinatura ausente 403)
- [ ] `graphClient` com retry/backoff + timeout testado (mock fetch)
- [ ] `IChannelAdapter` cobre todos os métodos do contrato do planejamento §3
- [ ] Timing-safe na comparação de assinatura (sem early-return por char)
- [ ] `pnpm --filter @elemento/api typecheck` / `lint` / `test` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- channels
```

## Notas para o agente

- Portar de `packages/channels/src/shared/*` do tagix, **adaptando** `hmac.ts` para o modelo por-canal
  (a maior divergência do blueprint — ver planejamento §5.3).
- Comparação de HMAC com `crypto.timingSafeEqual`. Reaproveitar `lib/crypto` do projeto onde possível.
- Não adicionar dependência de HTTP nova se `undici`/`fetch` nativo já cobre.
