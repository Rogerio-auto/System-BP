# Sessão 2026-05-14 — Bug de staleness no Agent(isolation=worktree) vs commits locais não-pushados

## Contexto do incidente

Em 2026-05-14, o orchestrator commitou `f25eb83 chore(tasks): cria fase 2 credito e simulacao (9 slots)` no `main` **local**, incluindo `tasks/slots/F2/F2-S02-calculator-price-sac.md` (versão rica, 120 linhas). Imediatamente depois, disparou `Agent(subagent_type: backend-engineer, isolation: "worktree")` para implementar F2-S02.

O agente reportou: "F2-S02 precisou ser criado do zero — arquivo `tasks/slots/F2/F2-S02-calculator-price-sac.md` não existia." Ele criou versão simplificada (~25 linhas) e seguiu. Isso gerou conflict no merge (PR #49) e exigiu resolução manual envolvendo unlock do worktree + `checkout --theirs` + edit de frontmatter.

---

## Hipóteses investigadas

| ID  | Hipótese                                                                                 |
| --- | ---------------------------------------------------------------------------------------- |
| H1  | Worktree criado de `HEAD~1` ou snapshot pre-commit (bug do harness Claude Code)          |
| H2  | Harness usa SHA de `origin/main` capturado na abertura da sessão, não o HEAD local atual |
| H3  | Cache do harness/IDE entregou estado antigo                                              |
| H4  | Falso positivo — agente leu diretório errado e concluiu mal                              |

---

## Evidências coletadas

### Commit timeline

```
13:40:12  2fa96eb  chore(tooling): regenera tabela regression-guard   ← último commit PUSHADO para origin/main
14:07:45  f35941d  chore(tasks): cria fase 8 admin & gestao (5 slots) ← LOCAL apenas
14:12:18  f25eb83  chore(tasks): cria fase 2 credito e simulacao      ← LOCAL apenas (contém F2-S02 rico)
14:16:42  27460d3  chore(tasks): add slot f2-s02 calculator-price-sac ← claim do worktree F2-S02 (parent: 2fa96eb!)
14:37:27  7f317cf  chore(tasks): cria slots follow-up F0-S10/S11/S12  ← LOCAL apenas
14:54:12  71eb257  rebase (finish): refs/heads/main onto 1b4d1af       ← rebase que incorporou F2-S01 merge
```

### Genealogia do worktree F2-S02

```
git show 27460d3 --format="%H %P %ai %s" --no-patch
# Output:
27460d396ba3e8f1b0e33870f1a9b7d34ec4dc29  2fa96eb99c798c23647628525d36f163a9776529  2026-05-14 14:16:42 -0400
# parent = 2fa96eb (13:40) — não f25eb83 (14:12)
```

O worktree foi criado às 14:16 mas seu ponto de partida foi `2fa96eb` das 13:40 — **32 minutos e 3 commits atrás**.

### Verificação de presença em origin/main

```
git log origin/main --oneline | grep "f25eb83"   → sem resultado
git log origin/main --oneline | grep "2fa96eb"   → 2fa96eb chore(tooling): regenera tabela...
```

`f25eb83` **nunca foi pushado** para `origin/main`. `2fa96eb` era o tip de `origin/main` no momento do incidente.

### Acessibilidade do objeto no object store

```
git cat-file -t f25eb83   → commit
git show f25eb83:tasks/slots/F2/F2-S02-calculator-price-sac.md | wc -l   → 120
```

O objeto existe no repositório git (shared object store entre worktrees). O agente podia ler `git show f25eb83:...` se soubesse o SHA, mas não tinha visibilidade porque o commit não estava no histórico do seu `HEAD`.

### Confirmação de H4 (falso positivo) como improvável

O conflict no merge (PR #49) prova que os dois lados do merge tinham versões diferentes do arquivo. Isso só ocorre se o worktree realmente não tinha o arquivo — impossível se fosse apenas leitura de diretório errado.

---

## Causa raiz confirmada: **H2**

> O harness Claude Code, ao criar `git worktree add` para `isolation: "worktree"`, usa o SHA de `origin/main` (ou o SHA capturado no início da sessão/snapshot remoto), **não** o `HEAD` do ramo `main` local.

**Corolário:** commits feitos em `main` local sem `git push origin main` são **invisíveis** para qualquer worktree criado pelo harness naquela sessão. O worktree parte de um estado que pode estar N commits atrás do estado local.

### Por que H1/H3 foram descartadas

- H1 (HEAD~1): o worktree estava 3 commits atrás de `main`, não 1. Não é comportamento de HEAD~1.
- H3 (cache IDE): o conflict no merge com dois arquivos distintos afasta explicação de cache de leitura. O FS foi afetado.

---

## Impacto

- Conflict em PR #49 com resolução manual.
- Tempo perdido: estimativa ~30 min de resolução + retrabalho de frontmatter.
- Risco: se o agente não tivesse reportado a ausência do slot e tivesse silenciado o erro, a versão rica do slot seria perdida permanentemente após o rebase.

---

## Mitigação

### Mitigação primária (operacional — imediata)

**Regra nova no protocolo:** antes de disparar `Agent(isolation: "worktree")`, o orchestrator deve fazer `git push origin main` para sincronizar o estado local com `origin/main`. Só depois dispatchar o agente.

```
# Sequência correta no orchestrator:
git commit -m "chore(tasks): cria slots F2 ..."   # commit local
git push origin main                               # <<< OBRIGATÓRIO antes de dispatch
# Então:
Task(subagent_type="backend-engineer", isolation="worktree", ...)
```

### Mitigação secundária (defensive — no slot.py brief)

Se `slot.py brief <ID>` for invocado dentro de um worktree e o arquivo do slot não existir no FS, tenta `git ls-tree HEAD tasks/slots/...` como fallback antes de retornar erro. Isso não resolve o staleness mas produz mensagem de diagnóstico mais clara ao agente.

### Mitigação terciária (documentação)

O `orchestrator.md` já dizia:

> "o worktree deve ser criado a partir de um HEAD atualizado de `origin/main`"

Mas não tornava explícito que o requisito é push **antes** do dispatch. A nota foi reforçada.

---

## Artifacts alterados por este slot

- `docs/sessions/2026-05-14-f2-s02-worktree-bug.md` — este documento
- `tasks/PROTOCOL.md` — §7.9 adicionado (lição aprendida)
- `.claude/agents/orchestrator.md` — §2 reforçado com nota sobre push obrigatório
