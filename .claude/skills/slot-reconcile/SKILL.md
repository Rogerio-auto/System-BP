---
name: slot-reconcile
description: Pós-merge — detecta branches feat/* já mergeados em origin/main e marca os slots como done automaticamente. Use depois de mergear 1+ PRs.
---

# /slot-reconcile

Sincroniza o estado dos slots com a realidade do git. Idempotente.

```bash
python scripts/slot.py reconcile-merged --write
```

Sem `--write` é dry-run (só lista o que seria mudado).

## O que ele faz

1. `git fetch origin main`
2. Para cada slot que não está `done`:
   - Encontra o branch `feat/<slot-id-lc>*` (local ou remoto)
   - Se o tip está alcançável de `origin/main` → marca slot como `done`
3. Re-renderiza `tasks/STATUS.md`

## Quando usar

- Depois de mergear PRs no GitHub
- Quando o STATUS.md está desincronizado (raro com o novo fluxo)
- Para auditoria — confirmar que nenhum slot fica perdido em `review`

## Output esperado

```
[reconcile] 4 slot(s) marcados done + STATUS.md atualizado
  F0-S07  review → done
  F1-S01  review → done
  F1-S02  review → done
  F1-S10  review → done
```
