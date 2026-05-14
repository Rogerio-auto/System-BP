---
id: F0-S12
title: Investigar staleness do Agent(isolation=worktree) vs commits recentes em main
phase: F0
task_ref: TOOLCHAIN.12
status: done
priority: medium
estimated_size: S
agent_id: backend-engineer
claimed_at:
completed_at: 2026-05-14T20:52:21Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/53
depends_on: []
blocks: []
labels: []
source_docs:
  - .claude/agents/orchestrator.md
  - tasks/PROTOCOL.md
---

# F0-S12 — Investigar staleness Agent worktree vs main

## Contexto (incidente 2026-05-14)

Sequência observada:

1. Orchestrator commitou `f25eb83 — chore(tasks): cria fase 2 credito e simulacao (9 slots)`
   em `main`, incluindo `tasks/slots/F2/F2-S02-calculator-price-sac.md`.
2. Imediatamente depois, orchestrator disparou `Agent(subagent_type: backend-engineer,
isolation: "worktree")` para implementar F2-S02.
3. O Agent tool criou worktree `.claude/worktrees/agent-ac663ad0364be4eb5/` com branch
   `worktree-agent-ac663ad0364be4eb5`.
4. **O agente reportou: "F2-S02 precisou ser criado do zero (arquivo `tasks/slots/F2/F2-S02-calculator-price-sac.md`
   não existia)."** Ele criou o arquivo, commitou, depois fez a feature branch.

## Por que isso importa

Se o Agent tool cria worktrees a partir de um snapshot **anterior** ao último commit em
`main`, ferramentas como `slot.py brief` (que lê slot do FS) vão devolver dados errados ou 404. O agente trabalha contra um estado defasado, e pode:

- Recriar artefatos que já existem.
- Pegar dependências em versões antigas.
- Gerar conflitos no PR.

## Objetivo

Determinar o comportamento real do `Agent(isolation: "worktree")` em relação ao HEAD de
`main` e documentar uma mitigação no protocolo (se for bug do harness) ou um workflow
no orchestrator (se for esperado).

## Escopo de investigação

### Reproduzir

1. Working tree principal: criar arquivo novo `tasks/test-worktree-staleness.md`, commitar.
2. Imediatamente disparar `Agent(isolation: "worktree", prompt: "ls tasks/")`.
3. Verificar se o arquivo aparece na listagem do agente.
4. Repetir com pausas de 0s, 1s, 5s — descobrir se há janela de race.

### Hipóteses

- **H1 — Worktree é criado de `HEAD~1` ou snapshot pre-commit.** Bug do harness.
- **H2 — Worktree é criado de `HEAD`, mas o `git worktree add` não vê commits feitos
  fora do processo do harness.** Cache do harness?
- **H3 — Agente leu de cache do harness/IDE em vez do FS do worktree.** Misconfig do
  agent type.
- **H4 — F2-S02 falso negativo:** o agente leu um diretório diferente e concluiu errado.
  Confirmar lendo o snapshot do worktree.

### Mitigação possível (independente da causa)

Atualizar `.claude/agents/orchestrator.md` com regra:

```
Após qualquer commit que altera tasks/slots/<phase>/, AGUARDAR 1-2s antes de disparar
Agent(isolation=worktree) — ou (preferível) passar o caminho do slot diretamente no
prompt em vez de confiar em `slot.py brief` descobrir.
```

E/ou no `slot.py brief` adicionar fallback: se slot não existe no FS, fazer
`git ls-tree HEAD tasks/slots/...` antes de retornar 404.

## Arquivos permitidos

- `.claude/agents/orchestrator.md` (adicionar nota)
- `tasks/PROTOCOL.md` (adicionar lição aprendida em §7)
- `scripts/slot.py` (se decidir fallback no `brief`)
- `docs/sessions/2026-05-14-f2-s02-worktree-bug.md` (criar documento de investigação)

## Definition of Done

- [ ] Reproduzir ou refutar a falha em ambiente controlado.
- [ ] Documentar causa raiz (ou hipótese mais provável + evidência).
- [ ] Aplicar mitigação no protocolo + orchestrator se for bug confirmado.
- [ ] Se for false positive do agente original, registrar a nota em PROTOCOL.md §7
      como "não-bug" para evitar reabertura.
- [ ] PR aberto com link para o documento de investigação.

## Validação

```powershell
git worktree list
# Teste reprodutível conforme escopo
```
