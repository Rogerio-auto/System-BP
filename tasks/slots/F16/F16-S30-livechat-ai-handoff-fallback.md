---
id: F16-S30
title: Handoff real + mensagem de fallback ao cidadão quando a IA falha
phase: F16
task_ref: docs/06-langgraph-agentes.md
status: review
priority: high
estimated_size: M
agent_id: null
claimed_at: 2026-06-18T02:37:14Z
completed_at: 2026-06-18T02:57:51Z
pr_url: null
depends_on: [F16-S29]
blocks: []
labels: [lgpd-impact]
source_docs:
  - docs/06-langgraph-agentes.md
  - docs/planejamento-live-chat-proprio.md
  - docs/17-lgpd-protecao-dados.md
docs_required: true
docs_audience:
  - operador
  - dev
docs_artifacts:
  - docs/help/guias/livechat/handoff-ia-humano.mdx
---

# F16-S30 — Handoff real + fallback ao cidadão (IA livechat)

## Objetivo

Tornar o handoff do agente IA do livechat **funcional**: quando o LangGraph falha (timeout/erro)
ou sinaliza `handoff.required`, (a) enviar uma **mensagem de fallback ao cidadão** ("um atendente
vai te responder em instantes") e (b) criar/registrar um **handoff real** para um humano assumir
(atribuição/notificação), em vez de só logar.

## Contexto

**Bloqueante antes de ligar a IA em produção.** Em F16-S29 o `triggerLivechatHandoff` é um **stub**
(só `log.warn` + TODO) e, na falha do LangGraph, o cidadão fica **sem nenhuma resposta**. O fluxo
antigo (`whatsapp/handlers/ai-fallback.ts` / `process-with-ai.ts`) já fazia isso via Chatwoot —
aqui precisa ser o equivalente pelo canal do livechat. Para teste com a allowlist do Rogério é
tolerável, mas não para cidadãos reais.

## Escopo (faz)

- Substituir o stub `triggerLivechatHandoff` (em `workers/livechat-ai.ts`) por implementação real:
  1. **Fallback ao cidadão:** enviar mensagem padrão via `sendMessage` (ator de sistema, `userId: null`),
     idempotente por `messageId` (não duplicar fallback). Texto configurável/copy do DS de conteúdo.
  2. **Handoff:** marcar a conversa para atendimento humano — ex.: `conversations.status`/`assigned_user_id`
     ou um registro de handoff + evento `conversation:updated` no socket relay para o inbox refletir.
     Reusar a semântica do handoff existente (ver `ai-fallback.ts` antigo e doc 06 §4.4) adaptada ao livechat.
  3. **Auditoria:** registrar a decisão de handoff (sem PII bruta).
- Distinguir os dois gatilhos: (a) falha técnica do LangGraph (`reason: 'ai_unavailable'`) e
  (b) handoff pedido pelo grafo (`handoff.required`, `reason` do grafo).
- Testes: falha LangGraph → fallback enviado + handoff registrado (sem crash); handoff.required → idem
  sem mensagem de erro técnica; idempotência (não duplica fallback no reprocessamento); sem PII em logs.

## Fora de escopo (NÃO faz)

- Mudar o gate/fila/trigger (F16-S28) nem o pipeline antigo (`whatsapp/handlers/**`).
- UI dedicada de fila de handoff (se necessária, vira slot próprio) — aqui basta refletir no inbox via status/assign.
- Roteamento inteligente de qual humano recebe (round-robin/skills) — futuro.

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/workers/livechat-ai.ts`
- `apps/api/src/modules/livechat/ai-handoff.ts`
- `apps/api/src/workers/__tests__/livechat-ai.test.ts`
- `docs/help/guias/livechat/handoff-ia-humano.mdx`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/modules/conversations/send.service.ts` (consumir `sendMessage`, não editar)
- `apps/api/src/modules/whatsapp/**` (pipeline antigo)
- `apps/web/**`

## Contratos de entrada

- `sendMessage` (`conversations/send.service.ts`) com ator de sistema (`userId: null` — F16-S29).
- Worker `livechat-ai.ts` e seu `triggerLivechatHandoff` stub (F16-S29).
- Padrão de handoff/fallback do fluxo antigo (`whatsapp/handlers/ai-fallback.ts`, doc 06 §4.4).
- Socket relay `conversation:updated` para refletir no inbox.

## Contratos de saída

- Falha/handoff da IA → cidadão recebe mensagem + conversa entra na fila humana (status/assign) + inbox reflete.

## Definition of Done

- [ ] Fallback ao cidadão enviado via `sendMessage` (ator de sistema), idempotente
- [ ] Handoff registrado (status/assign + evento) e refletido no inbox via relay
- [ ] Dois gatilhos cobertos (falha técnica vs handoff.required do grafo)
- [ ] Auditoria sem PII bruta; logs sem content/telefone
- [ ] `pnpm --filter @elemento/api typecheck` / `lint` / `test` verdes
- [ ] Checklist LGPD §14.2 (doc 17) no PR + label `lgpd-impact`
- [ ] Doc `docs/help/guias/livechat/handoff-ia-humano.mdx` (operador + dev)
- [ ] PR aberto com checklist e link para o slot

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
```

## Notas para o agente

- Idempotência do fallback: use uma idempotency-key derivada do `messageId` (ex: `ai_fallback_<messageId>`)
  para não mandar a mensagem padrão duas vezes em reprocessamento de fila.
- Não envie detalhe técnico do erro ao cidadão — mensagem amigável e neutra.
- Reaproveite o que já existe no fluxo antigo de fallback/handoff em vez de reinventar a semântica.

```

```
