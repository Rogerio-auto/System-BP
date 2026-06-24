---
id: F23-S12
title: Auth — expõe escopo do usuário no payload + scope toggle preciso em /relatorios
phase: F23
task_ref: docs/planejamento-relatorios-metricas.md
status: in-progress
priority: medium
estimated_size: M
agent_id: null
claimed_at: 2026-06-24T20:22:59Z
completed_at: null
pr_url: null
depends_on: [F23-S06]
blocks: []
labels: [backend, frontend, auth, reports, rbac]
source_docs: [docs/planejamento-relatorios-metricas.md, docs/10-seguranca-permissoes.md]
docs_required: false
---

# F23-S12 — Escopo do usuário no payload de auth + scope toggle preciso

## Objetivo

Fechar o follow-up #1 da F23: o frontend não sabe se o usuário é global (admin/gestor_geral)
ou city-scoped (gestor_regional/leitura) porque o payload de auth não expõe `cityScopeIds`.
Hoje o scope toggle de `/relatorios` infere por permissão (heurística) e mostra um escopo
"Consolidado/global" impreciso para o gestor_regional (o backend rejeita — sem furo de
segurança, mas é defeito de UX). Expor o escopo real e usar no toggle.

## Contexto

`request.user.cityScopeIds` (null = global; [] = nenhuma; [...] = cidades) já é carregado em
`apps/api/src/modules/auth/middlewares/user-context.repository.ts` e tipado em
`apps/api/src/shared/fastify.d.ts`. Falta apenas serializá-lo no payload de login/refresh e
consumi-lo no front. Mudança cross-cutting (auth) — contrato Zod compartilhado é o elo.

## Escopo (faz)

### Backend

- `packages/shared-schemas/src/auth.ts`: adicionar `city_scope_ids: z.array(z.string().uuid()).nullable()`
  ao `user` de `loginResponseSchema` E `refreshResponseSchema`.
- `apps/api/src/modules/auth/service.ts`: incluir `cityScopeIds: string[] | null` no `user` de
  `LoginResultOk` e `RefreshResult` (carregar do mesmo contexto que já resolve permissions —
  reusar o carregamento de city scope existente; não duplicar query se já disponível no fluxo).
- `apps/api/src/modules/auth/controller.ts`: incluir `city_scope_ids` nas respostas de
  login, verify-2fa e refresh.

### Frontend

- `apps/web/src/lib/auth-store.ts`: adicionar `cityScopeIds: string[] | null` à interface `AuthUser`.
- `apps/web/src/features/auth/useAuth.ts`: mapear `city_scope_ids` → `cityScopeIds` em `mapResponseToUser`.
- `apps/web/src/features/relatorios/RelatoriosPage.tsx`: `inferAvailableScopes`/`inferDefaultScope`
  passam a receber `cityScopeIds` e decidem com precisão:
  - tem `dashboard:read` + `cityScopeIds === null` (global) → `['global','city']`, default `global`.
  - tem `dashboard:read` + city-scoped (`cityScopeIds` array) → `['city']`, default `city` (sem global, sem self).
  - só `dashboard:read_by_agent` → `['self']`, default `self`.
- Ajustar `ReportFiltersBar` se necessário para refletir os escopos corretos (sem mudar a regra
  de só mostrar o toggle quando há >1 escopo).

## Fora de escopo (NÃO faz)

- Criar endpoint /me novo (não é necessário — login/refresh bastam).
- Mudar a lógica de escopo do BACKEND dos endpoints de reports (já correta; backend é a fronteira).
- Os 3 findings MÉDIO de segurança (follow-up separado).

## Arquivos permitidos

- `packages/shared-schemas/src/auth.ts`
- `apps/api/src/modules/auth/service.ts`
- `apps/api/src/modules/auth/controller.ts`
- `apps/api/src/modules/auth/__tests__/`
- `apps/web/src/lib/auth-store.ts`
- `apps/web/src/features/auth/useAuth.ts`
- `apps/web/src/features/relatorios/RelatoriosPage.tsx`
- `apps/web/src/features/relatorios/components/ReportFiltersBar.tsx`

## Arquivos proibidos

- `apps/api/src/modules/reports/**`
- `apps/api/src/modules/auth/middlewares/**`
- `apps/api/src/db/migrations/**`

## Contratos de saída

- Login/verify-2fa/refresh retornam `user.city_scope_ids` (null ou array de uuid), validado por Zod.
- `AuthUser` no front tem `cityScopeIds`; populado no login.
- Scope toggle: admin/gestor_geral veem Consolidado+Cidade; gestor_regional vê só Cidade (sem
  Consolidado); agente vê só "Meus dados". Nada de opção que o backend rejeitaria.
- `pnpm --filter @elemento/api typecheck`+`lint`+`test` e `@elemento/web` idem verdes.

## Definition of Done

- [ ] `city_scope_ids` no schema Zod de login e refresh + serializado no controller (3 respostas)
- [ ] `cityScopeIds` no `LoginResultOk`/`RefreshResult` (sem query duplicada)
- [ ] `AuthUser` + `mapResponseToUser` consomem `cityScopeIds`
- [ ] Scope toggle preciso por escopo real (admin/gestor_geral/gestor_regional/agente)
- [ ] Teste do payload de login incluindo `city_scope_ids` (global=null e city=array)
- [ ] typecheck/lint/test verdes em api e web

## Validação

```powershell
pnpm --filter @elemento/shared-schemas build
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test
```

## Notas para o agente

- Contrato Zod compartilhado é o elo front×API — front consome o MESMO schema (sem drift).
- `cityScopeIds` é dado de autorização (não PII de cidadão) — pode ir no payload.
- Não enfraquecer a regra de escopo do backend; isto é só UX/contrato. O backend continua a
  fronteira de segurança real.
