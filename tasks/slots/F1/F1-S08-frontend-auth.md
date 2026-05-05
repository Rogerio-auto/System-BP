---
id: F1-S08
title: Frontend — login real + hook useAuth + layout autenticado
phase: F1
task_ref: T1.4
status: blocked
priority: critical
estimated_size: L
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F1-S03, F0-S05]
blocks: [F1-S12]
source_docs:
  - docs/12-tasks-tecnicas.md#T1.4
---

# F1-S08 — Frontend auth + layout

## Objetivo
Login funcional contra `/api/auth/login`, refresh transparente via interceptor, layout autenticado com sidebar e topbar (placeholders nos itens), `useAuth()` expondo user + permissions.

## Escopo
- `lib/api.ts` — fetch wrapper com baseURL (env), credentials include, retry+refresh em 401.
- `features/auth/useAuth.ts` — Zustand store `{ user, accessToken, login, logout, hasPermission }`.
- `features/auth/LoginPage.tsx` — agora funcional.
- `app/AuthGuard.tsx` — redireciona pra `/login` se não autenticado.
- `app/AppLayout.tsx` — sidebar + topbar (sem itens reais ainda).
- Persistência de access em memória apenas; refresh é cookie httpOnly.

## Arquivos permitidos
- `apps/web/src/features/auth/**`
- `apps/web/src/lib/api.ts`
- `apps/web/src/app/**`
- `apps/web/src/components/ui/*`

## Definition of Done
- [ ] Login real funciona
- [ ] Refresh transparente (não desloga em 401 recuperável)
- [ ] Logout limpa state e cookie
- [ ] PR com screenshot/recording
