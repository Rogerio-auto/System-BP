---
id: F17-S09
title: Backend — win-back (detecta fim de contrato → tarefa + sugestão de simulação)
phase: F17
task_ref: null
status: blocked
priority: low
estimated_size: M
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F17-S01, F17-S03, F15-S05]
blocks: [F17-S10]
labels: [contracts, winback, worker, cobranca]
source_docs:
  - docs/planejamento-2026-06-evolucao.md#épico-e--contratos-boletos-e-renovação-item-5--épico
  - docs/04-eventos.md
---

# F17-S09 — Win-back (re-venda para cliente antigo)

## Objetivo

Detectar contratos perto do fim e gerar uma oportunidade: **tarefa** para o agente (via fundação F15) + sugestão de nova simulação pré-preenchida.

## Contexto

Item 5 / Épico E.5. "Mais fácil vender para cliente antigo". Consome o sistema de **tarefas** (F15-S05). Gatilho (decisão D8): **última parcela paga / N parcelas restantes** — parametrizável; confirmar D8 antes de fixar o número.

## Escopo (faz)

- Worker `apps/api/src/workers/contract-winback-scan.ts` (cron): detecta contratos com `last_due_date` próxima ou N parcelas restantes; idempotentemente cria `task` tipo `winback` (role `agente`, city do cliente) com referência ao contrato/cliente.
- Emitir evento `contract.near_end` via outbox; registrar worker em `apps/api/src/workers/index.ts`.

## Fora de escopo (NÃO faz)

- UI da oportunidade (F17-S10); disparo de simulação (já existe via F14-S05/S06).

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/workers/contract-winback-scan.ts`
- `apps/api/src/workers/index.ts`
- `apps/api/src/workers/__tests__/**`
- `apps/api/src/events/types.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/modules/**`

## Definition of Done

- [ ] Idempotência: não cria oportunidades duplicadas para o mesmo contrato
- [ ] Tarefa `winback` criada via service de F15-S05 com city correta
- [ ] Gatilho parametrizável (D8); teste de cenário (contrato no fim dispara; longe não)
- [ ] `pnpm --filter @elemento/api typecheck && lint && test` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api test -- winback
```

## Notas para o agente

- Depende da fundação de tarefas (F15-S05) já mergeada. `events/types.ts` é compartilhado — adicione sem remover eventos existentes.
- **Confirmar D8** (gatilho de fim de contrato) com o Rogério antes de fixar a regra; deixar configurável.
