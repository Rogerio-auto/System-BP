---
id: F23-S04
title: Backend — reports: crédito, cobrança e produtividade
phase: F23
task_ref: docs/planejamento-relatorios-metricas.md
status: in-progress
priority: high
estimated_size: L
agent_id: null
claimed_at: 2026-06-24T13:08:52Z
completed_at: null
pr_url: null
depends_on: [F23-S03]
blocks: []
labels: [backend, reports, rbac, lgpd-impact, multi-tenant]
source_docs: [docs/planejamento-relatorios-metricas.md, docs/10-seguranca-permissoes.md, docs/17-lgpd-protecao-dados.md]
docs_required: false
---

# F23-S04 — Backend: reports de crédito, cobrança e produtividade

## Objetivo

Endpoints agregados das seções Crédito (§4-E), Cobrança & Carteira (§4-F) e Produtividade
(§4-G), com RBAC, escopo de cidade e a regra de produtividade nominal (D3).

## Contexto

Plano §4-E/F/G, §3. Cobrança reusa `/dashboard/collection` (já city-scoped após F22-S01) e a
permissão `billing:read` agora também serve `gestor_regional` (F23-S02). Produtividade usa
`dashboard:read_by_agent`. **D3 (travada):** gestor vê ranking nominal; agente vê só a si +
média anônima da equipe (backend NÃO retorna nomes/números de colegas para solicitante self-scoped).

## Escopo (faz)

- Schemas Zod em `packages/shared-schemas/src/reports.ts` (estender) para credit/collection/productivity.
- `GET /api/reports/credit` — simulações/análises/contratos: funil de crédito, taxas de
  aprovação/rejeição/default, valores médios, por produto/cidade/status.
- `GET /api/reports/collection` — adimplência/inadimplência, dias de atraso, eficiência de
  cobrança (jobs agendados→enviados, falhas), PIX vs boleto. Gating `billing:read`, city-scoped.
- `GET /api/reports/productivity` — leads fechados/simulações/conversas/cobranças por agente.
  Gating `dashboard:read_by_agent`. **D3:** se solicitante é self-scoped, retorna só o próprio
  registro + média agregada anônima da equipe; gestor recebe ranking nominal.
- RBAC + `applyCityScope` + self-scope + audit (`reports.read`) em todos.

## Fora de escopo (NÃO faz)

- IA/LLM health (F23-S05).
- Exportação (F23-S09) e UI (F23-S06+).
- Drill-down com PII (proibido — só agregados).
- Alterar a lógica de escopo do dashboard de cobrança (já feita em F22-S01).

## Arquivos permitidos

- `packages/shared-schemas/src/reports.ts`
- `apps/api/src/modules/reports/routes.ts`
- `apps/api/src/modules/reports/controller.ts`
- `apps/api/src/modules/reports/service.ts`
- `apps/api/src/modules/reports/repository.ts`
- `apps/api/src/modules/reports/__tests__/reports-credit-collection.test.ts`

## Arquivos proibidos

- `apps/web/**`
- `apps/langgraph-service/**`
- `apps/api/src/modules/dashboard/**`
- `apps/api/src/db/migrations/**`
- `apps/api/scripts/seed.ts`

## Contratos de saída

- 3 endpoints agregados validados por Zod; sem PII.
- `collection` respeita `billing:read` e escopo de cidade (gestor_regional só suas cidades).
- `productivity` aplica D3: self-scoped não vê dados nominais de colegas.
- Taxas de aprovação/default/adimplência batem com SQL direto (teste).
- Cada leitura audita sem PII.

## Definition of Done

- [ ] Schemas Zod credit/collection/productivity compartilhados
- [ ] 3 endpoints com RBAC + applyCityScope + self-scope + audit
- [ ] D3 implementada e testada (agente não vê colegas nominalmente)
- [ ] collection gated por `billing:read`, city-scoped (gestor_regional incluído)
- [ ] Testes de isolamento por papel + métrica×SQL
- [ ] `pnpm --filter @elemento/api typecheck` + `lint` + `test` verdes
- [ ] Checklist LGPD §14.2 na descrição do PR

## Validação

```powershell
pnpm --filter @elemento/shared-schemas build
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
```

## Notas para o agente

- Reusar agregações da MV `mv_reports_credit`/`mv_reports_collection` (F23-S01) quando possível.
- D3: o corte nominal é responsabilidade do service, não do front. Nunca enviar nome/número de
  colega para um solicitante self-scoped.
- Sem `any`/`as`. Erros tipados.
