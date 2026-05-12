---
name: worktree-clean
description: Remove worktrees stale em .claude/worktrees/agent-* — unlock + git worktree remove --force + cmd rmdir com prefix \\?\ para long-path no Windows + prune. Use após mergear PRs com worktrees ativos.
---

# /worktree-clean

```powershell
python scripts/slot.py worktree-clean
```

## Quando usar

- Após merge de PRs cujos agentes rodaram em `isolation: "worktree"`.
- Quando `git worktree list` mostra worktrees `locked` que não são mais necessários.
- Antes de iniciar novo ciclo paralelo.

## O que faz

1. Lista worktrees em `.claude/worktrees/agent-*`
2. Para cada: `git worktree unlock` → `git worktree remove --force`
3. Limpeza física residual via `cmd /c rmdir /S /Q "\\?\<path>"` (long-path safe)
4. `git worktree prune`

## Por que não funciona via tools normais

- `Remove-Item -Recurse` falha em `node_modules` profundos (MAX_PATH 260 chars no Windows).
- `git worktree remove` falha se restaram arquivos pós-rmdir.
- Sem o prefixo `\\?\`, paths > 260 chars são rejeitados pela API.

Este comando consolida os 4 passos em 1.
