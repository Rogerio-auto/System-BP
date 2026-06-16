---
id: F16-S08
title: Worker inbound — consome fila, parseia, persiste e publica socket relay
phase: F16
task_ref: docs/planejamento-live-chat-proprio.md#1-fluxo-de-mensagem-inbound
status: review
priority: high
estimated_size: L
agent_id: null
claimed_at: 2026-06-16T05:20:05Z
completed_at: 2026-06-16T05:35:46Z
pr_url: null
depends_on: [F16-S01, F16-S05, F16-S06, F16-S07]
blocks: []
labels: [lgpd-impact]
source_docs:
  - docs/planejamento-live-chat-proprio.md
  - docs/07-integracoes-whatsapp-chatwoot.md
  - docs/17-lgpd-protecao-dados.md
docs_required: false
docs_audience: [dev]
docs_artifacts: []
---
# F16-S08 — Worker inbound

## Objetivo

Consumir `hm.q.inbound.message`, parsear via adapter do provider, persistir contato/conversa/mensagem
(domínio S07), enfileirar mídia quando houver e publicar `socket.relay` para o front atualizar em tempo real.

## Contexto

É o passo 1–9 do fluxo inbound do planejamento §1. Liga webhook (S06) → persistência (S07) → realtime (S14).

## Escopo (faz)

- `workers/livechat-inbound.ts`: consumer da fila com ack/nack + retry (DLX da topologia S01).
  1. Zod validate do job; 2. resolve adapter (`getAdapter(provider)`); 3. `parseInbound`;
  2. para cada `InboundEvent`: `livechatService.persistInboundMessage`; 5. se `mediaRef` → publish
     `inbound.media`; 6. publish `socket.relay` (`message:new`/`conversation:updated`); 7. se conversa em
     `ai_mode=on` → enfileira processamento do agente (apenas hook/flag — execução é fora desta fase).
- Registrar o worker no `workers/index.ts`.

## Fora de escopo (NÃO faz)

- Download/processamento de mídia (S09).
- Envio (S10) e socket server (S14 — aqui só publica na fila relay).
- Execução do agente IA.

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/workers/livechat-inbound.ts`
- `apps/api/src/workers/index.ts`
- `apps/api/src/workers/__tests__/livechat-inbound.test.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/modules/livechat/**` (S07 é dono)
- `apps/api/src/workers/livechat-media.ts` (S09)
- `apps/api/src/workers/livechat-outbound.ts` (S10)

## Contratos de entrada

- Job `inbound.message` (S06), `getAdapter`/`parseInbound` (S05), `livechatService` (S07), `publish` (S01).

## Definition of Done

- [ ] Consumer com ack em sucesso, nack→retry→DLX em falha
- [ ] Mensagem persistida idempotente (reprocesso não duplica)
- [ ] Mídia detectada enfileira `inbound.media`
- [ ] Publica `socket.relay` com payload correto
- [ ] **LGPD:** logs só com ids + flags (sem conteúdo); label `lgpd-impact`; checklist §14.2
- [ ] `pnpm --filter @elemento/api typecheck` / `lint` / `test` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- livechat-inbound
```

## Notas para o agente

- Reaproveitar a sequência do worker inbound do tagix (parse→dedup→ensure→persist→media→relay).
- Dedup já garantido em 2 camadas: webhook_events (S06) + unique `(channel_id, external_id)` (S07).
- Não baixar mídia aqui (latência do ack) — só enfileirar.
