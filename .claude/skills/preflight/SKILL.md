---
name: preflight
description: Validação rápida do working tree antes de começar trabalho em um slot. Aborta com BLOCK se sujo ou main divergente. Use no INÍCIO de toda sessão de agente.
---

# /preflight

Checa em 1 segundo se o repo está pronto para começar trabalho.

```bash
python scripts/slot.py preflight
```

Para JSON:

```bash
python scripts/slot.py preflight --json
```

## Output esperado (OK)

```
[OK] branch=main  dirty=no  main_behind=0
```

## Output esperado (problema)

```
[BLOCK] branch=feat/f1-s99  dirty=yes  main_behind=2
  Arquivos modificados:
    apps/api/src/foo.ts
    apps/web/src/bar.tsx
  main está 2 commits atrás de origin/main — rode `git pull --ff-only`
```

## Regra crítica

**Se BLOCK, NÃO tente "limpar" o estado.** Outro agente pode estar trabalhando paralelamente — limpar destruiria o trabalho dele. Pare e reporte ao orchestrator.

Esse comando foi criado depois do bug do 2026-05-11 onde agentes paralelos no mesmo working tree fizeram swap de branch e commits cruzados.
