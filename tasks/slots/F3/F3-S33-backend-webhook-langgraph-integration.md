---
id: F3-S33
title: Backend integra webhook WhatsApp → LangGraph → resposta
phase: F3
task_ref: T3.18
status: available
priority: critical
estimated_size: M
agent_id: backend-engineer
claimed_at:
completed_at:
pr_url:
depends_on: [F3-S32]
blocks: [F3-S34]
labels: [lgpd-impact]
source_docs:
  - docs/06-langgraph-agentes.md
  - docs/07-integracoes-whatsapp-chatwoot.md
  - docs/04-eventos.md
  - docs/17-lgpd-protecao-dados.md
---

# F3-S33 — Integração backend ↔ LangGraph

## Objetivo

Ligar a mensagem entrante do WhatsApp ao grafo: o backend, ao processar
`whatsapp.message_received`, chama o LangGraph e envia a resposta ao cliente.

## Escopo

- `apps/api/src/integrations/langgraph/client.ts` — cliente HTTP para o LangGraph:
  - `POST /process/whatsapp/message` com o payload do doc 06 §4.1.
  - Timeout duro de 8s (doc 06 §4.4). Sem retry no cliente (backend orquestra).
- Handler do evento `whatsapp.message_received` (worker/outbox):
  - Monta o payload (carrega estado prévio, `correlation_id`, `idempotency_key`).
  - Chama o LangGraph, aplica as `actions`/`reply` do response.
  - Envia a `reply` via WhatsApp/Chatwoot (cliente de F1-S20).
- Validação Zod do response do LangGraph.

## LGPD

- DLP já roda no LangGraph; o backend não loga conteúdo bruto da mensagem.
- `correlation_id` em todos os logs.

## Fora de escopo

- Tratamento de falha/timeout do LangGraph (F3-S34) — este slot cobre o caminho feliz.

## Arquivos permitidos

- `apps/api/src/integrations/langgraph/client.ts`
- `apps/api/src/integrations/langgraph/schemas.ts`
- `apps/api/src/modules/whatsapp/handlers/process-with-ai.ts`
- `apps/api/src/integrations/langgraph/__tests__/client.test.ts`
- `apps/api/src/modules/whatsapp/handlers/__tests__/process-with-ai.test.ts`

## Definition of Done

- [ ] Mensagem entrante dispara chamada ao LangGraph.
- [ ] `reply` da IA enviada ao cliente via WhatsApp/Chatwoot.
- [ ] Timeout de 8s configurado no cliente.
- [ ] Response validado com Zod.
- [ ] `correlation_id` propagado.
- [ ] `pnpm --filter @elemento/api typecheck && lint && test` verdes.
- [ ] PR com label `lgpd-impact` + checklist §14.2.

## Validação

```powershell
pnpm --filter @elemento/api test -- langgraph whatsapp/handlers
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api typecheck
```
