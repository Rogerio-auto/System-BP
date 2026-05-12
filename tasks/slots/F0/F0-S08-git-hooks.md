---
id: F0-S08
title: Husky + lint-staged + commitlint
phase: F0
task_ref: T0.1
status: done
priority: low
estimated_size: XS
agent_id: backend-engineer
claimed_at: 2026-05-11T00:00:00Z
completed_at: 2026-05-11T00:30:00Z
pr_url: null
depends_on: [F0-S02]
blocks: []
source_docs:
  - docs/12-tasks-tecnicas.md#T0.1
---

# F0-S08 — Git hooks

## Objetivo

Pre-commit roda lint-staged + typecheck rápido. Commit-msg valida Conventional Commits.

## Escopo

- Instalar `husky`, `lint-staged`, `@commitlint/cli`, `@commitlint/config-conventional`.
- `.husky/pre-commit` → `pnpm lint-staged`.
- `.husky/commit-msg` → `commitlint --edit`.
- `commitlint.config.cjs`.
- Bloco `lint-staged` no `package.json` raiz com prettier + eslint sobre arquivos staged.

## Definition of Done

- [x] Hooks rodam em commit local
- [x] Mensagem fora do padrão é rejeitada
- [ ] PR aberto
