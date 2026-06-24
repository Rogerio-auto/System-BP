---
id: F23-S02
title: RBAC — permissão reports:export e billing:read escopado para gestor_regional
phase: F23
task_ref: docs/planejamento-relatorios-metricas.md
status: review
priority: high
estimated_size: S
agent_id: null
claimed_at: 2026-06-24T00:48:24Z
completed_at: 2026-06-24T01:15:47Z
pr_url: null
depends_on: []
blocks: []
labels: [backend, db, rbac, security, reports]
source_docs: [docs/planejamento-relatorios-metricas.md, docs/10-seguranca-permissoes.md]
docs_required: false
---

# F23-S02 — RBAC: permissão de export + cobrança regional escopada

## Objetivo

Ajustar o catálogo de permissões para a página de relatórios, conforme decisões travadas
no plano (§10): (D2) `gestor_regional` passa a ver cobrança **da própria cidade**; e nova
permissão `reports:export` para gating de exportação.

## Contexto

Plano `docs/planejamento-relatorios-metricas.md` §3/§8/§10. Hoje `billing:read` é só
admin/gestor_geral/cobranca. A propagação de `cityScopeIds` no dashboard de cobrança já foi
corrigida em F22-S01 (SEC-03) — então conceder `billing:read` a `gestor_regional` resulta
automaticamente em visão **city-scoped** (não regredir isso). Próxima migration livre após
F23-S01: usar o próximo número disponível (`0072` se F23-S01 ocupou `0071`).

## Escopo (faz)

- Migration de seed de permissões (`00XX_seed_reports_permissions.sql` + entry no journal):
  - Inserir permissão `reports:export` ("Exportar relatórios") no catálogo.
  - Conceder `reports:export` a admin, gestor_geral, gestor_regional (idempotente, `ON CONFLICT DO NOTHING`).
  - Conceder `billing:read` a `gestor_regional` (D2) — escopo de cidade aplicado pelo repository.
- Refletir as mesmas concessões em `apps/api/scripts/seed.ts` (catálogo canônico) para que
  um seed limpo nasça consistente com a migration.
- Garantir (via teste) que `gestor_regional` com `billing:read` só enxerga agregados de
  cobrança das cidades em `user_city_scopes` (reusa o filtro já existente).

## Fora de escopo (NÃO faz)

- Endpoints de relatório (F23-S03+).
- UI (F23-S06+).
- Tornar `cobranca` city-scoped (continua global — não mexer).
- Permissão guarda-chuva `reports:read` (decisão: gating granular reusando dashboard:read/billing:read/etc).

## Arquivos permitidos

- `apps/api/src/db/migrations/0072_seed_reports_permissions.sql`
- `apps/api/src/db/migrations/meta/_journal.json`
- `apps/api/scripts/seed.ts`
- `apps/api/src/db/seed/permissions.ts`
- `apps/api/src/modules/dashboard/__tests__/collection-scope.test.ts`

## Arquivos proibidos

- `apps/web/**`
- `apps/api/src/modules/dashboard/service.ts`
- `apps/api/src/modules/dashboard/repository.ts`
- `apps/api/src/shared/scope.ts`

## Contratos de saída

- Permissão `reports:export` existe e está concedida a admin/gestor_geral/gestor_regional.
- `gestor_regional` tem `billing:read`; ao consultar cobrança, vê apenas suas cidades (teste prova isolamento).
- Seed limpo (`seed.ts`) e migration produzem o mesmo estado (sem divergência).
- `check-migrations` verde.

## Definition of Done

- [ ] Migration de permissões + entry no journal; `check-migrations` verde
- [ ] `reports:export` no catálogo + concessões idempotentes
- [ ] `billing:read` concedido a `gestor_regional`
- [ ] `seed.ts` e `permissions.ts` espelham as concessões
- [ ] Teste: gestor_regional não vê cobrança de cidade fora do escopo
- [ ] `pnpm --filter @elemento/api typecheck` + `lint` verdes
- [ ] Checklist LGPD §14.2 na descrição do PR (toca RBAC/escopo)

## Validação

```powershell
python scripts/slot.py check-migrations
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
```

## Notas para o agente

- Idempotência nas concessões (`ON CONFLICT DO NOTHING`) — migrations rodam em DBs já populados.
- NÃO alterar a lógica de escopo; só conceder a permissão e provar via teste que o filtro existente cobre.
- `cobranca` permanece global; só `gestor_regional` ganha o recorte de cidade.
