---
id: F15-S01
title: Schema — role `cobranca` global + permissões de cobrança/tarefas/notificações
phase: F15
task_ref: null
status: available
priority: high
estimated_size: S
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: []
blocks: [F15-S05, F15-S06, F15-S07, F15-S09]
labels: [rbac, cobranca, schema]
source_docs:
  - docs/planejamento-2026-06-evolucao.md#f2-role-de-cobrança-dashboard-status-spc-item-9
  - docs/10-seguranca-permissoes.md
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F15-S01 — Schema role `cobranca` + permissões

## Objetivo

Criar o role `cobranca` (escopo **global**, decisão D11) e semear as novas permissões da fundação de cobrança, sem ainda nenhum endpoint as consumindo.

## Contexto

Item 9 / Épico F.2. O departamento de cobrança precisa de um papel próprio com visão centralizada da carteira (não city-scoped). As permissões aqui semeadas são o contrato de autorização que os slots de backend (tarefas, notificações, SPC, dashboard) vão exigir. `roles`/`permissions`/`role_permissions` já existem; adicionar role é precedente conhecido (doc 10 §3.1).

## Escopo (faz)

- Migration de seed (`0056_seed_cobranca_role_permissions.sql`) que insere:
  - Role `cobranca` (key canônica, escopo global — sem `city_scope` obrigatório).
  - Permissões: `billing:read`, `billing:reconcile`, `spc:read`, `spc:manage`, `tasks:read`, `tasks:write`, `tasks:claim`, `tasks:complete`, `notifications:read`.
  - Vínculos `role_permissions` do role `cobranca` para todas acima; conceder `tasks:*`/`notifications:read` também a `admin`/`gestor_geral` conforme o padrão dos seeds existentes (espelhar `0020_seed_dashboard_permission.sql`).
- Atualizar o catálogo TS de permissões/seed em `apps/api/src/db/seed/permissions.ts` para refletir as novas keys (fonte de verdade do seed idempotente).
- Atualizar `meta/_journal.json` com a nova migration.

## Fora de escopo (NÃO faz)

- Qualquer endpoint, service ou middleware que use as permissões (slots F15-S05..S09).
- Tabelas `tasks`/`notifications` (F15-S03) e `customers.spc_status` (F15-S02).

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/db/migrations/0056_seed_cobranca_role_permissions.sql`
- `apps/api/src/db/migrations/meta/_journal.json`
- `apps/api/src/db/seed/permissions.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/db/schema/index.ts` (F15-S03 é dono)
- `apps/api/src/app.ts`

## Contratos de saída

- Role `cobranca` e as 9 permissões existem e são idempotentemente semeáveis. Slots downstream podem referenciar as keys com segurança.

## Definition of Done

- [ ] Migration cria role + permissões + vínculos de forma idempotente (`ON CONFLICT DO NOTHING`)
- [ ] `apps/api/src/db/seed/permissions.ts` lista as novas keys
- [ ] `pnpm --filter @elemento/api db:migrate` aplica limpo num DB já existente (regressão do runner F12-S11)
- [ ] `python scripts/slot.py check-migrations` OK
- [ ] `pnpm --filter @elemento/api typecheck` verde

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
python scripts/slot.py check-migrations
```

## Notas para o agente

- Confirme o próximo número de migration livre com `check-migrations` antes de criar o `.sql` — F14-S04 está rodando em paralelo e pode pegar 0055. Use o primeiro livre ≥ 0056.
- Siga exatamente o padrão dos seeds `0017`..`0033` (mesmo estilo de `INSERT ... ON CONFLICT`).
- Role `cobranca` é **global**: não force `city_scope`. A resolução city-scope das tarefas é via `user_city_scopes` (ver F15-S05).
