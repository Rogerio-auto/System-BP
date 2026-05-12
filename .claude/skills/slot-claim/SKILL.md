---
name: slot-claim
description: Reserva um slot atomicamente — cria branch a partir de main, atualiza frontmatter para in-progress, atualiza STATUS.md, commita chore. Use ANTES de qualquer trabalho em um slot novo.
---

# /slot-claim <SLOT-ID>

Comando atômico que substitui 5-7 operações manuais.

```bash
python scripts/slot.py claim F1-S03
```

## O que ele faz

1. `git checkout main && git pull --ff-only origin main`
2. Cria branch `feat/<slot-id-lowercase>`
3. Atualiza frontmatter do slot: `status: in-progress`, `agent_id`, `claimed_at`
4. Re-renderiza `tasks/STATUS.md` a partir de todos os frontmatters
5. Commit `chore(tasks): <SLOT-ID> in-progress`

## Aborta se

- Working tree sujo (use `/preflight` antes)
- Branch já existe (use `--force` para forçar)
- Slot não está `available` (use `--force` para forçar)
- `git pull` falha (main divergente do origin)

## Regra

**NÃO** edite `tasks/STATUS.md` à mão. **NÃO** crie branch manualmente. Esse script é a única forma autorizada de claim — garante atomicidade e evita race condition entre agentes paralelos.
