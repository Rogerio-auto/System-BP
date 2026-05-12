# Plano autônomo — sessão noturna

> Rogério dorme. Eu (Claude) opero em bypass mode com guard hook ativo.
> Trabalho até atingir ~70% de contexto, então paro e documento.

## Modo

- **Bypass:** `.claude/settings.local.json` → `defaultMode: bypassPermissions`.
- **Guard:** `scripts/guard.py` bloqueia comandos destrutivos (force push, reset --hard main, rm -rf ~, --no-verify, gh repo delete, etc.).
- **Auto-merge:** se `slot.py auto-review` não achar `high`, abrir PR + mergear (squash + delete-branch).
- **Stop:** quando `plan-batch` ficar vazio OU contexto ≥ 70% OU decisão de produto necessária.

## Fluxo (loop)

```
while True:
  # 1. Pré-flight
  python scripts/slot.py preflight
  if dirty or branch != main: para e documenta motivo

  # 2. Próximo batch
  python scripts/slot.py plan-batch --max 3 --json
  if batch vazio: para — fim natural

  # 3. Disparar agentes em paralelo (isolation: "worktree" obrigatório)
  para cada slot do batch:
    Task(specialist, isolation="worktree", prompt=minimal+brief)

  # 4. Quando todos retornarem
  para cada slot do batch:
    python scripts/slot.py auto-review <ID> --json

    if high_count > 0:
      try fix (apenas dentro de files_allowed do slot)
      if fix não couber em files_allowed: anota como follow-up, segue
      commit + push

    if high_count == 0 ou foram resolvidos:
      gh pr create (com body derivado)
      gh pr merge --squash --delete-branch

    se merge der conflito:
      try resolve trivial (STATUS.md → sync, lock files → ours)
      se não trivial: deixa PR aberto, anota no log, segue

  # 5. Pós-batch
  python scripts/slot.py reconcile-merged --write
  python scripts/slot.py worktree-clean
  commit reconcile + push origin main

  # 6. Atualiza log
  appende batch ao docs/sessions/2026-05-12-night-autonomous.md

  # 7. Verifica contexto
  if contexto >= 70%: para — limite seguro
  else: continua
```

## Stop conditions explícitas

1. **`plan-batch` vazio** — esgotou disponíveis. Fim natural.
2. **Contexto ≥ 70%** — limite seguro. Para e documenta.
3. **Auto-review com `high` fora de `files_allowed`** — precisa de slot adicional. Anota e segue para próximo batch.
4. **Conflito de merge não-trivial** (algo além de STATUS.md ou lockfiles) — deixa PR aberto, segue.
5. **Agente reporta DoD ambígua** — anota como bloqueio, segue.
6. **Working tree dirty** após reconcile — segura, para, documenta.
7. **`gh` retorna erro de auth/rede** — segura, para, documenta.

## O que NÃO fazer

- ❌ Tocar em `docs/00-18-*.md` canônicos (a menos que slot explicitamente permita)
- ❌ Modificar `tasks/PROTOCOL.md` ou `tasks/STATUS.md` à mão (use `slot.py sync`)
- ❌ Criar slots novos (só executar existentes)
- ❌ Force push (guard bloqueia de qualquer jeito)
- ❌ Rebase main / reescrever história
- ❌ Mudar `.claude/agents/*` (já está estável)
- ❌ Mudar `scripts/slot.py` ou `scripts/guard.py`
- ❌ `npm install -g`
- ❌ Modificar `.env*`

## Session log

`docs/sessions/2026-05-12-night-autonomous.md` — appende após cada batch:

- Slot IDs + PR # + status (merged / open / blocked)
- Achados notáveis do auto-review
- Decisões tomadas (ex: deixou follow-up para Rogério)
- Tempo gasto / tokens estimados
- Próximo batch sugerido

## Mensagem de abertura ao Rogério (quando ele acordar)

Atualizar a sessão acima com um header tipo:

> ✅ N slots fechados (#PRs). Y bloqueios deixados como follow-up.
> Próximo batch sugerido: ...
> Custo estimado: ~Z mil tokens.

## Primeiros 3 slots esperados

Verificar com `plan-batch`. Esperados: F1-S16, F1-S19, F1-S23 (todos high, files_allowed disjuntos). Migration disponível: 0004.
