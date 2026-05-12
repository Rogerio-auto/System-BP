---
name: open-pr
description: Abre PR no GitHub para um slot — título e body derivados do frontmatter e seções do slot. Use depois de slot-finish + git push.
---

# /open-pr <SLOT-ID>

Abre PR no GitHub a partir do branch do slot. Título vem do último commit feat, body extraído de "## Resumo" e "## Definition of Done" do slot.

```bash
python scripts/slot.py pr open F1-S03
```

Para draft:

```bash
python scripts/slot.py pr open F1-S03 --draft
```

## Pré-requisitos

- `gh` CLI instalado e autenticado (`gh auth login`)
- Branch já pushed para `origin`
- Slot em `status: review` (depois de `slot-finish`)

## O que ele faz

1. Encontra o branch remoto correspondente ao slot
2. Gera título a partir do último commit feat do branch
3. Gera body Markdown:
   - Link para o slot
   - Seção "## Resumo" (ou "## Objetivo") copiada do slot
   - Seção "## Definition of Done" copiada do slot
4. Chama `gh pr create --base main --head <branch> --title ... --body ...`
5. Imprime a URL do PR

## Mergear (depois)

```bash
python scripts/slot.py pr merge <PR-NUMBER> --reconcile
```

Esse mergeia o PR + sincroniza `main` local + roda `reconcile-merged --write` em uma operação.
