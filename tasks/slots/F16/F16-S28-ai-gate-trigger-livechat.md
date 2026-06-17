---
id: F16-S28
title: IA no livechat — gate (flag + allowlist de teste) e trigger no inbound
phase: F16
task_ref: docs/06-langgraph-agentes.md
status: in-progress
priority: high
estimated_size: M
agent_id: null
claimed_at: 2026-06-17T20:57:02Z
completed_at: null
pr_url: null
depends_on: []
blocks: [F16-S29]
labels: [lgpd-impact]
source_docs:
  - docs/06-langgraph-agentes.md
  - docs/planejamento-live-chat-proprio.md
  - docs/17-lgpd-protecao-dados.md
docs_required: true
docs_audience:
  - gestor
  - dev
docs_artifacts:
  - docs/help/guias/livechat/agente-ia.mdx
---

# F16-S28 — Gate e trigger da IA no livechat

## Objetivo

Habilitar o disparo do agente LangGraph a partir do livechat novo (F16), atrás de um gate seguro:
feature flag `ai.livechat_agent.enabled` + **allowlist de números para ambiente de teste**
(responder só ao número do Rogério, com suporte a múltiplos). Este slot entrega o gate + o
enfileiramento; a execução do agente e o envio da resposta ficam em F16-S29.

## Contexto

Diagnóstico (2026-06-17): o pipeline antigo de IA (`whatsapp/handlers/process-with-ai.ts`) responde
via **Chatwoot** e busca a mensagem em `whatsapp_messages` — o livechat novo grava em `messages`,
então o handler antigo **pula** as mensagens do livechat. Ou seja, a IA **não está integrada** ao
livechat. Para teste seguro, o Rogério quer que a IA responda **apenas a números allowlistados**.

Decisão de arquitetura: trigger desacoplado. O `livechat-inbound` worker, após persistir a
mensagem, publica um job em `hm.q.livechat.ai` **somente se** o gate passar. O worker de IA
(F16-S29) consome essa fila. Mantém o inbound rápido e isola a IA.

## Escopo (faz)

- **Feature flag** `ai.livechat_agent.enabled` em `db/seeds/featureFlags.ts` (default `disabled`).
- **Allowlist de teste** via env: `AI_LIVECHAT_ALLOWLIST` (string CSV de telefones normalizados,
  ex: `5569999990000,5569988887777`). Declarar em `config/env.ts` (opcional, default vazio) e parsear.
- **Helper de gate** `shouldAiRespond({ db, organizationId, contactRemoteId, conversation })` em
  novo arquivo `modules/livechat/ai-gate.ts`:
  - Flag `ai.livechat_agent.enabled` ligada (via `isFlagEnabled`); E
  - allowlist: se `AI_LIVECHAT_ALLOWLIST` não-vazia, o telefone do contato deve estar nela
    (gate de teste). Se vazia, comportamento conforme a flag (sem restrição de número).
  - Mensagens de saída (direction != inbound) e tipos não-texto: não disparam (retorna false).
- **Topologia** `hm.q.livechat.ai` (+ binding/DLX) em `lib/queue/topology.ts`, espelhando o padrão
  das demais filas livechat (F16-S01).
- **Trigger no inbound**: em `workers/livechat-inbound.ts`, após `persistInboundMessage` (mensagem
  nova, não duplicata), chamar `shouldAiRespond`; se true, `publish` em `hm.q.livechat.ai` com
  `{ organizationId, channelId, conversationId, messageId, contactRemoteId }`. Falha de publish
  não quebra o ack (try/catch + warning).
- Testes: gate (flag off→false; flag on + allowlist com número→true; flag on + número fora→false;
  flag on + allowlist vazia→true); publish no inbound só quando gate passa.

## Fora de escopo (NÃO faz)

- Execução do grafo LangGraph e envio da resposta (F16-S29).
- UI de toggle de IA por conversa (futuro — aqui é flag global + allowlist).
- Mudar o handler antigo `whatsapp/handlers/process-with-ai.ts`.

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/modules/livechat/ai-gate.ts`
- `apps/api/src/workers/livechat-inbound.ts`
- `apps/api/src/lib/queue/topology.ts`
- `apps/api/src/db/seeds/featureFlags.ts`
- `apps/api/src/config/env.ts`
- `apps/api/src/modules/livechat/__tests__/ai-gate.test.ts`
- `apps/api/src/workers/__tests__/livechat-inbound.test.ts`
- `docs/help/guias/livechat/agente-ia.mdx`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/workers/livechat-ai.ts` (F16-S29 é dono)
- `apps/api/src/modules/whatsapp/**` (pipeline antigo)
- `apps/web/**`

## Contratos de entrada

- `isFlagEnabled` (modules/featureFlags/service). `publish`/`makeEnvelope`/`QUEUES` (lib/queue).
- Padrão de filas livechat em `lib/queue/topology.ts` (F16-S01).
- `conversations.lead_id` / `contact_remote_id` disponíveis na conversa (F16 schema).

## Contratos de saída

- Fila `hm.q.livechat.ai` declarada + job publicado quando o gate passa.
- Flag `ai.livechat_agent.enabled` e env `AI_LIVECHAT_ALLOWLIST` documentadas (doc de ajuda).
- `shouldAiRespond` exportado para reuso/testes.

## Definition of Done

- [ ] Gate implementado e testado (4 cenários flag/allowlist)
- [ ] Fila `hm.q.livechat.ai` na topologia com DLX
- [ ] Trigger publica só quando gate passa; não quebra o ack
- [ ] Flag seed default off + env allowlist parseada (CSV → lista normalizada)
- [ ] `pnpm --filter @elemento/api typecheck` / `lint` / `test` verdes
- [ ] LGPD: telefone/allowlist nunca logados em texto plano; job sem PII bruta (só IDs + remoteId opaco)
- [ ] Checklist LGPD §14.2 (doc 17) no PR + label `lgpd-impact`
- [ ] Doc `docs/help/guias/livechat/agente-ia.mdx` (como ligar a flag + configurar números de teste)
- [ ] PR aberto com checklist e link para o slot

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
```

## Notas para o agente

- A allowlist é **gate de segurança de teste**: enquanto `AI_LIVECHAT_ALLOWLIST` tiver valores, a IA
  só responde a esses números — mesmo com a flag ligada. Isso protege contra responder cidadãos reais
  em homologação. Documente isso claramente no mdx.
- Normalize os números da allowlist do mesmo jeito que `contact_remote_id` (dígitos, sem `+`) para
  comparação consistente (ver normalização em F16-S22 / leads `phone_normalized`).
- Não dispare para mensagens de status/duplicatas — só para inbound novo de texto.

```

```
