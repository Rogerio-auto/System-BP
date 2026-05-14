---
id: F0-S13
title: Fix heurística de reconcile-merged (não detecta slots mergeados)
phase: F0
task_ref: TOOLCHAIN.13
status: in-progress
priority: medium
estimated_size: S
agent_id: backend-engineer
claimed_at: 2026-05-14T20:21:05Z
completed_at:
pr_url:
depends_on: []
blocks: []
labels: []
source_docs:
  - scripts/slot.py
  - tasks/PROTOCOL.md
---

# F0-S13 — Fix reconcile-merged heuristic

## Contexto (incidentes 2026-05-14)

Em 3 ocasiões seguidas, `python scripts/slot.py reconcile-merged --write` foi rodado após
merge de PR e respondeu **"nada a mudar"** quando deveria ter marcado o slot como `done`:

| Slot   | PR  | Status real após merge                   | Reconcile detectou? |
| ------ | --- | ---------------------------------------- | ------------------- |
| F2-S01 | #48 | `available` (frontmatter não atualizado) | ❌                  |
| F2-S02 | #49 | `review`                                 | ❌                  |
| F0-S10 | #50 | `review`                                 | ❌                  |

Em todos os 3 casos a correção foi **patch manual** do frontmatter: `status: done`,
`pr_url`, `completed_at`. Os 3 patches geraram commits `chore(tasks): marca <slot> done`
(commits `26e1f58` para F2-S01/S02, `a6f7076` para F0-S10).

## Por que isso importa

- Cada slot mergeado exige edição manual do frontmatter — quebra a regra "STATUS.md é
  view derivada, slot frontmatter é a fonte da verdade gerenciada por `slot.py`".
- O contador do board fica errado por minutos/horas até alguém patchar.
- Erros de digitação no patch manual (datas, URLs) podem entrar em main.
- `reconcile-merged --write` deveria ser **idempotente e automático** — esse é o ponto
  inteiro do comando.

## Hipóteses sobre a causa

Investigar quais delas se aplicam:

1. **Heurística olha apenas branches `feat/*` ainda presentes em `origin/`.** Após merge
   via `gh pr merge`, a branch é deletada (default). Se o reconcile compara contra
   `git branch -r` ao vivo, perde o sinal.
2. **Heurística requer `status: review` no slot.** F2-S01 ficou em `available` porque o
   agente trabalhou em worktree de snapshot antigo (bug F0-S12) e o frontmatter nunca foi
   atualizado em `main` local. Reconcile vê `available` → não promove para `done`.
3. **Heurística mapeia `slot_id` ↔ nome da branch.** Se a branch tem nome divergente
   (`feat/f2-s01` vs `feat/f2-s01-schema-credit-core`), o regex pode falhar.
4. **Heurística faz `git log` em busca de merge commits.** Após `git pull --rebase` em
   main local, as hashes da história remota podem não bater com o cache local.
5. **PR url no frontmatter está vazio** e reconcile usa isso como pivô.

## Objetivo

`reconcile-merged --write` detecta automaticamente todos os slots cujo trabalho foi
mergeado em `origin/main`, independentemente de:

- status atual do slot (`available`, `review` — ambos devem virar `done` se merged)
- presença/ausência da branch no remote
- divergências entre nome da branch e slot_id (regex tolerante)
- hashes de história após rebase

## Escopo

### Investigação (parte do PR)

1. Ler implementação atual de `reconcile-merged` em `scripts/slot.py`.
2. Reproduzir cada um dos 3 casos (F2-S01, F2-S02, F0-S10) — checar git log para
   confirmar que os merges existem em `origin/main`.
3. Documentar qual hipótese se confirma (pode ser combinação).

### Implementação

Estratégia recomendada (não obrigatória — backend-engineer decide):

**Fonte de verdade primária: GitHub API via `gh`.**

```bash
gh pr list --state merged --json number,headRefName,mergedAt --limit 100
```

Para cada PR mergeado:

1. Extrair `slot_id` do `headRefName` via regex tolerante: `feat/(f\d+-s\d+)(?:-.*)?` →
   `F2-S01`, `F0-S10`, etc.
2. Achar o slot file por `slot_id` no FS (case-insensitive).
3. Se status atual != `done`:
   - Setar `status: done`
   - Setar `pr_url: https://github.com/<owner>/<repo>/pull/<number>` (extrair owner/repo
     via `gh repo view --json owner,name`)
   - Setar `completed_at: <mergedAt>` (do gh, formato ISO)
   - Manter `claimed_at` se já preenchido; senão usar `mergedAt - 1h` como fallback razoável.
4. Acumular mudanças, escrever em batch, rodar `slot.py sync` no fim.

Cuidados:

- **Idempotente:** rodar 2x = no-op na segunda.
- **Não regredir slots já `done`** (não sobrescrever `completed_at` existente).
- **Sem falsos positivos:** se branch não bate com nenhum slot, log warning e skip.
- **Sem rede em dry-run:** `reconcile-merged` sem `--write` não deve chamar `gh`
  (cache local OK).

### Atualizar PROTOCOL.md

Se o comportamento mudar, refletir em PROTOCOL.md §2.5 (pós-merge).

## Arquivos permitidos

- `scripts/slot.py`
- `scripts/slot_lib/git.py` (módulo introduzido por F0-S10 — pode estender)
- `scripts/slot_lib/github.py` (novo, opcional — wrapper de `gh` CLI)
- `tasks/PROTOCOL.md` (§2.5)
- `tasks/slots/F0/F0-S10-fix-slot-py-em-worktrees-agent.md` (apenas se for revisar a doc
  do worktree detection; tocar com cuidado)
- `scripts/__tests__/test_slot.py` (se houver estrutura de teste Python)

## Definition of Done

- [ ] `reconcile-merged --write` rodado contra estado atual marca todos os slots de F2
      e F0 que já estão `done` como **idempotente** (no-op).
- [ ] Simular cenário: marcar manualmente F2-S01 de volta para `available`/`review` →
      rodar `reconcile-merged --write` → slot volta para `done` com `pr_url` + `completed_at`
      corretos.
- [ ] Heurística usa `gh pr list --state merged` como source-of-truth (não depende de
      branches locais ou de história não-rebaseada).
- [ ] Sem falsos positivos: rodar contra branches `feat/*` não-relacionadas a slots
      (ex: futuro `feat/refactor-X`) não causa erro nem promove slot errado.
- [ ] Sem rede em modo dry-run (sem `--write`).
- [ ] PROTOCOL.md §2.5 atualizado se comportamento mudou.
- [ ] PR aberto.

## Validação

```powershell
python scripts/slot.py reconcile-merged --write       # deve ser idempotente
python scripts/slot.py status                          # contagens corretas
# Teste manual: marcar F2-S01 como available/review, rodar reconcile, checar volta para done
```
