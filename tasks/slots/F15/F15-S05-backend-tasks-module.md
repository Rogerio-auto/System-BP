---
id: F15-S05
title: Backend — módulo de tarefas (CRUD + assumir + concluir + "minhas tarefas")
phase: F15
task_ref: null
status: review
priority: high
estimated_size: M
agent_id: null
claimed_at: 2026-06-15T20:09:14Z
completed_at: 2026-06-15T20:28:17Z
pr_url: null
depends_on: [F15-S01, F15-S03, F15-S04]
blocks: [F15-S08, F15-S10]
labels: [tasks, backend, rbac]
docs_required: true
docs_artifacts:
  - docs/help/guias/tarefas/fila-de-tarefas.mdx
source_docs:
  - docs/planejamento-2026-06-evolucao.md#f2-role-de-cobrança-dashboard-status-spc-item-9
  - docs/10-seguranca-permissoes.md
  - docs/04-eventos.md
---

# F15-S05 — Backend módulo `tasks`

## Objetivo

Expor a API de tarefas com resolução de "minhas tarefas" por **role + cidade** (via `user_city_scopes`), incluindo assumir (`claim`) e concluir, com RBAC, auditoria e idempotência.

## Contexto

Item 9 / Épico F.2d. Uma tarefa pertence ao `assignee_role` dentro de uma `city_id` (ou global). Um usuário a vê quando tem o role **e** (a tarefa é global **ou** a `city_id` está no seu `user_city_scopes`) — mesma lógica de city-scope já aplicada nas rotas (regra #3). Persiste visível até `done`.

## Escopo (faz)

- Módulo `apps/api/src/modules/tasks/` no padrão do projeto: `routes.ts`, `controller.ts`, `service.ts`, `repository.ts`, `schemas.ts`, `index.ts`, `__tests__/`.
- Endpoints: `GET /api/tasks` (minhas tarefas — filtra por role+city do usuário), `POST /api/tasks` (criar — uso interno/sistema também), `POST /api/tasks/:id/claim` (`claimed_by`), `POST /api/tasks/:id/complete`, `POST /api/tasks/:id/cancel`.
- `applyCityScope` na resolução; RBAC com `tasks:read`/`tasks:write`/`tasks:claim`/`tasks:complete`.
- Audit log nas mutações; `Idempotency-Key` em create/complete (regra #7).
- Emitir evento `task.created` via outbox (consumido por F15-S08 para notificar).
- Registrar a rota em `apps/api/src/app.ts`.

## Fora de escopo (NÃO faz)

- Fan-out de notificação (F15-S06) e worker 15d (F15-S08).
- UI (F15-S10).

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/modules/tasks/**`
- `apps/api/src/app.ts`
- `apps/api/src/events/types.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/modules/notifications/**`
- `apps/api/src/db/schema/**`

## Contratos de entrada

- Tabela `tasks` (F15-S03), contratos Zod (F15-S04), permissões (F15-S01).

## Contratos de saída

- API de tarefas + evento `task.created` no outbox.

## Definition of Done

- [ ] Resolução role+city testada (positivo: vê tarefa da sua cidade/global; negativo: não vê de outra cidade)
- [ ] `claim`/`complete` com audit + idempotência
- [ ] RBAC negativo testado (role sem permissão → 403)
- [ ] Evento `task.created` emitido via outbox (sem PII bruta)
- [ ] `pnpm --filter @elemento/api typecheck && lint && test` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- tasks
```

## Notas para o agente

- Espelhe a estrutura de um módulo recente (`billing`/`followup`) para controller/service/repository.
- `app.ts` e `events/types.ts` são compartilhados com F15-S06/S08 — este slot roda antes deles (ver `depends_on`); não rode em paralelo.
- Não invente colunas — use exatamente o schema de F15-S03.
