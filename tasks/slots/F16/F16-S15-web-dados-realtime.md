---
id: F16-S15
title: Web — camada de dados + realtime (queries, types, SocketProvider, rota)
phase: F16
task_ref: docs/planejamento-live-chat-proprio.md#7-ui-conversationspage
status: review
priority: high
estimated_size: M
agent_id: null
claimed_at: 2026-06-16T13:07:35Z
completed_at: 2026-06-16T13:25:03Z
pr_url: null
depends_on: [F16-S03, F16-S12, F16-S14]
blocks: [F16-S16, F16-S17]
labels: []
source_docs:
  - docs/planejamento-live-chat-proprio.md
  - docs/18-design-system.md
docs_required: false
docs_audience: [dev]
docs_artifacts: []
---

# F16-S15 — Web: camada de dados + realtime

## Objetivo

Estabelecer no front a fundação do inbox: provider Socket.io, hooks de realtime, queries TanStack
(conversas/mensagens) lendo os schemas reais da API (S12/S03) e a rota da página de conversas no `App.tsx`.

## Contexto

`App.tsx` é o roteador vivo do projeto (rota nova entra aqui). Esta camada é consumida por ChatList (S16)
e Conversa (S17), permitindo que ambos rodem em paralelo depois.

## Escopo (faz)

- `apps/web/src/lib/realtime/SocketProvider.tsx` + `useSocket.ts`: conexão autenticada, reconexão,
  join/leave de salas.
- `apps/web/src/features/conversations/queries.ts` + `types.ts`: hooks `useConversations`,
  `useConversation`, `useMessages` (infinite), invalidação por eventos de socket. Tipos espelham `@elemento/shared-types`.
- `apps/web/src/features/conversations/hooks/useConversationSocket.ts`: aplica `message:new`/`updated`/
  `media_ready`/`status_changed` ao cache do TanStack.
- `apps/web/src/App.tsx`: registrar rota `/conversas` (placeholder de página montando o layout em S16).

## Fora de escopo (NÃO faz)

- Componentes visuais ChatList/MessageBubble/Composer (S16/S17).
- Envio (S17).

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/lib/realtime/**`
- `apps/web/src/features/conversations/queries.ts`
- `apps/web/src/features/conversations/types.ts`
- `apps/web/src/features/conversations/hooks/useConversationSocket.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/features/conversations/__tests__/queries.test.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/web/src/features/conversations/components/**` (S16/S17 donos)

## Contratos de saída

- `SocketProvider`, hooks de query/realtime, rota `/conversas` — consumidos por S16/S17.

## Definition of Done

- [ ] Socket conecta autenticado e reconecta
- [ ] Hooks de query tipados a partir de `@elemento/shared-types` (sem drift)
- [ ] Eventos de socket atualizam o cache (mensagem nova aparece sem refetch)
- [ ] Rota `/conversas` registrada no `App.tsx`
- [ ] `pnpm --filter @elemento/web typecheck` / `lint` / `test` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test -- conversations
```

## Notas para o agente

- Ler o schema Zod real da API (S12) — não inventar shape (evitar o drift de contrato conhecido do projeto).
- Link de navegação para `/conversas` segue o padrão do projeto (cards/menu) — não duplicar roteador.
