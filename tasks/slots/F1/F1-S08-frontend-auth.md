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
  - docs/18-design-system.md
  - docs/design-system/index.html
---

# F1-S08 — Frontend auth + layout

## Objetivo

Login funcional contra `/api/auth/login`, refresh transparente via interceptor, layout autenticado com sidebar e topbar (placeholders nos itens), `useAuth()` expondo user + permissions.

## Escopo

- `lib/api.ts` — fetch wrapper com baseURL (env), credentials include, retry+refresh em 401.
- `features/auth/useAuth.ts` — Zustand store `{ user, accessToken, login, logout, hasPermission }`.
- `features/auth/LoginPage.tsx` — agora funcional (mantém o layout/visual já estabelecido em F0-S05; só pluga a chamada real).
- `app/AuthGuard.tsx` — redireciona pra `/login` se não autenticado.
- `app/AppLayout.tsx` — **sidebar + topbar seguindo o DS** (`docs/18-design-system.md`):
  - Sidebar com marca (estrela com gradient), seções `nav-label` em caption-style, `nav-link` com hover Lift sutil + indicador ativo verde com glow (igual ao HTML de referência).
  - Topbar com altura ≥56px, `border-bottom: var(--border)`, ações à direita (placeholder com avatar usando `--grad-rondonia`).
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
- [ ] Sidebar/topbar seguem `docs/18-design-system.md` (Lift no hover, indicador ativo verde, marca em SVG inline)
- [ ] Theme toggle no topbar funcional, persistência mantida
- [ ] PR com screenshot/recording em ambos os temas
