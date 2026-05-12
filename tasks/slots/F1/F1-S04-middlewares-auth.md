---
id: F1-S04
title: Middlewares authenticate + authorize com escopo de cidade
phase: F1
task_ref: T1.3
status: available
priority: critical
estimated_size: M
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F1-S03]
blocks: [F1-S07, F1-S09, F1-S11, F1-S13]
source_docs:
  - docs/10-seguranca-permissoes.md
  - docs/12-tasks-tecnicas.md#T1.3
---

# F1-S04 — Middlewares authenticate + authorize

## Objetivo

Decoradores Fastify `authenticate()` e `authorize({ permissions, scope })` que toda rota protegida usa. Repository helpers para injetar filtro de cidade automaticamente.

## Escopo

- `apps/api/src/modules/auth/middlewares/authenticate.ts` — valida JWT, popula `request.user` com `{ id, organization_id, role, city_scope_ids[] }`.
- `apps/api/src/modules/auth/middlewares/authorize.ts` — valida que `request.user` tem todas as permissões pedidas.
- `apps/api/src/shared/scope.ts` — helper `applyCityScope(qb, request.user, columnRef)` para repositories.
- Convenção de tipagem: `FastifyRequest['user']` declarado via module augmentation.
- Testes: 401 sem token, 401 token inválido, 403 sem permissão, 404 fora de escopo (não vaza existência).

## Arquivos permitidos

- `apps/api/src/modules/auth/middlewares/**`
- `apps/api/src/shared/scope.ts`
- `apps/api/src/shared/fastify.d.ts` (augmentation)

## Contratos de saída

```ts
// Uso em rotas:
app.get('/leads', { preHandler: [authenticate(), authorize({ permissions: ['leads:read'], scope: 'city' })] }, ...)
```

## Definition of Done

- [ ] Testes positivos e negativos cobrem 401/403/404
- [ ] `request.user` tipado corretamente
- [ ] `applyCityScope` testado com role admin (bypass) e role agente (filtra)
- [ ] PR aberto
