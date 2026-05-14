---
id: F0-S10
title: Fix scripts/slot.py claim/finish em worktrees do Agent tool
phase: F0
task_ref: TOOLCHAIN.10
status: available
priority: high
estimated_size: S
agent_id: backend-engineer
claimed_at:
completed_at:
pr_url:
depends_on: []
blocks: []
labels: []
source_docs:
  - tasks/PROTOCOL.md
  - .claude/agents/orchestrator.md
---

# F0-S10 — Fix slot.py em worktrees do Agent

## Contexto (incidente 2026-05-14)

Quando o `orchestrator` dispara um especialista com `Agent(isolation: "worktree")`, o Claude
Code cria um worktree em `.claude/worktrees/agent-<id>/` com uma branch dedicada
(`worktree-agent-<id>`). O agente entra nesse worktree e tenta seguir o fluxo canônico:

```powershell
python scripts/slot.py claim   F2-SXX
# ... impl ...
python scripts/slot.py finish  F2-SXX
```

`claim` falha porque internamente executa `git checkout main && git pull --ff-only` — e
**em um worktree não-principal**, `git checkout main` é proibido se a branch `main` já
está checked out no working tree principal (git impede o mesmo branch em dois worktrees).

O agente F2-S02 (cycle de 2026-05-14, commit `b39d1a5`) reportou:

> "slot.py claim e slot.py finish falham em worktree pois tentam git checkout main —
> foi necessário executar os equivalentes manualmente via Python e commits diretos."

Isso quebra o protocolo (PROTOCOL.md §2.2 diz que `slot.py` é a **única forma** de claim).

## Objetivo

Tornar `scripts/slot.py claim/finish` worktree-aware, mantendo a UX idêntica no working
tree principal.

## Escopo

### Detecção de worktree

Adicionar helper em `scripts/slot.py` (ou módulo de utilitários):

```python
def is_in_worktree() -> bool:
    """Retorna True se cwd está num worktree não-principal."""
    # `git rev-parse --git-dir` retorna .git em main, ou
    # caminho como .git/worktrees/<name> em worktree.
    ...

def main_worktree_path() -> Path:
    """Caminho absoluto do working tree principal."""
    # `git worktree list --porcelain` → primeiro entry é o main.
    ...
```

### Adaptação de `claim`

Quando rodado em worktree:

1. **Pular** `git checkout main && git pull --ff-only`. O worktree já está numa branch
   dedicada (`worktree-agent-<id>` ou similar), criada do HEAD atual de `main`.
2. Criar branch `feat/<slot-id-lowercase>` a partir de `HEAD` do worktree (não de `main`).
   `git switch -c feat/<slot-id>`.
3. Atualizar frontmatter + STATUS.md no próprio worktree (já estão lá pelos arquivos).
4. Commit `chore(tasks): <slot-id> in-progress` no worktree.

### Adaptação de `finish`

Quando rodado em worktree: idem — atualizar frontmatter + STATUS.md no worktree, commit
`chore(tasks): <slot-id> review`. Sem operações em main.

### Sincronização pós-merge

Quando o PR for mergeado em `origin/main`, o `reconcile-merged --write` (rodado no working
tree principal após `git pull`) deve detectar a branch `feat/<slot-id>` em `origin/main`
e marcar como done — independentemente de onde foi criada. Confirmar via teste que isso
ainda funciona.

### Bug paralelo: `git pull --ff-only` em worktree quando branch atual ≠ main

`pull --ff-only` em worktree em branch `feat/X` faz fetch+merge na branch atual, não em
main. Se o script precisa "atualizar main", precisa rodar isso no working tree principal
via `git -C <main-path> ...`. Documentar a decisão.

## Arquivos permitidos

- `scripts/slot.py`
- `scripts/slot_lib/__init__.py` (se houver módulo)
- `scripts/slot_lib/git.py` (módulo novo opcional)
- `scripts/__tests__/test_slot.py` (se já existe estrutura de teste para Python)
- `tasks/PROTOCOL.md` (atualizar §2.2 com nota de worktree)
- `.claude/agents/orchestrator.md` (atualizar §3 com nota de worktree)

## Definition of Done

- [ ] `slot.py claim <ID>` funciona em working tree principal (comportamento atual).
- [ ] `slot.py claim <ID>` funciona em worktree do Agent tool sem erro.
- [ ] `slot.py finish <ID>` idem.
- [ ] `reconcile-merged --write` continua detectando branches mergeadas em `origin/main`.
- [ ] PROTOCOL.md e orchestrator.md atualizados com nota explícita.
- [ ] Teste manual: criar worktree fake (`git worktree add /tmp/wt -b worktree-test`), rodar `slot.py claim F2-S03` lá, verificar branch + frontmatter + commit.
- [ ] PR aberto.

## Validação

```powershell
python scripts/slot.py status
git worktree list
# Teste manual conforme DoD
```
