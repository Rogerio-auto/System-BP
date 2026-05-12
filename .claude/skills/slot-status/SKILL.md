---
name: slot-status
description: Mostra resumo compacto do board de slots (substitui leitura de tasks/STATUS.md inteiro). Use quando precisar ver onde a Fase X está, ou quantos slots faltam.
---

# /slot-status

Executa `python scripts/slot.py status` no repo root e mostra o resultado.

Para listar slots prontos para trabalho (com deps satisfeitos), prefira `/slot-next`.

## Como invocar

Sem argumentos:

```bash
python scripts/slot.py status
```

Com filtro de fase:

```bash
python scripts/slot.py status --phase F1
```

Em formato JSON (para parsear):

```bash
python scripts/slot.py status --json
```

## Output esperado

```
Board (36 slots total)

  F0  (9):   ✅9
  F1  (26):  🟢8  ⏸️15  ✅3
  F3  (1):   🟢1
```

10 linhas — não 260+ como o `tasks/STATUS.md`.
