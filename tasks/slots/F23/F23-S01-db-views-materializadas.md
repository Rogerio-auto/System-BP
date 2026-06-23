---
id: F23-S01
title: DB — views materializadas, índices e job de refresh para relatórios
phase: F23
task_ref: docs/planejamento-relatorios-metricas.md
status: in-progress
priority: high
estimated_size: M
agent_id: null
claimed_at: 2026-06-23T23:27:43Z
completed_at: null
pr_url: null
depends_on: []
blocks: []
labels: [db, backend, reports, performance]
source_docs:
  [
    docs/planejamento-relatorios-metricas.md,
    docs/05-modulos-funcionais.md,
    docs/17-lgpd-protecao-dados.md,
  ]
docs_required: false
---

# F23-S01 — DB: views materializadas + índices + job de refresh

## Objetivo

Criar a camada de agregação que alimenta a página `/relatorios` sem varrer tabelas quentes
em request síncrono. Entrega views materializadas (MV), índices de suporte e um job de
refresh periódico (5 min). **Apenas agregados** — nenhuma MV expõe PII (doc 17 §3.3 #8).

## Contexto

Plano em `docs/planejamento-relatorios-metricas.md` (§7). Doc 05 §9 já prevê
`mv_dashboard_overview`, `mv_funnel_conversion`, `mv_stage_dwell_time` com refresh por job.
Este slot é a fundação dos endpoints de `reports` (F23-S03/S04/S05). Próxima migration livre: `0071`.

## Escopo (faz)

- Migration `0071_reports_materialized_views.sql` (+ entry no `meta/_journal.json` — migration
  escrita à mão, ver PROTOCOL §3 migrations) criando MVs **org-scoped e city-aware** (toda MV
  carrega `organization_id` e, quando a entidade tem cidade, `city_id` como coluna de
  agrupamento — o filtro de escopo é aplicado na query do endpoint, não na MV):
  - `mv_reports_overview` — KPIs de leads/atendimentos/simulações/contratos por org/city/dia.
  - `mv_reports_funnel` — conversão etapa→etapa do kanban por org/city.
  - `mv_reports_stage_dwell` — tempo médio por estágio a partir de `kanban_stage_history`.
  - `mv_reports_credit` — simulações/análises/contratos agregados por org/city/produto/status.
  - `mv_reports_collection` — parcelas por org/city/status + dias de atraso médios.
- `CREATE UNIQUE INDEX` em cada MV (requisito para `REFRESH ... CONCURRENTLY`).
- Índices de suporte nas tabelas-fonte que faltarem para as agregações (ex: parciais por
  `status`/`created_at`), sem duplicar índices existentes (rodar `check-migrations`).
- Worker de refresh `apps/api/src/workers/reports-refresh.ts` espelhando o padrão de
  `cron-retention.ts` — `REFRESH MATERIALIZED VIEW CONCURRENTLY` de cada MV a cada 5 min,
  com advisory lock para não sobrepor execuções; registrado em `apps/api/src/workers/index.ts`.

## Fora de escopo (NÃO faz)

- Endpoints HTTP de relatório (F23-S03+).
- Permissões / RBAC (F23-S02).
- Qualquer coluna de PII nas MVs (proibido).
- Refresh event-driven via outbox (futuro; aqui é cron de 5 min).

## Arquivos permitidos

- `apps/api/src/db/migrations/0071_reports_materialized_views.sql`
- `apps/api/src/db/migrations/meta/_journal.json`
- `apps/api/src/workers/reports-refresh.ts`
- `apps/api/src/workers/index.ts`
- `apps/api/src/workers/__tests__/reports-refresh.test.ts`

## Arquivos proibidos

- `apps/api/src/modules/**`
- `apps/web/**`
- `apps/langgraph-service/**`
- `apps/api/scripts/seed.ts`

## Contratos de saída

- 5 MVs criadas, cada uma com `organization_id` (+ `city_id` quando aplicável) e índice único.
- Nenhuma MV contém nome/CPF/telefone/email de cidadão (só contagens, somatórios, médias, ids opacos).
- Worker registra refresh a cada 5 min, concorrente, com lock; falha de uma MV não derruba as outras.
- `python scripts/slot.py check-migrations` verde (sql ↔ journal).
- `pnpm --filter @elemento/api typecheck` verde.

## Definition of Done

- [ ] Migration `0071` + entry no journal; `check-migrations` verde
- [ ] 5 MVs org-scoped/city-aware, sem PII, com índice único
- [ ] Índices de suporte sem duplicar existentes (warning de idx duplicado tratado)
- [ ] Worker `reports-refresh` registrado, com advisory lock, refresh 5 min
- [ ] Teste do worker (refresh roda, lock evita sobreposição)
- [ ] `pnpm --filter @elemento/api typecheck` + `lint` verdes

## Validação

```powershell
python scripts/slot.py check-migrations
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
```

## Notas para o agente

- Toda agregação carrega `organization_id` — multi-tenant não-negociável (CLAUDE.md §8).
- `city_id` é dimensão de agrupamento, NÃO filtro embutido — o escopo de cidade é aplicado no
  endpoint via `applyCityScope`/`cityScopeIds`. MV global, filtro no read.
- `REFRESH ... CONCURRENTLY` exige índice único e que a MV já tenha sido populada uma vez.
- Conferir nomes reais de colunas/tabelas no schema Drizzle antes de escrever SQL.
