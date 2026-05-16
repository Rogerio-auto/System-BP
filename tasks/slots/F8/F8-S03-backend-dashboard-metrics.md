---
id: F8-S03
title: Backend endpoint /api/dashboard/metrics (KPIs agregados)
phase: F8
task_ref: F8.3
status: review
priority: medium
estimated_size: M
agent_id: backend-engineer
claimed_at: 2026-05-16T14:38:11Z
completed_at: 2026-05-16T14:49:36Z
pr_url:
depends_on: [F1-S04, F1-S09, F1-S11, F1-S13]
blocks: [F8-S05]
labels: []
source_docs:
  - docs/05-modulos-funcionais.md
  - docs/10-seguranca-permissoes.md
  - docs/17-lgpd-protecao-dados.md
---

# F8-S03 — Backend dashboard metrics

## Objetivo

Endpoint único `GET /api/dashboard/metrics` que retorna o conjunto de KPIs agregados para
substituir o placeholder atual em `apps/web/src/features/dashboard/DashboardPage.tsx`.
Hoje a dashboard não tem dados reais — esse slot é o backbone do que F8-S05 (frontend)
vai renderizar.

> Overlap conceitual: F6-S03 (do roadmap) também previa "APIs de dashboard". Se F6 for
> executada depois, considerar este endpoint como ponto de partida em vez de recriar.

## Escopo

### Endpoint `GET /api/dashboard/metrics`

`authenticate()` + `authorize({ permissions: ['dashboard:read'] })`. Aplica city scope
automaticamente — admin global vê tudo; agente vê só suas cidades.

Query params opcionais:

- `range` — enum `today | 7d | 30d | mtd | ytd` (default `30d`).
- `cityId` — filtra para uma cidade específica (se omitido, agrega todas as cidades do
  escopo do usuário).

Response (todos os números são contagens — **nunca** retornar lista de leads individuais
neste endpoint):

```ts
{
  range: {
    from: string;
    to: string;
    label: string;
  }
  leads: {
    total: number;
    newInRange: number;
    byStatus: Array<{ status: LeadStatus; count: number }>;
    byCity: Array<{ cityId: string; cityName: string; count: number }>;
    bySource: Array<{ source: LeadSource; count: number }>;
    staleCount: number; // leads sem interação > 7 dias
  }
  interactions: {
    totalInRange: number;
    byChannel: Array<{ channel: InteractionChannel; count: number }>;
    inboundOutboundRatio: {
      inbound: number;
      outbound: number;
    }
  }
  kanban: {
    cardsByStage: Array<{ stageId: string; stageName: string; count: number }>;
    avgDaysInStage: Array<{ stageId: string; days: number }>;
  }
  agents: {
    topByLeadsClosed: Array<{ agentId: string; displayName: string; closedWon: number }>;
  }
}
```

### Performance

- Queries devem rodar em < 500 ms p95 com base atual (até 100k leads). Usar índices
  existentes (`idx_leads_org_status_created`, `idx_interactions_org_channel_created`,
  `idx_leads_org_city`).
- Considerar materialized view ou cache em memória (TTL 60s) se uma query passar de 1s
  com seed real. Decisão registrada no PR.

### LGPD

- **NUNCA** retornar nome, telefone, email, CPF.
- `topByLeadsClosed` retorna `display_name` do agente (não é PII de cidadão).
- Logs estruturados com `request_id`; respostas auditadas em volume (1 linha por
  request → `audit_logs` com `action='dashboard.read'`, `payload` contendo filtros).

### City scope

- Se usuário tem role `scope=city`, todas as agregações filtram por `WHERE city_id IN
(user.cityScopes)` automaticamente via repository.
- `cityId` no query param só é aceito se estiver no escopo do usuário (senão 403).

## Arquivos permitidos

- `apps/api/src/modules/dashboard/routes.ts`
- `apps/api/src/modules/dashboard/controller.ts`
- `apps/api/src/modules/dashboard/service.ts`
- `apps/api/src/modules/dashboard/repository.ts`
- `apps/api/src/modules/dashboard/schemas.ts`
- `apps/api/src/modules/dashboard/__tests__/routes.test.ts`
- `apps/api/src/modules/dashboard/__tests__/service.test.ts`
- `apps/api/src/app.ts` (registrar plugin)
- `apps/api/src/db/migrations/0015_seed_dashboard_permission.sql` (seed `dashboard:read`)

## Definition of Done

- [ ] Endpoint retorna shape acima validado por Zod.
- [ ] Permissão `dashboard:read` criada e atribuída às roles `admin` e `agent` no seed.
- [ ] City scope filtra agregações automaticamente; teste prova que agent vê só suas
      cidades.
- [ ] `cityId` fora do escopo retorna 403.
- [ ] `staleCount` = leads com `MAX(interactions.created_at) < now() - 7 days`.
- [ ] Resposta nunca contém PII de leads.
- [ ] Audit log gerado por chamada.
- [ ] Tests cobrem: range default, cada range enum, cityId no escopo, cityId fora do
      escopo (403), seed sem dados → todos os arrays vazios.
- [ ] Query principal explicada no PR (EXPLAIN ANALYZE) confirmando uso de índices.

## Validação

```powershell
pnpm --filter @elemento/api db:migrate
pnpm --filter @elemento/api test -- dashboard
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api typecheck
```
