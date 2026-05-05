---
id: F0-S05
title: Web — dev server + tela de login placeholder
phase: F0
task_ref: T0.5
status: available
priority: medium
estimated_size: S
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F0-S01]
blocks: [F1-S08]
source_docs:
  - docs/12-tasks-tecnicas.md#T0.5
---

# F0-S05 — Frontend dev server + login placeholder

## Objetivo
`pnpm --filter @elemento/web dev` sobe Vite na 5173 com Tailwind ativo e uma tela `/login` minimalista (visualmente refinada — dark, tipografia editorial, sem inputs funcionais ainda).

## Escopo
- Rota `/login` em `apps/web/src/features/auth/LoginPage.tsx` com layout dark world-class (referências: Linear, Vercel).
- Componentes primitivos: `Button`, `Input`, `Label` em `apps/web/src/components/ui/`.
- Form que apenas marca `console.warn` no submit (lógica real virá em F1-S08).
- Atualizar `App.tsx` para mapear `/` → redirect `/login`.

## Fora de escopo
- Chamada real à API.
- Persistência de sessão.
- Refresh token.

## Arquivos permitidos
- `apps/web/src/features/auth/LoginPage.tsx`
- `apps/web/src/components/ui/*.tsx`
- `apps/web/src/lib/cn.ts`
- `apps/web/src/App.tsx`

## Definition of Done
- [ ] Dev server roda
- [ ] Tela `/login` renderiza com design refinado (dark, Inter, espaçamento generoso)
- [ ] Acessibilidade básica (labels, aria, contraste WCAG AA)
- [ ] `pnpm --filter @elemento/web build` passa
- [ ] PR com screenshot

## Validação
```powershell
pnpm --filter @elemento/web dev
pnpm --filter @elemento/web build
pnpm --filter @elemento/web typecheck
```
