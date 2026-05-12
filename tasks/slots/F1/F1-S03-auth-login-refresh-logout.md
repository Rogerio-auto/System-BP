---
id: F1-S03
title: Auth — login, refresh, logout
phase: F1
task_ref: T1.2
status: done
priority: critical
estimated_size: L
agent_id: claude-code
claimed_at: 2026-05-12T03:12:47Z
completed_at: 2026-05-12T03:30:10Z
pr_url: null
depends_on: [F1-S01, F1-S02]
blocks: [F1-S04, F1-S08]
source_docs:
  - docs/02-arquitetura-sistema.md
  - docs/10-seguranca-permissoes.md
  - docs/12-tasks-tecnicas.md#T1.2
---

# F1-S03 — Auth (login, refresh, logout)

## Objetivo

Endpoints `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout` totalmente funcionais com bcrypt, JWT (jose), refresh em cookie httpOnly + CSRF token, rate-limit, audit log.

## Escopo

- Módulo `apps/api/src/modules/auth/` seguindo o padrão (routes/controller/service/repository/schemas).
- Schemas Zod compartilhados em `packages/shared-schemas/src/auth.ts`.
- `bcryptjs` cost 12.
- JWT access ~15min, refresh ~30d, secrets vindos de `env.ts`.
- Refresh rotativo: cada `/refresh` invalida o anterior em `user_sessions`.
- Rate-limit: 5 tentativas/min por IP+email.
- Helper `passwordHash`, `passwordVerify` em `shared/password.ts`.
- Helper `signAccessToken`, `verifyAccessToken` em `shared/jwt.ts`.
- Testes:
  - Login com credenciais corretas/incorretas
  - Refresh válido e inválido
  - Logout invalida refresh
  - Rate-limit dispara após 5 tentativas

## Fora de escopo

- Middleware `authenticate` (F1-S04).
- 2FA (pós-MVP).
- Recuperação de senha (slot futuro).

## Arquivos permitidos

- `apps/api/src/modules/auth/**`
- `apps/api/src/shared/password.ts`
- `apps/api/src/shared/jwt.ts`
- `packages/shared-schemas/src/auth.ts`
- `packages/shared-schemas/src/index.ts` (apenas re-export)

## Contratos de saída (rotas)

- `POST /api/auth/login` body `{ email, password }` → `{ access_token, expires_in, user }` + cookie `refresh_token` httpOnly + cookie `csrf_token`.
- `POST /api/auth/refresh` (cookie + header `X-CSRF`) → novo access token.
- `POST /api/auth/logout` (auth) → 204.

## Definition of Done

- [ ] Todos os testes passam
- [ ] Audit log registra login/logout/login_failed
- [ ] Cookies marcados `Secure` em produção
- [ ] CSRF validado no `/refresh`
- [ ] Rate-limit testado
- [ ] PR aberto
