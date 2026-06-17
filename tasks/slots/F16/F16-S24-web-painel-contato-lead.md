---
id: F16-S24
title: Painel de contato — vínculo de lead e ação criar lead
phase: F16
task_ref: docs/planejamento-live-chat-proprio.md#1-fluxo-de-mensagem-inbound
status: in-progress
priority: high
estimated_size: S
agent_id: frontend-engineer
claimed_at: 2026-06-17T19:27:34Z
completed_at: null
pr_url: null
depends_on: [F16-S23]
blocks: []
labels: []
source_docs:
  - docs/planejamento-live-chat-proprio.md
  - docs/05-modulos-funcionais.md
  - docs/18-design-system.md
docs_required: true
docs_audience:
  - operador
docs_artifacts:
  - docs/help/guias/livechat/criar-lead-do-contato.mdx
---

# F16-S24 — Painel de contato: vínculo de lead e ação criar lead

## Objetivo

No painel de contato da conversa, mostrar o lead vinculado (com link para o CRM) quando existe,
e oferecer um botão "Criar lead" / "Vincular lead" de 1 clique quando a conversa ainda não tem
lead — consumindo o endpoint de F16-S23.

## Contexto

Com o dedupe automático (F16-S22) e o endpoint manual (F16-S23), falta a superfície de UX: o
agente precisa ver, no `ContactPanel`, se aquele contato já é um lead do CRM e agir quando não for.

## Escopo (faz)

- `ContactPanel.tsx`:
  - Quando `conversation.leadId` presente → seção "Lead no CRM" com link para a página do lead.
  - Quando ausente → botão primário "Criar lead" (e, se houver UX de busca, "Vincular existente").
  - Estados de loading/erro/sucesso seguindo o Design System (doc 18 — tokens, profundidade, hovers).
- Mutation em `queries.ts` chamando `PATCH /api/conversations/:id/lead` (TanStack Query) +
  invalidação/atualização otimista da conversa.
- Tipos em `types.ts` para request/response do endpoint (espelhar o Zod real de F16-S23 — não inventar casing).
- Refletir `conversation:updated` (socket) atualizando o painel sem refresh.
- Testes de componente: render com lead, render sem lead, clique dispara mutation, estado pós-sucesso.

## Fora de escopo (NÃO faz)

- Qualquer mudança de backend (F16-S22 / F16-S23 são donos).
- Edição completa de lead dentro do chat (fora — usa link para o CRM).
- Mudança no ChatList ou composer.

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/features/conversations/components/ContactPanel.tsx`
- `apps/web/src/features/conversations/queries.ts`
- `apps/web/src/features/conversations/types.ts`
- `apps/web/src/features/conversations/__tests__/ContactPanel.test.tsx`
- `docs/help/guias/livechat/criar-lead-do-contato.mdx`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/**` (backend é dono nos slots anteriores)
- `apps/web/src/features/conversations/components/ChatList/**`
- `apps/web/src/features/conversations/components/MessageComposer/**`

## Contratos de entrada

- `PATCH /api/conversations/:id/lead` (F16-S23) com schema Zod estável.
- `conversation.leadId` disponível no objeto de conversa já servido pela API de leitura (F16-S12).
- Tokens e componentes do Design System (doc 18 + `docs/design-system/index.html`).

## Contratos de saída

- Painel de contato exibe estado de vínculo de lead e permite criar/vincular.

## Definition of Done

- [ ] Código implementado conforme escopo
- [ ] `pnpm --filter @elemento/web typecheck` verde
- [ ] `pnpm --filter @elemento/web lint` verde
- [ ] `pnpm --filter @elemento/web test` verde (incluindo testes de componente novos)
- [ ] UI usa tokens canônicos do Design System (doc 18) — sem cores/spacings hardcoded
- [ ] Estados loading/erro/sucesso tratados
- [ ] Atualização em tempo real via socket `conversation:updated`
- [ ] Documentação criada em `docs/help/guias/livechat/criar-lead-do-contato.mdx` (audiência operador)
- [ ] `<FeedbackWidget />` no rodapé da página de ajuda (via DocLayout)
- [ ] PR aberto com checklist e link para o slot

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test
```

## Notas para o agente

- **Drift de contrato:** leia o Zod real de F16-S23 (`modules/conversations/schemas.ts`) antes de
  tipar — casing/envelope da API vencem. Não assuma snake/camel.
- Light-first com dark toggle; Bricolage/Geist/Mono; cores da bandeira de Rondônia (doc 18).
- O link para o CRM deve ir para a rota real de detalhe de lead do web (confirmar em `App.tsx`,
  que é o roteador vivo — `app/router.tsx` é órfão).

```

```
