---
id: F0-S11
title: Investigar e corrigir bloco Validação dos slots F2 (Vitest vs Jest)
phase: F0
task_ref: TOOLCHAIN.11
status: available
priority: medium
estimated_size: XS
agent_id: backend-engineer
claimed_at:
completed_at:
pr_url:
depends_on: []
blocks: []
labels: []
source_docs:
  - tasks/PROTOCOL.md
  - scripts/slot.py
---

# F0-S11 — Fix bloco Validação Vitest

## Contexto (incidente 2026-05-14)

O agente F2-S02 reportou que `python scripts/slot.py validate F2-S02` falhou porque "o
slot usa `--testPathPattern` (flag Jest, inválida no Vitest)".

Olhando os slots F2-S01..F2-S09 criados em commit `f25eb83`, eles usam:

```powershell
pnpm --filter @elemento/api test -- credit
```

Não há `--testPathPattern` no markdown dos slots. Possíveis hipóteses:

1. **`slot.py validate` parseia o bloco Validação e injeta `--testPathPattern` automaticamente.**
   Verificar implementação.
2. **`pnpm --filter @elemento/api test -- X` está sendo interpretado corretamente como
   `vitest X`** (pattern posicional), e o agente confundiu. Verificar empiricamente.
3. **A configuração do `test` script no `apps/api/package.json`** transforma `--` em flag
   Jest. Verificar.

## Objetivo

Auditar e corrigir (se necessário) a sintaxe do bloco `## Validação` em todos os slots
para garantir que `slot.py validate <ID>` execute corretamente com Vitest.

## Escopo

### Investigação

1. Ler `scripts/slot.py` — parsing do bloco `## Validação` (provavelmente regex `pnpm.*`).
2. Rodar manualmente `pnpm --filter @elemento/api test -- simulations/calculator` no main
   working tree (em branch feat/f2-s02 com o calculator implementado) e verificar se
   executa corretamente.
3. Se falhar com `--testPathPattern`: localizar onde a flag é introduzida.
4. Se passar: documentar que era falso positivo do agente.

### Correção (se confirmada)

Padrão recomendado para slots Vitest (já usado em F2-S01..S09):

```powershell
pnpm --filter @elemento/api test -- <pattern-posicional>
```

Se isso não funciona, alternativas:

- `pnpm --filter @elemento/api exec vitest run <pattern>`
- Ajustar `slot.py` para usar a sintaxe correta na hora de invocar.

### Atualização

Se a investigação concluir que é bug do `slot.py`, fix ali. Se é bug do template, atualizar
os 9 slots F2 (apenas o bloco `## Validação`). Os slots F8 também devem ser auditados:

```
tasks/slots/F2/F2-S01..S09 (9 arquivos — bloco Validação)
tasks/slots/F8/F8-S01..S05 (5 arquivos — bloco Validação)
```

## Arquivos permitidos

- `scripts/slot.py` (se for bug do script)
- `tasks/slots/F2/F2-S01-schema-credit-core.md`
- `tasks/slots/F2/F2-S02-calculator-price-sac.md`
- `tasks/slots/F2/F2-S03-crud-credit-products.md`
- `tasks/slots/F2/F2-S04-endpoint-simulations.md`
- `tasks/slots/F2/F2-S05-endpoint-internal-simulations.md`
- `tasks/slots/F2/F2-S06-frontend-simulator.md`
- `tasks/slots/F2/F2-S07-frontend-products-timeline.md`
- `tasks/slots/F2/F2-S08-frontend-simulations-history.md`
- `tasks/slots/F2/F2-S09-worker-kanban-on-simulation.md`
- `tasks/slots/F8/F8-S01-backend-agents-crud.md`
- `tasks/slots/F8/F8-S02-frontend-users.md`
- `tasks/slots/F8/F8-S03-backend-dashboard-metrics.md`
- `tasks/slots/F8/F8-S04-frontend-agents.md`
- `tasks/slots/F8/F8-S05-frontend-dashboard.md`

## Definition of Done

- [ ] Investigação documentada no PR (bug do script ou false positive?).
- [ ] Se bug do script: fix em `slot.py` + teste manual com 1 slot.
- [ ] Se bug do template: 14 slots atualizados com sintaxe correta.
- [ ] `python scripts/slot.py validate F2-S02` (em working tree principal, com o calculator
      já mergeado ou cherry-picked) passa sem erro de flag.
- [ ] PR aberto.

## Validação

```powershell
# Antes:
python scripts/slot.py validate F2-S02      # reproduzir falha
# Após fix:
python scripts/slot.py validate F2-S02      # deve passar
```
