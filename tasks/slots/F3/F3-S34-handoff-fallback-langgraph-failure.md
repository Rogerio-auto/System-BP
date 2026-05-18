---
id: F3-S34
title: Fallback de handoff em falha do LangGraph
phase: F3
task_ref: T3.19
status: available
priority: high
estimated_size: S
agent_id: backend-engineer
claimed_at:
completed_at:
pr_url:
depends_on: [F3-S07, F3-S33]
blocks: []
labels: [lgpd-impact]
source_docs:
  - docs/06-langgraph-agentes.md
---

# F3-S34 — Fallback de handoff em falha do LangGraph

## Objetivo

Garantir que qualquer falha do LangGraph (timeout, erro HTTP, response inválido)
não deixe o cliente sem resposta: o backend transfere para atendente humano.

## Escopo

- No handler de F3-S33, em caso de timeout/erro/response inválido (doc 06 §4.4):
  1. Marca a decisão da IA com `error` (`ai_decision_logs` via endpoint).
  2. Envia mensagem padrão ao cliente: _"Recebi sua mensagem. Vou te transferir
     para um atendente."_
  3. Cria handoff via `POST /internal/handoffs` (F3-S07) com `reason='ai_unavailable'`.
- O LangGraph não retenta sozinho — o backend é o orquestrador.

## LGPD

- Mensagem padrão sem PII; logs com `correlation_id`, sem conteúdo bruto.

## Fora de escopo

- Caminho feliz (F3-S33).

## Arquivos permitidos

- `apps/api/src/modules/whatsapp/handlers/process-with-ai.ts`
- `apps/api/src/modules/whatsapp/handlers/ai-fallback.ts`
- `apps/api/src/modules/whatsapp/handlers/__tests__/ai-fallback.test.ts`

## Definition of Done

- [ ] Timeout do LangGraph → mensagem padrão + handoff `ai_unavailable`.
- [ ] Erro HTTP / response inválido → mesmo fallback.
- [ ] Decisão marcada com `error`.
- [ ] Testes cobrem timeout, erro 500 e response malformado.
- [ ] `pnpm --filter @elemento/api typecheck && lint && test` verdes.
- [ ] PR com label `lgpd-impact`.

## Validação

```powershell
pnpm --filter @elemento/api test -- whatsapp/handlers
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api typecheck
```
