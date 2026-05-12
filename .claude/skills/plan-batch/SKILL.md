---
name: plan-batch
description: Recomenda batch paralelo respeitando prioridade e colisão de files_allowed. Use no início de um novo ciclo — substitui 4-13 calls de exploração do orchestrator.
---

# /plan-batch

```powershell
python scripts/slot.py plan-batch --max 3 --json
```

Saída:

```json
{
  "batch": [
    {"slot_id": "F1-S16", "priority": "high", "specialist": "backend-engineer",
     "files_allowed": [...], "isolation": "worktree"}
  ],
  "deferred": [{"slot_id": "F1-S20", "reason": "files_overlap with F1-S19"}],
  "next_migration_number": 4
}
```

## Quando usar

- Início de novo ciclo de implementação.
- Após merge de PRs, para escolher próximo batch.
- Quando o usuário pede "próximo slot" ou "paralelo".

## O que faz

1. Filtra `available` com deps satisfeitos.
2. Ordena por prioridade (critical > high > medium).
3. Detecta sobreposição de `files_allowed` (parseado do corpo dos slots).
4. Infere `specialist` baseado em path patterns.
5. Retorna batch máximo independente.

## Alternativas

- `python scripts/slot.py list-available` — só lista (sem decisão de paralelismo).
- `python scripts/slot.py brief <ID>` — briefing detalhado de um slot específico.
