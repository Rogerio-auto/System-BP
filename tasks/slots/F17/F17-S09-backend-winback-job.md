---
id: F17-S09
title: Backend — win-back (detecta fim de contrato → tarefa + sugestão de simulação)
phase: F17
task_ref: null
status: in-progress
priority: low
estimated_size: M
agent_id: null
claimed_at: 2026-06-16T14:51:36Z
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

Item 5 / Épico E.5. "Mais fácil vender para cliente antigo". Consome o sistema de **tarefas** (F15-S05). **D8 respondida: ambos os gatilhos** — três cenários independentes, todos no mesmo worker:

1. **Contrato perto do fim** (cliente com contrato ativo) — N parcelas restantes (parametrizável, sugestão: ≤2 parcelas)
2. **Lead fechado como `closed_lost`** — lead que foi marcado como perdido há X dias (sugestão: 30d) sem reabordagem
3. **Lead estagnado no Kanban** — lead sem movimentação de card há X dias (sugestão: 45d)

## Escopo (faz)

- Worker `apps/api/src/workers/winback-scan.ts` (cron, roda diariamente):
  1. **Scan contrato-fim**: detecta contratos com N parcelas `payment_dues` restantes sem `paid_at`; cria `task` tipo `winback_renovation` (role `agente`, city do cliente) com ref ao contrato. Idempotente: não cria se já existe tarefa `winback_renovation` ativa para o mesmo contrato.
  2. **Scan closed_lost**: detecta leads `status = 'closed_lost'` há ≥30 dias sem tarefa `winback_lost` ativa. Cria `task` tipo `winback_lost`.
  3. **Scan kanban stagnant**: detecta leads com `kanban_cards` sem mudança de `stage_id` há ≥45 dias e sem tarefa `winback_stagnant` ativa. Cria `task` tipo `winback_stagnant`.
- Emitir evento `contract.near_end` via outbox para o scan de contrato; registrar worker em `apps/api/src/workers/index.ts`.
- Limiares (N parcelas, 30d, 45d) configuráveis via variável de ambiente ou constante nomeada no topo do arquivo.

## Fora de escopo (NÃO faz)

- UI da oportunidade (F17-S10); disparo de simulação (já existe via F14-S05/S06).

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/workers/winback-scan.ts`
- `apps/api/src/workers/index.ts`
- `apps/api/src/workers/__tests__/**`
- `apps/api/src/events/types.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/modules/**`

## Definition of Done

- [ ] Idempotência: não cria tarefa duplicada para o mesmo contrato/lead em cooldown
- [ ] Tarefas `winback_renovation`, `winback_lost`, `winback_stagnant` criadas via service F15-S05 com city correta
- [ ] Teste de cenário para cada gatilho (dispara / não dispara)
- [ ] Limiares configuráveis por constante nomeada
- [ ] `pnpm --filter @elemento/api typecheck && lint && test` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api test -- winback
```

## Notas para o agente

- Depende da fundação de tarefas (F15-S05) já mergeada. `events/types.ts` é compartilhado — adicione sem remover eventos existentes.
- D8 resolvida: **ambos os gatilhos** — contrato perto do fim + lead closed_lost + lead kanban-stagnant. Implemente os 3 scans no mesmo worker.
- Limiares sugeridos mas ajustáveis: `WINBACK_INSTALLMENTS_THRESHOLD = 2`, `WINBACK_CLOSED_LOST_DAYS = 30`, `WINBACK_STAGNANT_DAYS = 45`.
- Para o scan de stagnant: `kanban_cards.updated_at` (última mudança de stage) é a referência temporal. Se não houver coluna de "última mudança de stage", use `kanban_cards.updated_at` como proxy.
- Delay mínimo de reabordagem: implícito na idempotência — não cria nova tarefa enquanto a anterior existir e não estiver `done`/`cancelled`.
