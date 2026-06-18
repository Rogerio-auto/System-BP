---
id: F16-S44
title: Worker livechat-ai itera messages[] do agente (envio multi-mensagem ao WhatsApp)
phase: F16
task_ref: docs/planejamento-fluxo-conversacional-pre-atendimento.md
status: in-progress
priority: critical
estimated_size: S
agent_id: null
claimed_at: 2026-06-18T20:26:44Z
completed_at: null
pr_url: null
depends_on: [F16-S41]
blocks: []
labels: []
source_docs:
  - docs/06-langgraph-agentes.md
  - docs/planejamento-fluxo-conversacional-pre-atendimento.md
docs_required: false
docs_audience: []
docs_artifacts: []
---
# F16-S44 — Worker consome `messages[]` (sibling backend do B3)

## Objetivo

Fechar o seam cross-service do F16-S41: o serviço LangGraph agora retorna `messages: string[]`
(array de mensagens curtas estilo Ana Clara), mas o worker `livechat-ai.ts` ainda envia apenas
`reply.content` como uma única mensagem. Este slot faz o worker **iterar `messages[]`** e enviar cada
uma separadamente ao WhatsApp (simulando digitação natural), mantendo retrocompat quando `messages`
vem vazio (funil antigo / flag OFF).

## Contexto

- F16-S41 (mergeado) adicionou `messages: list[str]` ao `WhatsAppMessageResponse` do Python e manteve
  `reply.content = messages[0]` para retrocompat.
- O contrato Node ainda não conhece o campo: `apps/api/src/integrations/langgraph/schemas.ts`
  (`LangGraphWhatsAppResponseSchema`) só valida `reply`. Precisa ganhar `messages`.
- O worker `apps/api/src/workers/livechat-ai.ts` (linhas ~216-233) hoje faz: se `reply.type !== 'none'`
  e `reply.content` não-vazio → `sendMessage(..., {type:'text', content: reply.content}, idempKey)`.
  Precisa: se `messages` não-vazio → enviar **cada** item como mensagem separada; senão, fallback ao
  comportamento atual (`reply.content`).

## Escopo (faz)

- `integrations/langgraph/schemas.ts`: adicionar `messages: z.array(z.string()).default([])` ao
  `LangGraphWhatsAppResponseSchema` (top-level, espelhando o Python). Validação Zod na borda.
- `workers/livechat-ai.ts`: quando `aiResponse.messages.length > 0`, iterar e enviar cada mensagem via
  `sendMessage` com idempotency key **única por índice** (ex.: `ai_reply_<messageId>_<i>`) para não
  colidir/dedupe entre as N mensagens. Preservar ordem. Manter o fallback `reply.content` quando
  `messages` vazio (funil antigo). Não logar conteúdo (LGPD — só IDs/contadores).
- Atualizar `workers/__tests__/livechat-ai.test.ts`: cenário multi-mensagem (envia N), cenário legado
  (messages vazio → 1 msg via reply.content), ordem preservada, idempotency keys distintas.

## Fora de escopo (NÃO faz)

- Serviço LangGraph / Python (já entregue em F16-S41).
- Ligar a flag agêntica (é decisão de go-live, outro passo).
- Qualquer mudança de comportamento quando `messages` vem vazio.

## Arquivos permitidos

- `apps/api/src/integrations/langgraph/schemas.ts`
- `apps/api/src/workers/livechat-ai.ts`
- `apps/api/src/workers/__tests__/livechat-ai.test.ts`

## Arquivos proibidos

- `apps/langgraph-service/**`
- `apps/api/src/modules/conversations/send.service.js` (reusar `sendMessage` como está)

## Contratos

- `LangGraphWhatsAppResponseSchema.messages`: `string[]`, default `[]`. Cada item é uma mensagem de
  texto a enviar na ordem. `reply` permanece para retrocompat.

## Definition of Done

- [ ] `messages` validado no schema Node (Zod), default `[]`
- [ ] Worker envia cada item de `messages[]` como mensagem separada, na ordem, com idempotency key única
- [ ] Fallback `reply.content` intacto quando `messages` vazio (funil/flag OFF)
- [ ] Sem conteúdo de mensagem em log (LGPD)
- [ ] Testes cobrindo multi-mensagem, legado e idempotência
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm test` (filtro api) verdes
- [ ] PR aberto com link para o slot

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
```

## Notas para o agente

- A idempotência por índice é importante: `sendMessage` dedupe por idempotency key — N mensagens com a
  MESMA key enviariam só 1. Use sufixo de índice estável.
- Não introduza atraso/typing artificial entre mensagens neste slot (pode ser polimento futuro).
