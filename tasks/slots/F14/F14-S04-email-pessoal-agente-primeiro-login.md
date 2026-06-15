---
id: F14-S04
title: Email pessoal do agente no 1º login + bloqueio estendido
phase: F14
task_ref: null
status: in-progress
priority: medium
estimated_size: M
agent_id: null
claimed_at: 2026-06-15T18:00:10Z
completed_at: null
pr_url: null
depends_on: [F14-S02]
blocks: []
labels: []
source_docs:
  - docs/planejamento-2026-06-evolucao.md#a2-lead-pj-email-obrigatório-no-manual-unicidade-e-bloqueio-do-email-do-agente-item-4
  - docs/10-seguranca-permissoes.md
docs_required: true
docs_audience:
  - operador
docs_artifacts:
  - docs/help/guias/crm/primeiro-login-email-pessoal.mdx
---

# F14-S04 — Email pessoal do agente no 1º login + bloqueio estendido

## Objetivo

Cobrar do agente, no **primeiro login**, o cadastro do **email pessoal** dele — e incluí-lo na lista de emails bloqueados no cadastro de lead, garantindo que o agente não use o próprio email no lugar do email do cliente (decisão D3).

## Contexto

Item 4 / Épico A.2, decisão D3: além de bloquear o email corporativo (`users.email`, feito no F14-S02), o agente pode tentar usar o **email pessoal** no cadastro de lead. Para travar, o sistema cobra o email pessoal no 1º login e o adiciona à lista de bloqueio. Depende do F14-S02 (que já implementa o bloqueio base e o ponto de extensão no service de leads).

## Escopo (faz)

- Schema: `users.personal_email` (citext nullable) + migration (`0052_*` — confirmar próximo livre). Atualizar `db/schema/users.ts`.
- Backend `account`:
  - Endpoint `POST /api/account/personal-email` (ou `PATCH /api/account/profile`) para o agente cadastrar/atualizar o email pessoal — validação Zod + audit.
  - Expor no perfil (`GET /api/account/profile`) um flag `requires_personal_email` (true quando `personal_email IS NULL` e o papel exige — ex: agente).
- Backend `leads/service.ts`: **estender o bloqueio** (`isInternalEmail`) para considerar TAMBÉM `users.personal_email` da org (não só `users.email`).
- Frontend: **guard de 1º login** — quando `requires_personal_email`, exibir modal bloqueante (não-dispensável) cobrando o email pessoal antes de liberar o uso do sistema.
- Guia `docs/help/guias/crm/primeiro-login-email-pessoal.mdx`.

## Fora de escopo (NÃO faz)

- O bloqueio base de email corporativo (já em F14-S02).
- Disparo de simulação (F14-S05/S06).

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/db/schema/users.ts`
- `apps/api/src/db/migrations/0052_user_personal_email.sql`
- `apps/api/src/db/migrations/meta/_journal.json`
- `apps/api/src/modules/account/service.ts`
- `apps/api/src/modules/account/repository.ts`
- `apps/api/src/modules/account/schemas.ts`
- `apps/api/src/modules/account/routes.ts`
- `apps/api/src/modules/account/controller.ts`
- `apps/api/src/modules/account/__tests__/**`
- `apps/api/src/modules/leads/service.ts`
- `apps/api/src/modules/leads/repository.ts`
- `apps/web/src/features/account/**`
- `apps/web/src/App.tsx`
- `docs/help/guias/crm/primeiro-login-email-pessoal.mdx`

## Arquivos proibidos (`files_forbidden`)

- `packages/shared-schemas/src/leads.ts` (dono é F14-S02)
- `apps/web/src/features/crm/NewLeadModal.tsx` (dono é F14-S03)

## Contratos de saída

- `users.personal_email`; `GET /api/account/profile.requires_personal_email`; endpoint de cadastro.
- Bloqueio de email no lead passa a cobrir `users.email` + `users.personal_email`.

## Definition of Done

- [ ] Migration de `personal_email` aplicada
- [ ] Endpoint de cadastro do email pessoal (Zod + audit + RBAC do próprio usuário)
- [ ] 1º login força o cadastro (modal bloqueante) quando `requires_personal_email`
- [ ] `isInternalEmail` cobre `personal_email`
- [ ] Testes (account + leads bloqueio com personal_email) verdes
- [ ] `pnpm typecheck && lint && test` (api + web) verdes
- [ ] Guia criado

## Comandos de validação

```powershell
python scripts/slot.py check-migrations
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api test -- account
pnpm --filter @elemento/api test -- leads
pnpm --filter @elemento/web typecheck
```

## Notas para o agente

- ⚠️ Toca `leads/service.ts` e `leads/repository.ts` — **mesmos arquivos do F14-S02**. Por isso `depends_on: [F14-S02]` (sequencial, não paralelo).
- O guard de 1º login vive no roteador real (`App.tsx`) — ver memória `feedback_web_live_router_nav` (App.tsx é o roteador vivo; router.tsx/navigation.ts são órfãos).
- "Bloqueante" = o agente não consegue navegar/cadastrar leads até informar o email pessoal.
