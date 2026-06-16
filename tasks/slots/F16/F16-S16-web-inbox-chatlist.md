---
id: F16-S16
title: Web — Inbox: layout 3 colunas + ChatList (filtros, busca, scroll infinito, realtime)
phase: F16
task_ref: docs/planejamento-live-chat-proprio.md#7-ui-conversationspage
status: in-progress
priority: high
estimated_size: L
agent_id: null
claimed_at: 2026-06-16T13:37:17Z
completed_at: null
pr_url: null
depends_on: [F16-S15]
blocks: []
labels: []
source_docs:
  - docs/planejamento-live-chat-proprio.md
  - docs/18-design-system.md
docs_required: true
docs_audience: [operador]
docs_artifacts:
  - docs/help/guias/livechat/caixa-de-entrada.mdx
---

# F16-S16 — Inbox: layout + ChatList

## Objetivo

Entregar a caixa de entrada: o layout de 3 colunas (lista | conversa | contato) e a `ChatList` com
filtros, busca debounced, ordenação por última mensagem, scroll infinito e atualização em tempo real —
re-skin completo no Design System oficial (doc 18).

## Contexto

É a metade "lista" da vitrine somente-leitura (decisão D4). Consome a camada de dados/realtime de S15.
O painel da conversa (mensagens) é S17.

## Escopo (faz)

- `components/ConversationsLayout.tsx`: shell de 3 colunas responsivo (light-first, tokens do DS).
- `components/ChatList/ChatList.tsx` + `ChatListItem.tsx` + `ChatListFilters.tsx`: filtros
  (status/assigned/channel/tag), busca debounce 300ms, sort `last_message_at desc`, scroll infinito,
  realtime (`conversation:updated`/`message:new` faz bump), badge de `unread_count`.
- Página `pages` que monta o layout na rota `/conversas` (registrada em S15).
- Doc `docs/help/guias/livechat/caixa-de-entrada.mdx`.

## Fora de escopo (NÃO faz)

- MessageBubble / Composer / envio (S17).
- ContactInfoPanel detalhado (placeholder ok; painel completo é slot futuro).

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/features/conversations/components/ConversationsLayout.tsx`
- `apps/web/src/features/conversations/components/ChatList/**`
- `apps/web/src/pages/ConversasPage.tsx`
- `docs/help/guias/livechat/caixa-de-entrada.mdx`

## Arquivos proibidos (`files_forbidden`)

- `apps/web/src/features/conversations/components/MessageBubble/**` (S17)
- `apps/web/src/features/conversations/components/MessageComposer/**` (S17)
- `apps/web/src/App.tsx` (S15 é dono)

## Definition of Done

- [ ] Layout 3 colunas no DS oficial (light-first, tokens, profundidade — não template genérico)
- [ ] ChatList com filtros + busca debounced + sort + scroll infinito
- [ ] Realtime: conversa sobe/atualiza sem refetch manual
- [ ] `unread_count` visível; estado vazio e loading tratados
- [ ] Acessibilidade básica (teclado, foco) + responsivo
- [ ] Doc `caixa-de-entrada.mdx` (com `<FeedbackWidget />`); screenshots sem PII real
- [ ] `pnpm --filter @elemento/web typecheck` / `lint` / `test` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test -- ChatList
```

## Notas para o agente

- DS é lei (doc 18 + `docs/design-system/index.html`): Bricolage/Geist/Mono, cores da bandeira, hovers e profundidade.
- Reaproveitar a **estrutura/lógica** do ChatList do tagix, mas **não** o estilo — re-skin total.
