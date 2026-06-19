---
id: F16-S51
title: sendMessage emite message:new (outbound) — mensagens do agente aparecem ao vivo no live chat
phase: F16
task_ref: docs/planejamento-fluxo-conversacional-pre-atendimento.md
status: done
priority: high
estimated_size: S
agent_id: null
claimed_at: 2026-06-19T15:37:15Z
completed_at: 2026-06-19T15:41:44Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/341
depends_on: []
blocks: []
labels: []
source_docs:
  - docs/06-langgraph-agentes.md
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F16-S51 — Realtime das mensagens outbound (agente) no live chat

## Problema

As mensagens enviadas pelo agente (worker `livechat-ai.ts` → `sendMessage` por mensagem do
`messages[]`) NÃO aparecem ao vivo no live chat. Causa: `sendMessage`
(`apps/api/src/modules/conversations/send.service.ts`, ~§7) publica só `conversation:updated`
no socket relay — **não** `message:new`. O inbound (`livechat-inbound.ts`) publica `message:new`,
e o front (`useConversationSocket.handleMessageNew`) faz refetch das mensagens da conversa aberta
nesse evento (independente de `direction`). Sem `message:new` no outbound, o balão do agente só
aparece ao reabrir/refazer fetch.

## Escopo (faz)

- Em `sendMessage` (send.service.ts): após persistir a mensagem, publicar também um evento
  **`message:new`** no `QUEUES.socketRelay`, espelhando o payload do inbound
  (`livechat-inbound.ts` ~L277-291), com `direction: 'outbound'` e SEM content (LGPD — só IDs,
  messageType, createdAt, hasMedia=false). Manter o `conversation:updated` existente.
  Sala = `workspace:{organizationId}`.
- Garantir que multi-mensagem (N chamadas a sendMessage) → N eventos message:new, cada um na ordem.
- Teste no `send.service` (ou worker) confirmando que `message:new` é publicado com `direction:'outbound'`
  e os IDs corretos.

## Fora de escopo

- Frontend (já trata `message:new` — refetch da conversa aberta; sem mudança necessária).
- Debounce de múltiplos refetches (otimização futura; correto sem isso).
- LangGraph.

## Arquivos permitidos

- `apps/api/src/modules/conversations/send.service.ts`
- `apps/api/src/modules/conversations/__tests__/**`
- `apps/api/src/workers/__tests__/livechat-ai.test.ts`

## Arquivos proibidos

- `apps/web/**`
- `apps/langgraph-service/**`

## Definition of Done

- [ ] `sendMessage` publica `message:new` (direction outbound, sem content) além de conversation:updated
- [ ] Payload espelha o do inbound (messageId, conversationId, channelId, organizationId, messageType, direction, hasMedia, createdAt)
- [ ] Teste cobrindo a publicação do message:new
- [ ] `pnpm --filter @elemento/api typecheck/lint/test` verdes
- [ ] PR aberto

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api test
```
