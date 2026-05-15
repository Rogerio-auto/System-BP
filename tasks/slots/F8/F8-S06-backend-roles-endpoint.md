---
id: F8-S06
title: Backend — GET /api/admin/roles + roles na listagem de usuários
phase: F8
task_ref: F8.6
status: in-progress
priority: high
estimated_size: S
agent_id: backend-engineer
claimed_at: 2026-05-15T20:14:55Z
completed_at:
pr_url:
depends_on: []
blocks: []
labels: []
source_docs:
  - docs/10-seguranca-permissoes.md
  - docs/05-modulos-funcionais.md
---

# F8-S06 — Backend roles endpoint + roles na listagem de usuários

## Contexto (gap descoberto em F8-S02)

A tela de gestão de usuários (`/admin/users`, F8-S02) foi entregue, mas o agente
reportou dois gaps no backend de usuários (F1-S07) que deixam a parte de **roles**
da tela cega:

1. **Não existe `GET /api/admin/roles`.** O `UserRoleSelect` (multi-select para
   atribuir roles a um usuário) não tem de onde listar as roles disponíveis da
   organização. Ficou com fallback de array vazio → o operador não consegue escolher
   roles na UI.
2. **`GET /api/admin/users` não retorna as roles de cada usuário.** A coluna "Roles"
   da tabela de usuários exibe `—` (placeholder) porque o `userResponseSchema` não
   inclui esse dado.

F8-S02 é frontend puro — não podia resolver. Este slot fecha o gap no backend.

## Objetivo

Expor no backend os dados de roles que a tela de usuários precisa:

- listar as roles disponíveis da organização;
- incluir as roles de cada usuário na resposta de listagem.

## Escopo

### 1. `GET /api/admin/roles`

Novo endpoint (ou novo módulo `modules/roles/` se fizer sentido — decisão do engenheiro;
o mais simples é adicionar ao módulo `users/` já que é consumido pela gestão de usuários,
mas roles é uma entidade própria — avalie e justifique no PR).

- `authenticate()` + `authorize({ permissions: ['users:admin'] })`.
- Retorna as roles da organização: `{ id, key, name, scope, description? }` por role.
- `scope` é `global` ou `city` (doc 10 §3.1).
- Sem paginação (poucas roles por org). Ordenar por `name` ou `key`.

### 2. Roles na listagem de usuários

Estender `GET /api/admin/users` para que cada usuário na resposta inclua suas roles.

- Adicionar campo `roles: Array<{ id, key, name }>` ao item de usuário.
- Resolver via JOIN `user_roles → roles` no repository (sem N+1 — uma query agregada
  ou um JOIN com agregação).
- Atualizar o `userResponseSchema` (response Zod) coerentemente.
- **Não quebrar o contrato existente** — F8-S02 já consome a listagem; adicionar campo
  é compatível, mas confira os testes de F1-S07 (`modules/users/__tests__/`).

### Permissão / city scope

- Reusar `users:admin` (já existe). Não criar permissão nova → **sem migration**.
- City scope: roles são globais por organização — listar todas as roles da org do
  usuário autenticado, sem filtro de cidade.

### Audit

- `GET` não muta nada — sem audit log (consistente com os outros GETs do módulo).

## Arquivos permitidos

- `apps/api/src/modules/users/routes.ts`
- `apps/api/src/modules/users/controller.ts`
- `apps/api/src/modules/users/service.ts`
- `apps/api/src/modules/users/repository.ts`
- `apps/api/src/modules/users/schemas.ts`
- `apps/api/src/modules/users/__tests__/routes.test.ts`
- `apps/api/src/modules/users/__tests__/service.test.ts`
- `apps/api/src/modules/roles/**` (se optar por módulo dedicado — criar)
- `apps/api/src/app.ts` (só se criar módulo `roles/` novo a registrar)

> Nenhuma migration neste slot — `users:admin` já existe. Se você concluir que precisa
> de migration, pare e reporte (provavelmente não precisa).

## Definition of Done

- [ ] `GET /api/admin/roles` retorna as roles da org com `{ id, key, name, scope }`.
- [ ] `GET /api/admin/users` inclui `roles[]` em cada usuário (sem N+1).
- [ ] `userResponseSchema` atualizado; contrato compatível com F8-S02 (campo adicionado,
      nada removido/renomeado).
- [ ] Testes de F1-S07 existentes continuam verdes (não quebrar contrato).
- [ ] Novos testes: `GET /roles` (positivo + 403 sem permissão); listagem de usuários
      inclui roles corretas.
- [ ] `pnpm --filter @elemento/api typecheck && lint && test` verdes (typecheck pode ter
      erro pré-existente de `anonymizedAt`/Fastify — reportar, não arrumar).
- [ ] PR aberto.

## Validação

```powershell
pnpm --filter @elemento/api test -- users
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api typecheck
```
