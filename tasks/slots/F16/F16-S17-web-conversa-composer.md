---
id: F16-S17
title: Web — Conversa: MessageBubble (todos os tipos) + Composer + envio + janela 24h
phase: F16
task_ref: docs/planejamento-live-chat-proprio.md#7-ui-conversationspage
status: available
priority: high
estimated_size: L
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F16-S15, F16-S13]
blocks: []
labels: []
source_docs:
  - docs/planejamento-live-chat-proprio.md
  - docs/18-design-system.md
  - docs/07-integracoes-whatsapp-chatwoot.md
docs_required: true
docs_audience: [operador]
docs_artifacts:
  - docs/help/guias/livechat/responder-conversa.mdx
---

# F16-S17 — Conversa: MessageBubble + Composer

## Objetivo

Entregar o painel da conversa: a lista de mensagens virtualizada com `MessageBubble` para todos os tipos,
o `MessageComposer` (texto/mídia/emoji, Cmd+Enter) com bloqueio/aviso de janela 24h, e o envio via API
(S13) com atualização otimista e status (sent/delivered/read) em tempo real.

## Contexto

Fecha a experiência de mensagem: completa a vitrine (read) e habilita o **envio** humano. Re-skin no DS.

## Escopo (faz)

- `components/MessageBubble/**`: render polimórfico por `type` (text, image/video/audio/voice, document,
  sticker, location, contact, interactive buttons/list, template, reaction, system, story\_\* e comment como
  read-only) + `StatusIcon` (sent/delivered/read/failed).
- `components/MessageComposer/**`: textarea + emoji + attach (signed-url S13) + send (Cmd+Enter),
  `WindowNotice` + `useWindowState` (bloqueia texto livre fora da janela → CTA template), upload otimista.
- Lista virtualizada (react-window) para históricos longos.
- Doc `docs/help/guias/livechat/responder-conversa.mdx`.

## Fora de escopo (NÃO faz)

- ChatList / layout (S16).
- Notas internas / routing / contact panel (slots futuros).

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/features/conversations/components/MessageBubble/**`
- `apps/web/src/features/conversations/components/MessageComposer/**`
- `apps/web/src/features/conversations/components/ConversationPanel.tsx`
- `docs/help/guias/livechat/responder-conversa.mdx`

## Arquivos proibidos (`files_forbidden`)

- `apps/web/src/features/conversations/components/ChatList/**` (S16)
- `apps/web/src/features/conversations/components/ConversationsLayout.tsx` (S16)
- `apps/web/src/features/conversations/queries.ts` (S15)

## Definition of Done

- [ ] MessageBubble cobre todos os tipos da taxonomia (com fallback gracioso)
- [ ] Composer envia texto/mídia; Cmd+Enter; upload via signed-url (S13)
- [ ] Janela 24h: fora dela, texto livre bloqueado com aviso + CTA template
- [ ] Status da mensagem (sent/delivered/read/failed) em tempo real
- [ ] Lista virtualizada performa em histórico longo; envio otimista com rollback em erro
- [ ] DS oficial (light-first, tokens, profundidade) — não template genérico
- [ ] Doc `responder-conversa.mdx` (com `<FeedbackWidget />`); screenshots sem PII real
- [ ] `pnpm --filter @elemento/web typecheck` / `lint` / `test` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test -- MessageBubble MessageComposer
```

## Notas para o agente

- DS é lei (doc 18). Reaproveitar estrutura/lógica do tagix (MessageBubble/Composer/WindowNotice), re-skin total.
- Envio é **humano** (atendente) — respeitar idempotência (gerar `Idempotency-Key` por tentativa) e janela.
