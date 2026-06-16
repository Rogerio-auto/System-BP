---
id: F16-S05
title: Adapter Meta WhatsApp — webhook.parser + serializer + adapter + códigos de erro WA
phase: F16
task_ref: docs/planejamento-live-chat-proprio.md#22-adapters-meta-whatsapp-instagram
status: review
priority: high
estimated_size: L
agent_id: null
claimed_at: 2026-06-16T05:10:37Z
completed_at: 2026-06-16T05:42:43Z
pr_url: null
depends_on: [F16-S04]
blocks: [F16-S08, F16-S09, F16-S10]
labels: [lgpd-impact]
source_docs:
  - docs/planejamento-live-chat-proprio.md
  - docs/07-integracoes-whatsapp-chatwoot.md
  - docs/17-lgpd-protecao-dados.md
docs_required: false
docs_audience: [dev]
docs_artifacts: []
---

# F16-S05 — Adapter Meta WhatsApp

## Objetivo

Implementar o `MetaWhatsAppAdapter` (implements `IChannelAdapter`): parsing de webhook inbound,
serialização de outbound (texto, mídia, template HSM, interactive buttons/list), download de mídia,
mark-as-read e typing indicator — portado do tagix.

## Contexto

É o primeiro provider concreto sobre o núcleo de S04. WhatsApp primeiro (Instagram completo é fase
posterior, mas a interface multicanal já permite). Desbloqueia inbound/media/outbound workers.

## Escopo (faz)

- `meta/whatsapp/webhook.parser.ts`: envelope Meta → `InboundEvent[]` (message text/image/video/audio/
  voice/document/sticker/location/contact/interactive/reaction + status sent/delivered/read/failed + flow_submission).
- `meta/whatsapp/serializer.ts`: `OutboundJob` → payload Meta `POST /{phone_number_id}/messages`
  (text, media por id/link, template com componentes, interactive buttons/list).
- `meta/whatsapp/adapter.ts`: `MetaWhatsAppAdapter` usando `graphClient` (S04); `capabilities` (templatesHSM,
  voicePtt, sticker, location = true).
- `meta/whatsapp/errors.ts`: mapa de códigos WA (130472, 131026, 131047, 131051, 132001, …) → retryable/terminal.
- Registrar o adapter em `registry.ts` via export consumido pelo registro de S04 (sem editar registry.ts — usar mecanismo de auto-registro/factory).

## Fora de escopo (NÃO faz)

- Adapter Instagram / WAHA.
- Persistência (S07) ou enfileiramento (workers).
- Conversão/encoding de mídia (S09).

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/integrations/channels/meta/whatsapp/**`
- `apps/api/src/integrations/channels/__tests__/whatsapp-adapter.test.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/integrations/channels/shared/**` (S04 é dono)
- `apps/api/src/integrations/channels/registry.ts` (S04 é dono)
- `apps/api/src/integrations/meta-whatsapp/**` (legado)

## Contratos de saída

- `MetaWhatsAppAdapter` resolvível por `getAdapter('meta_whatsapp')` — consumido por S08/S09/S10.

## Definition of Done

- [ ] Parser cobre todos os tipos de mensagem WA + status callbacks (fixtures reais de envelope)
- [ ] Serializer monta text/media(id+link)/template/interactive corretos
- [ ] Códigos de erro mapeados retryable vs terminal
- [ ] `downloadMedia` + `markAsRead` + `sendTypingIndicator` implementados
- [ ] **LGPD:** parser/serializer não logam corpo; se logar, telefone mascarado, sem CPF (doc 17 §8.3); label `lgpd-impact`
- [ ] `pnpm --filter @elemento/api typecheck` / `lint` / `test` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- whatsapp-adapter
```

## Notas para o agente

- Portar de `packages/channels/src/meta/whatsapp/*` do tagix; adaptar imports ao núcleo S04.
- Janela 24h é regra de **envio** (decidida em S07/S13), não do adapter — o adapter só serializa.
- Usar fixtures de envelope reais (anonimizados) nos testes; nunca PII real.
