---
id: F0-S02
title: ESLint + Prettier — instalar e ligar nos workspaces
phase: F0
task_ref: T0.1
status: done
priority: high
estimated_size: S
agent_id: claude-opus-4-7
claimed_at: 2026-05-11T00:00:00Z
completed_at: 2026-05-11T12:26:00Z
completed_at: null
pr_url: null
depends_on: [F0-S01]
blocks: []
source_docs:
  - docs/12-tasks-tecnicas.md#T0.1
---

# F0-S02 — ESLint + Prettier nos workspaces

## Objetivo

`pnpm lint` rodando em todos os apps e packages com config compartilhada de `@elemento/eslint-config`, sem warnings.

## Escopo

- Instalar `eslint`, `eslint-import-resolver-typescript` no root.
- Em `apps/api`, `apps/web`, `packages/shared-types`, `packages/shared-schemas`: criar `eslint.config.js` (flat config) que estende `@elemento/eslint-config`.
- Verificar que `pnpm turbo run lint` passa em todos.
- `prettier --check .` no root passa.

## Fora de escopo

- Adicionar regras novas além das já em `@elemento/eslint-config/index.cjs`.
- Linting do Python (já configurado via ruff em `pyproject.toml`).

## Arquivos permitidos

- `eslint.config.js` em cada workspace.
- `package.json` para adicionar dependências de lint apenas onde necessário.
- `packages/eslint-config/index.cjs` (apenas para portar para flat se necessário).

## Definition of Done

- [ ] `pnpm turbo run lint` verde
- [ ] `pnpm format:check` verde
- [ ] CI roda lint em PR
- [ ] PR aberto

## Validação

```powershell
pnpm turbo run lint
pnpm format:check
```
