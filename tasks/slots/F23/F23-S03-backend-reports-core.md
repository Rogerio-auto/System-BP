---
id: F23-S03
title: Backend — módulo reports (core): schemas Zod + overview/funil/atendimentos
phase: F23
task_ref: docs/planejamento-relatorios-metricas.md
status: review
priority: high
estimated_size: L
agent_id: null
claimed_at: 2026-06-24T01:24:18Z
completed_at: 2026-06-24T02:11:53Z
pr_url: null
depends_on: [F23-S01, F23-S02]
blocks: []
labels: [backend, reports, rbac, lgpd-impact, multi-tenant]
source_docs: [docs/planejamento-relatorios-metricas.md, docs/10-seguranca-permissoes.md, docs/17-lgpd-protecao-dados.md]
docs_required: false
---

# F23-S03 — Backend: módulo reports (core)

## Objetivo

Criar o módulo `reports` com os contratos Zod compartilhados e os três primeiros endpoints
agregados (visão geral, funil/CRM, atendimentos), todos com RBAC, escopo de cidade,
**self-scope** para papéis operacionais, e auditoria de leitura.

## Contexto

Plano §3 (visibilidade por papel), §4 (seções A/B/D), §5 (filtros), §7 (arquitetura).
Reaproveita as MVs de F23-S01 e o padrão de `apps/api/src/modules/dashboard/*`. O **contrato Zod
fica em `packages/shared-schemas`** para o front consumir o mesmo schema (evita o drift
front×API já documentado). Self-scope: quando o solicitante tem `dashboard:read_by_agent` mas
NÃO `dashboard:read`, o filtro `assigned_user_id = actor.id` / `agent_id = actor.id` é aplicado
automaticamente ("Meu desempenho").

## Escopo (faz)

- `packages/shared-schemas/src/reports.ts` — enums (range, escopo, dimensões) + schemas de
  query e response de overview/funnel/attendance. Filtros comuns: período (presets + range
  custom), cityId(s), agentId(s), canal, status, origem, "vs período anterior".
- `apps/api/src/modules/reports/{routes,controller,service,repository}.ts`:
  - `GET /api/reports/overview` (KPIs §4-A; pode reusar/estender `/dashboard/metrics`).
  - `GET /api/reports/funnel` (conversão etapa→etapa + tempo por estágio, §4-D).
  - `GET /api/reports/attendance` (conversas/canais/1ª resposta/resolução, §4-B).
- RBAC por permissão (`authorize`), `applyCityScope` em toda query, self-scope automático,
  validação Zod de request **e** response, rejeição de filtro fora do escopo do papel.
- Auditoria de leitura (`action: 'reports.read'`, metadata com seção/filtros/scope, **sem PII**),
  espelhando `dashboard.read`.
- Registro do módulo no bootstrap de rotas da API.

## Fora de escopo (NÃO faz)

- Endpoints de crédito/cobrança/produtividade (F23-S04) e IA (F23-S05).
- Exportação (F23-S09).
- Qualquer UI (F23-S06+).
- Retornar listas de pessoas / PII (proibido — só agregados; drill-down com PII é outro slot/decisão).

## Arquivos permitidos

- `packages/shared-schemas/src/reports.ts`
- `packages/shared-schemas/src/index.ts`
- `apps/api/src/modules/reports/routes.ts`
- `apps/api/src/modules/reports/controller.ts`
- `apps/api/src/modules/reports/service.ts`
- `apps/api/src/modules/reports/repository.ts`
- `apps/api/src/modules/reports/__tests__/reports.test.ts`
- `apps/api/src/app.ts`

## Arquivos proibidos

- `apps/web/**`
- `apps/langgraph-service/**`
- `apps/api/src/modules/dashboard/**`
- `apps/api/src/db/migrations/**`

## Contratos de saída

- 3 endpoints respondendo agregados validados por Zod; nenhum campo de PII.
- `gestor_regional`/`agente` veem apenas seu escopo (cidade / self); admin/gestor_geral global.
- Filtro inválido para o papel → rejeitado (Zod/escopo), nunca silenciosamente ignorado de forma insegura.
- Cada leitura gera 1 linha de audit sem PII.
- Schema Zod compartilhado importável pelo front (`@elemento/shared-schemas`).
- Métricas batem com query SQL direta (teste compara).

## Definition of Done

- [ ] Schemas Zod compartilhados (query+response) para overview/funnel/attendance
- [ ] 3 endpoints com RBAC + applyCityScope + self-scope + audit
- [ ] Self-scope automático para papel sem `dashboard:read` (Meu desempenho)
- [ ] Validação Zod de request e response; filtro fora do escopo rejeitado
- [ ] Testes de isolamento por papel (admin/gestor_geral/gestor_regional/agente) + métrica×SQL
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

- `applyCityScope`/`assertCityInScope` e a semântica de `cityScopeIds` em `apps/api/src/shared/scope.ts`.
- Usar `apps/api/src/modules/dashboard/*` como referência canônica de RBAC + audit + scope.
- Sem `any`/`as`. Erros tipados. `import type` para tipos.
- `shared-schemas` é runtime-build: garantir `index.ts` exporta e que o build gera dist (ver memória de shared-types runtime build).
