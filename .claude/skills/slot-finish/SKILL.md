---
name: slot-finish
description: Marca slot como review — atualiza frontmatter (status, completed_at), atualiza STATUS.md, commita chore. Use APÓS terminar implementação e passar todas as validações.
---

# /slot-finish <SLOT-ID>

Atômico — atualiza frontmatter para `review`, regenera STATUS.md, commita chore.

```bash
python scripts/slot.py finish F1-S03
```

## Pré-requisitos

Antes de rodar `slot-finish`, garanta:

```bash
python scripts/slot.py validate F1-S03   # todas as validações verdes
```

## O que ele faz

1. Atualiza frontmatter: `status: review`, `completed_at: <ISO>`
2. Re-renderiza `tasks/STATUS.md`
3. Commit `chore(tasks): <SLOT-ID> review`

## Aborta se

- Você não está no branch do slot (use `--force` para override)
- Slot já está em review (no-op)

## Após finish

```bash
git push origin feat/<slot-id-lowercase>
```

E então use `/open-pr <SLOT-ID>` para abrir o PR. **NÃO** abra PR manualmente.
