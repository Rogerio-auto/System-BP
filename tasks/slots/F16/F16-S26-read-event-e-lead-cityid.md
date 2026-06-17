---
id: F16-S26
title: Conversations backend — read emite conversation:updated + PATCH /lead aceita cityId
phase: F16
task_ref: docs/planejamento-live-chat-proprio.md#realtime
status: review
priority: high
estimated_size: S
agent_id: null
claimed_at: 2026-06-17T21:13:08Z
completed_at: 2026-06-17T21:26:16Z
pr_url: null
depends_on: [F16-S25]
blocks: [F16-S27]
labels: [lgpd-impact]
source_docs:
  - docs/planejamento-live-chat-proprio.md
  - docs/04-eventos.md
  - docs/17-lgpd-protecao-dados.md
docs_required: false
docs_audience:
  - dev
docs_artifacts: []
---
# F16-S26 — Read em tempo real + cityId opcional no vínculo de lead

## Objetivo

Duas correções no backend do módulo conversations:

1. **Marcar como lida em tempo real:** ao zerar `unread_count`, emitir `conversation:updated` no
   socket relay para o badge de não-lidas sumir sem refresh (e em todos os atendentes).
2. **Destravar "Criar lead" sem cidade no canal:** `PATCH /api/conversations/:id/lead` passa a
   aceitar `cityId` opcional no body, usado quando o canal não tem cidade — resolve o 422
   (`MissingChannelCityError`) que o botão "Criar lead" dispara em canais sem cidade.

## Contexto

Diagnóstico (2026-06-17):

- `markConversationRead` (conversations/service.ts) zera `unread_count` no banco ao acessar
  `GET /messages`, mas **não emite evento** — sem F16-S25 nada chegava ao front; agora que o relay
  sobe (S25), basta emitir `conversation:updated` para o badge atualizar ao vivo.
- O endpoint `PATCH /lead` (F16-S23) lança 422 quando `body.leadId` é omitido e o canal não tem
  `cityId` (`leads.city_id` é NOT NULL — tech debt F3-S04). No ambiente de teste do Rogério os
  canais não têm cidade → botão "Criar lead" quebra. Aceitar `cityId` no body permite o front
  oferecer um seletor de cidade (F16-S27).

## Escopo (faz)

- `markConversationRead`: após zerar `unread_count`, publicar `conversation:updated` na fila
  `hm.q.socket.relay` com `{ room: workspace:{orgId}, event: 'conversation:updated',
data: { conversationId, unreadCount: 0 } }`. LGPD: apenas IDs opacos — sem content/PII.
- `LinkLeadBodySchema` (conversations/schemas.ts): adicionar campo opcional `cityId: z.string().uuid().optional()`.
- `linkOrCreateConversationLead` (conversations/service.ts): no caminho de criação, usar
  `body.cityId ?? channel.cityId`; só lançar 422 (`MissingChannelCityError`) se **ambos** ausentes.
  Passar o cityId resolvido ao `getOrCreateLead`.
- Testes: emit de `conversation:updated` no read; criação com `body.cityId` quando canal sem cidade;
  422 só quando canal e body sem cidade; idempotência preservada.

## Fora de escopo (NÃO faz)

- Tornar `leads.city_id` nullable (decisão de domínio maior — fora; cidade é first-class no BDP).
- Front (seletor de cidade, badge, tratamento de erro) — F16-S27.
- Endpoint dedicado de read (mantém o side-effect em `GET /messages`; só adiciona o emit).

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/modules/conversations/service.ts`
- `apps/api/src/modules/conversations/schemas.ts`
- `apps/api/src/modules/conversations/__tests__/lead-link.test.ts`
- `apps/api/src/modules/conversations/__tests__/read-event.test.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/modules/conversations/routes.ts` (rota já existe; body schema muda em schemas.ts)
- `apps/api/src/modules/livechat/**` (outro módulo)
- `apps/api/src/modules/leads/**` (consumir `getOrCreateLead` read-only)
- `apps/web/**`

## Contratos de entrada

- Fila `hm.q.socket.relay` + helpers `makeEnvelope`/`publish`/`QUEUES` (lib/queue) — relay vivo via F16-S25.
- `getOrCreateLead` (módulo leads), `linkConversationLead` (livechat/repo, F16-S22).
- `LinkLeadBodySchema` / `LinkLeadResponseSchema` (F16-S23) em conversations/schemas.ts.

## Contratos de saída

- `conversation:updated { conversationId, unreadCount: 0 }` emitido ao marcar lida.
- `PATCH /lead` aceita `cityId` opcional; cria lead usando a cidade do body quando o canal não tem.

## Definition of Done

- [ ] Emit de `conversation:updated` no read testado (room workspace:{orgId}, sem PII)
- [ ] `cityId` opcional no body + resolução `body.cityId ?? channel.cityId` testada
- [ ] 422 só quando canal e body sem cidade
- [ ] `pnpm --filter @elemento/api typecheck` / `lint` / `test` verdes
- [ ] Checklist LGPD §14.2 (doc 17) no PR + label `lgpd-impact` (payloads sem PII bruta)
- [ ] PR aberto com checklist e link para o slot

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
```

## Notas para o agente

- O emit de read segue o mesmo padrão LGPD do `livechat-inbound.ts` (IDs opacos no relay).
- `markConversationRead` é fire-and-forget hoje; manter assim, apenas adicionar o publish dentro do
  fluxo (a falha de publish não pode quebrar o `GET /messages`).
- Não emita `conversation:updated` para o room `conversation:{id}` aqui — o badge de não-lidas vive
  na LISTA (inbox), cujo room é `workspace:{orgId}`.

```

```
