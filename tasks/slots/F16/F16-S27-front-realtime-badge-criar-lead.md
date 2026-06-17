---
id: F16-S27
title: Front livechat — badge em tempo real, marcar lida ao abrir e Criar lead com cidade
phase: F16
task_ref: docs/planejamento-live-chat-proprio.md#realtime
status: in-progress
priority: high
estimated_size: M
agent_id: null
claimed_at: 2026-06-17T22:03:30Z
completed_at: null
pr_url: null
depends_on: [F16-S25, F16-S26]
blocks: []
labels: []
source_docs:
  - docs/planejamento-live-chat-proprio.md
  - docs/18-design-system.md
docs_required: true
docs_audience:
  - operador
docs_artifacts:
  - docs/help/guias/livechat/tempo-real-e-leitura.mdx
---

# F16-S27 — Front: tempo real, leitura ao abrir e Criar lead com cidade

## Objetivo

Fechar a experiência de tempo real no inbox e consertar dois incômodos do Rogério:

1. Conversa **marca como lida ao abrir** (badge de não-lidas some) e atualiza ao vivo.
2. Botão **"Criar lead"** funciona mesmo quando o canal não tem cidade (seletor de cidade) e
   trata o 422 com mensagem amigável — sem erro cru no console.

## Contexto

Com F16-S25 (relay vivo) e F16-S26 (emite `conversation:updated` + `PATCH /lead` aceita `cityId`),
o front precisa: assinar/aplicar os eventos, invalidar a lista ao abrir conversa, e evoluir o
"Criar lead" para passar `cityId` quando necessário. O 422 reportado vem justamente do "Criar lead"
em canal sem cidade.

## Escopo (faz)

- **Badge / leitura ao abrir:** ao abrir uma conversa (após `GET /messages` que zera no banco),
  invalidar `conversationKeys.all`/`list` para o badge sumir; e tratar `conversation:updated`
  (`{ conversationId, unreadCount }`) em `useConversationSocket` atualizando o item da lista.
- **Tempo real geral:** confirmar que `message:new` atualiza a conversa aberta e a prévia na lista
  (já parcialmente em F16-S15) — ajustar se a lista não reflete a última mensagem ao vivo.
- **Criar lead com cidade:** em `ContactPanel` (seção de lead, F16-S24), quando o canal/contexto
  não tiver cidade, exibir um seletor de cidade (reusar o componente/endpoint de cidades existente)
  e enviar `cityId` no body do `PATCH /lead`. Tratar resposta de erro (incl. 422) com mensagem
  amigável inline — nunca deixar vazar erro não tratado no console.
- Atualizar `types.ts` (`LinkLeadBody` ganha `cityId?`) espelhando o Zod real de F16-S26.
- Testes de componente/lógica: badge zera ao abrir; `conversation:updated` atualiza item; criar lead
  com cidade selecionada; erro 422 mostra mensagem amigável.

## Fora de escopo (NÃO faz)

- Qualquer mudança de backend (F16-S25/S26 são donos).
- Composer/upload/templates (outros slots).
- Integração de IA (F16-S28/S29).

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/features/conversations/hooks/useConversationSocket.ts`
- `apps/web/src/features/conversations/queries.ts`
- `apps/web/src/features/conversations/types.ts`
- `apps/web/src/features/conversations/components/ContactPanel.tsx`
- `apps/web/src/features/conversations/components/ChatList/ChatListItem.tsx`
- `apps/web/src/features/conversations/__tests__/ContactPanel.test.tsx`
- `apps/web/src/features/conversations/__tests__/realtime.test.ts`
- `docs/help/guias/livechat/tempo-real-e-leitura.mdx`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/**`
- `apps/web/src/features/conversations/components/MessageComposer/**`

## Contratos de entrada

- Socket `/livechat` vivo (F16-S25); eventos `message:new` e `conversation:updated` (F16-S26).
- `PATCH /api/conversations/:id/lead` com `cityId?` no body (F16-S26).
- Endpoint/hook de cidades existente (reusar — não criar).
- Design System (doc 18): tokens, light-first, cores da bandeira, hovers.

## Contratos de saída

- Inbox reflete leitura e novas mensagens em tempo real; "Criar lead" usável em canal sem cidade.

## Definition of Done

- [ ] Badge de não-lidas zera ao abrir conversa (invalidação da lista) e via `conversation:updated`
- [ ] `message:new` atualiza conversa aberta + prévia na lista ao vivo
- [ ] "Criar lead" com seletor de cidade quando necessário; 422 tratado com mensagem amigável
- [ ] `types.ts` espelha o Zod real de F16-S26 (sem inventar casing)
- [ ] `pnpm --filter @elemento/web typecheck` / `lint` / `test` verdes
- [ ] UI com tokens canônicos do DS (doc 18) — sem hex/spacings hardcoded
- [ ] Documentação em `docs/help/guias/livechat/tempo-real-e-leitura.mdx` (operador) + `<FeedbackWidget />`
- [ ] PR aberto com checklist e link para o slot

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test
```

## Notas para o agente

- **Drift de contrato:** leia `conversations/schemas.ts` (LinkLeadBodySchema após F16-S26) antes de tipar.
- Atenção ao teste do WEB: `.mdx` com sintaxe inválida (`{#...}`, `{{...}}`) quebra o acorn parse —
  rode o teste do web antes do push.
- O 422 NÃO deve aparecer no console como erro não tratado: capture no `onError` da mutation e
  renderize a mensagem retornada pela API.

```

```
