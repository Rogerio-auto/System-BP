---
id: F8-S01
title: Backend CRUD agents + agent_cities (admin)
phase: F8
task_ref: F8.1
status: in-progress
priority: high
estimated_size: M
agent_id: backend-engineer
claimed_at: 2026-05-15T19:27:54Z
completed_at:
pr_url:
depends_on: [F1-S04, F1-S05, F1-S07]
blocks: [F8-S04]
labels: []
source_docs:
  - docs/05-modulos-funcionais.md
  - docs/10-seguranca-permissoes.md
  - docs/12-tasks-tecnicas.md
---

# F8-S01 — Backend CRUD agents + agent_cities

## Objetivo

Expor endpoints admin para gerir os agentes de crédito (atendentes humanos do Banco do Povo)
e suas atribuições a cidades. O schema `agents` + `agent_cities` já existe (F1-S05) mas não
há rotas/serviços — agentes só podem ser criados via SQL hoje.

Sem esses endpoints, F8-S04 (frontend) é impossível e o time não consegue cadastrar novos
atendentes sem acesso ao banco.

## Escopo

Módulo `apps/api/src/modules/agents/` espelhando o padrão de `users/` e `cities/`.

### Endpoints (base `/api/admin/agents`)

Todas exigem `authenticate()` + `authorize({ permissions: ['agents:admin'] })` —
adicionar a permissão `agents:admin` ao seed de roles `admin` em F1-S01.

- `GET /api/admin/agents` — lista paginada com filtros: `cityId`, `isActive`, `q` (busca por
  `display_name` via trgm), `limit/cursor`. Resposta inclui contagem de cidades e nome da
  cidade primária para cada agente (join em `agent_cities`).
- `POST /api/admin/agents` — cria agente. Body: `{ displayName, phone?, userId?, cityIds: string[], primaryCityId? }`.
  Valida que `userId`, se presente, pertence à org. Cria `agents` + N `agent_cities` em
  transação. Emite evento `agent.created` via outbox.
- `PATCH /api/admin/agents/:id` — atualiza `displayName`, `phone`, `userId`, `isActive`.
- `POST /api/admin/agents/:id/deactivate` — soft-delete (preserva FK em `leads.agent_id`).
- `POST /api/admin/agents/:id/reactivate`.
- `PUT /api/admin/agents/:id/cities` — substitui o conjunto de `agent_cities` atomicamente.
  Body: `{ cityIds: string[], primaryCityId?: string }`. Garante invariante "1
  `is_primary` por agente" via transação.

### Regras de validação

- `display_name` obrigatório, 2-120 chars.
- `phone` opcional, E.164 (usa helper `normalizePhone` de F1-S10).
- Pelo menos 1 cidade obrigatória ao criar.
- `primaryCityId` deve estar em `cityIds`.
- Não permite desativar o último agente ativo de uma cidade que tem leads `new`/`qualifying`
  → retornar 409 com mensagem clara.

### Audit log

Toda mutação (`create`, `update`, `deactivate`, `reactivate`, `setCities`) registra linha
em `audit_logs` com `actor_user_id`, `entity='agent'`, `entity_id`, `action`, `diff`.

### Eventos (outbox)

- `agent.created`
- `agent.updated`
- `agent.deactivated`
- `agent.reactivated`
- `agent.cities_changed`

Payload sem PII: apenas IDs + `display_name` (não é PII de cidadão; é colaborador) + cidades.

### City scope

`list` aplica filtro automático: usuários com role `scope=city` só veem agentes cujas
cidades intersectem suas `user_city_scopes`. Endpoints de mutação exigem que admin tenha
escopo na cidade primária do agente alvo.

## Arquivos permitidos

- `apps/api/src/modules/agents/routes.ts`
- `apps/api/src/modules/agents/controller.ts`
- `apps/api/src/modules/agents/service.ts`
- `apps/api/src/modules/agents/repository.ts`
- `apps/api/src/modules/agents/schemas.ts`
- `apps/api/src/modules/agents/__tests__/routes.test.ts`
- `apps/api/src/modules/agents/__tests__/service.test.ts`
- `apps/api/src/app.ts` (registrar plugin)
- `apps/api/src/events/types.ts` (adicionar eventos novos)
- `apps/api/src/db/migrations/0014_seed_agents_permission.sql` (seed `agents:admin`)
- `docs/04-eventos.md` (registrar eventos novos)

## Definition of Done

- [ ] 7 endpoints existem com validação Zod e response schema.
- [ ] Permissão `agents:admin` criada e atribuída à role `admin` no seed/migration.
- [ ] Invariante "1 `is_primary` por agente" garantida via transação.
- [ ] Bloqueio de desativação do último agente ativo de cidade com leads abertos (409).
- [ ] City scope aplicado em `list` e mutações (testes provam).
- [ ] Audit logs gerados em todas as mutações.
- [ ] Eventos `agent.*` emitidos via outbox, sem PII bruta.
- [ ] Tests cobrem positivo + negativo (cidade inexistente, user de outra org, duplicate
      `is_primary`, scope violation).
- [ ] `pnpm --filter @elemento/api typecheck && lint && test` verdes.
- [ ] PR aberto.

## Validação

```powershell
pnpm --filter @elemento/api db:migrate
pnpm --filter @elemento/api test -- agents
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api typecheck
```
