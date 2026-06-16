---
id: F16-S03
title: Contratos compartilhados do live chat — discriminated unions + Zod + socket events
phase: F16
task_ref: docs/planejamento-live-chat-proprio.md#3-mapa-de-reuso-3-baldes
status: done
priority: critical
estimated_size: M
agent_id: null
claimed_at: null
completed_at: 2026-06-16T04:49:01Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/253
depends_on: []
blocks: [F16-S04, F16-S06, F16-S07, F16-S12, F16-S15]
labels: []
source_docs:
  - docs/planejamento-live-chat-proprio.md
  - docs/04-eventos.md
docs_required: false
docs_audience: [dev]
docs_artifacts: []
---

# F16-S03 — Contratos compartilhados do live chat

## Objetivo

Definir, num único lugar tipado e validado por Zod, os contratos que API, workers e web compartilham:
`ChannelProvider`, taxonomia de mensagem, `InboundEvent`, `OutboundJob`, `InteractivePayload` e os
eventos de socket. Evita drift de contrato front×API (problema conhecido do projeto).

## Contexto

O tagix concentra esses tipos em `packages/channels/src/types.ts` + `packages/shared`. Aqui seguimos a
convenção do projeto: Zod em `@elemento/shared-schemas`, tipos puros/eventos em `@elemento/shared-types`.
Fixar o contrato **antes** de S04/S06/S07 permite paralelismo seguro e front lendo o schema real.

## Escopo (faz)

- `packages/shared-schemas/src/livechat.ts`: `ChannelProviderSchema`, `MessageTypeSchema`,
  `InteractivePayloadSchema` (discriminatedUnion buttons/list/template), `InboundEventSchema`
  (discriminatedUnion message/status/story*\*/comment/reaction/postback/referral), `OutboundJobSchema`
  (discriminatedUnion text/media/template/interactive/ig*\*/typing_indicator), `SendResultSchema`.
- `packages/shared-types/src/livechat.ts`: tipos inferidos + `Channel`/`Conversation`/`Message` DTO
  público (espelho das colunas seguras, **sem** segredos).
- `packages/shared-types/src/socketEvents.ts`: `ServerToClient` (message:new, message:status_changed,
  message:media_ready, conversation:updated, conversation:assigned, typing:from_contact, …) + rooms.
- Re-export em `packages/shared-schemas/src/index.ts` e `packages/shared-types/src/index.ts`.

## Fora de escopo (NÃO faz)

- Implementação de adapters (S04/S05) ou persistência (S07).
- Componentes de UI.

## Arquivos permitidos (`files_allowed`)

- `packages/shared-schemas/src/livechat.ts`
- `packages/shared-schemas/src/index.ts`
- `packages/shared-types/src/livechat.ts`
- `packages/shared-types/src/socketEvents.ts`
- `packages/shared-types/src/index.ts`
- `packages/shared-schemas/src/__tests__/livechat.test.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/**`
- `apps/web/**`

## Contratos de saída

- Schemas Zod + tipos exportados de `@elemento/shared-schemas` e `@elemento/shared-types`,
  importáveis por API, workers e web.

## Definition of Done

- [ ] `InboundEvent`, `OutboundJob`, `InteractivePayload` como discriminated unions com Zod parse
- [ ] DTOs públicos sem campos de segredo
- [ ] Contratos de socket tipados
- [ ] Testes de parse (válido + inválido) para cada union
- [ ] `pnpm typecheck` / `pnpm lint` verdes (raiz, cross-package)

## Comandos de validação

```powershell
pnpm typecheck
pnpm lint
pnpm --filter @elemento/shared-schemas test
```

## Notas para o agente

- Sem `any`/`as`. Use `z.infer` para derivar os tipos.
- Manter os nomes de evento idênticos aos do tagix (`message:new`, etc.) facilita portar relay + front.
- `Message.content` é PII — o DTO existe, mas quem loga é responsável pelo redact (não é problema deste slot).
