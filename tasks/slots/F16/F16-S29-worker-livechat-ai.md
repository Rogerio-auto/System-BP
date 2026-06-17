---
id: F16-S29
title: Worker livechat-ai — LangGraph responde no livechat via send service
phase: F16
task_ref: docs/06-langgraph-agentes.md
status: review
priority: high
estimated_size: L
agent_id: null
claimed_at: 2026-06-17T21:13:53Z
completed_at: 2026-06-17T21:51:48Z
pr_url: null
depends_on: [F16-S28]
blocks: []
labels: [lgpd-impact]
source_docs:
  - docs/06-langgraph-agentes.md
  - docs/07-integracoes-whatsapp-chatwoot.md
  - docs/planejamento-live-chat-proprio.md
  - docs/17-lgpd-protecao-dados.md
docs_required: false
docs_audience:
  - dev
docs_artifacts: []
---

# F16-S29 — Worker livechat-ai (LangGraph → resposta no livechat)

## Objetivo

Consumir `hm.q.livechat.ai` (F16-S28), executar o agente LangGraph com a mensagem inbound do
livechat e **enviar a resposta pelo próprio canal do livechat** (via `sendMessage` do módulo
conversations) — não via Chatwoot. Fecha a integração LangGraph↔livechat.

## Contexto

O handler antigo (`whatsapp/handlers/process-with-ai.ts`) chama o `LangGraphClient` e responde via
`ChatwootClient`. Aqui reusamos o `LangGraphClient` (mesmo contrato `processWhatsAppMessage`) mas a
resposta sai pelo caminho do livechat novo: `conversations/send.service.ts#sendMessage` (persiste
outbound + publica socket relay + envia pelo adapter do canal). Estado do grafo continua em
`ai_conversation_states` (chaveado por telefone normalizado), como no fluxo antigo.

## Escopo (faz)

- Novo worker `workers/livechat-ai.ts`:
  1. Consome `hm.q.livechat.ai` (prefetch 1, ack/nack→DLX).
  2. Valida o job (Zod). Carrega a conversa + a mensagem (`messages`) + o canal.
  3. `getOrCreate` em `ai_conversation_states` por telefone normalizado (reusar/espelhar o helper
     do handler antigo; extrair para util compartilhado se necessário — sem duplicar lógica).
  4. Monta `LangGraphWhatsAppRequest` (texto da mensagem, phone E.164, conversation_id do estado,
     lead_id da conversa se houver, city do canal, correlation/idempotency keys).
  5. Chama `LangGraphClient.processWhatsAppMessage` (timeout do client).
  6. Se `reply.type != 'none'` e conteúdo não-vazio → `sendMessage(...)` como **ator de sistema/bot**
     na conversa do livechat (persiste outbound + relay + envia pelo canal).
  7. Atualiza `ai_conversation_states` (lead_id, current_node, graph_version, last_message_at).
  8. Em falha do LangGraph: fallback/handoff (criar/sinalizar handoff para humano; reusar a ideia do
     `triggerAiFallback` antigo, adaptado ao livechat — sem depender de Chatwoot). Não responder lixo.
- Registrar o worker em `workers/index.ts` (se aplicável) e no script `dev` do `apps/api/package.json`
  (`worker:livechat-ai`).
- Idempotência: dedupe por `messageId` (não responder duas vezes ao mesmo inbound).
- Testes: reply enviada via sendMessage; reply 'none' não envia; falha LangGraph→handoff sem crash;
  idempotência (segundo job do mesmo messageId é no-op); allowlist já garantida no S28 (não re-testar aqui).

## Fora de escopo (NÃO faz)

- O gate/flag/allowlist e a fila (F16-S28).
- Mudar o pipeline antigo (`whatsapp/handlers/**`) ou o Chatwoot.
- UI de console de IA (ai-console já existe; não tocar).

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/workers/livechat-ai.ts`
- `apps/api/src/workers/index.ts`
- `apps/api/package.json`
- `apps/api/src/modules/livechat/ai-conversation-state.ts`
- `apps/api/src/workers/__tests__/livechat-ai.test.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/modules/conversations/send.service.ts` (consumir `sendMessage`, não editar)
- `apps/api/src/integrations/langgraph/**` (client existente — reusar, não editar)
- `apps/api/src/modules/whatsapp/**` (pipeline antigo)
- `apps/api/src/lib/queue/topology.ts` (fila já declarada em F16-S28)
- `apps/web/**`

## Contratos de entrada

- Fila `hm.q.livechat.ai` + job `{ organizationId, channelId, conversationId, messageId, contactRemoteId }` (F16-S28).
- `LangGraphClient` (`integrations/langgraph/client.ts`) + `LangGraphWhatsAppRequest` schema.
- `sendMessage` (`conversations/send.service.ts`) — caminho de envio do livechat.
- `ai_conversation_states` (schema existente).

## Contratos de saída

- IA responde no livechat (mensagem outbound persistida + entregue + relay em tempo real).
- Estado do grafo persistido em `ai_conversation_states`.

## Definition of Done

- [ ] Worker consome a fila e responde via `sendMessage` (não Chatwoot)
- [ ] reply 'none' não envia; falha LangGraph → handoff sem crash
- [ ] Idempotência por `messageId` testada
- [ ] `ai_conversation_states` atualizado
- [ ] Worker registrado no script `dev` (`worker:livechat-ai`)
- [ ] `pnpm --filter @elemento/api typecheck` / `lint` / `test` verdes
- [ ] LGPD: sem content/telefone em logs; DLP é responsabilidade do grafo; outbox/relay sem PII bruta
- [ ] Checklist LGPD §14.2 (doc 17) no PR + label `lgpd-impact`
- [ ] PR aberto com checklist e link para o slot

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
```

## Notas para o agente

- **Ator de sistema:** `sendMessage` espera um actor. A IA é um remetente de sistema/bot — verifique
  a assinatura de `sendMessage` e use um actor de sistema apropriado (ou estenda minimamente o contrato
  de remetente se necessário, documentando no PR). Não burle RBAC humano; é um envio de sistema.
- **Reuso do estado:** o handler antigo tem `getOrCreateConversationState(db, phone, orgId)` — extraia
  para `modules/livechat/ai-conversation-state.ts` se for reusar, evitando duplicação (sem alterar o
  comportamento do handler antigo).
- **Timeout/fallback:** espelhe a robustez do fluxo antigo (timeout do client, handoff em falha) —
  o cidadão não pode ficar sem resposta nem receber erro técnico.
- Phone E.164: a Meta entrega `from` sem `+`; normalize como no handler antigo / F16-S22.

```

```
