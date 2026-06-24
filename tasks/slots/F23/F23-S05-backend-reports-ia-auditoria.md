---
id: F23-S05
title: Backend — reports: saúde da IA/LLM e auditoria/operação
phase: F23
task_ref: docs/planejamento-relatorios-metricas.md
status: review
priority: medium
estimated_size: M
agent_id: null
claimed_at: 2026-06-24T14:19:33Z
completed_at: 2026-06-24T15:12:42Z
pr_url: null
depends_on: [F23-S03]
blocks: []
labels: [backend, reports, rbac, observability]
source_docs: [docs/planejamento-relatorios-metricas.md, docs/10-seguranca-permissoes.md]
docs_required: false
---

# F23-S05 — Backend: reports de IA/LLM e auditoria

## Objetivo

Endpoints agregados das seções IA/Pré-atendimento (§4-C) e Auditoria & Operação (§4-H),
restritos a admin/gestor_geral.

## Contexto

Plano §4-C/H. Fontes: `ai_conversation_states`, `ai_decision_logs`, `chatwoot_handoffs`
(IA) e `audit_logs`, `event_outbox`/DLQ (operação). Métricas de custo/latência de LLM e DLQ
são visão de admin. Gating: IA por `dashboard:read` + flag de IA; auditoria por `audit:read`.

## Escopo (faz)

- Schemas Zod em `packages/shared-schemas/src/reports.ts` (estender) para ai/audit.
- `GET /api/reports/ai` — conversas atendidas pela IA, taxa de handoff, motivos, distribuição
  por nó/intenção, e (admin) tokens in/out, custo estimado, latência média, taxa de erro por
  nó/modelo/versão de prompt; SLA de handoff.
- `GET /api/reports/audit` — ações por tipo/ator/período, alterações críticas; saúde de
  eventos (volume, taxa de sucesso, latência, itens em DLQ). Gating `audit:read`.
- RBAC + `applyCityScope` (onde a entidade tem cidade) + audit de leitura.

## Fora de escopo (NÃO faz)

- UI (F23-S07).
- Exportação (F23-S09).
- Reprocessamento de DLQ / qualquer mutação (read-only).

## Arquivos permitidos

- `packages/shared-schemas/src/reports.ts`
- `apps/api/src/modules/reports/routes.ts`
- `apps/api/src/modules/reports/controller.ts`
- `apps/api/src/modules/reports/service.ts`
- `apps/api/src/modules/reports/repository.ts`
- `apps/api/src/modules/reports/__tests__/reports-ai-audit.test.ts`

## Arquivos proibidos

- `apps/web/**`
- `apps/langgraph-service/**`
- `apps/api/src/modules/dashboard/**`
- `apps/api/src/db/migrations/**`

## Contratos de saída

- 2 endpoints agregados validados por Zod; sem PII.
- `audit` gated por `audit:read`; `ai` por `dashboard:read` + flag IA.
- Custo/latência/erro de LLM corretos (teste compara com agregação direta de `ai_decision_logs`).
- Leitura auditada.

## Definition of Done

- [ ] Schemas Zod ai/audit compartilhados
- [ ] 2 endpoints com RBAC + scope + audit
- [ ] Métricas de LLM (tokens/custo/latência/erro) e DLQ corretas
- [ ] Testes de gating e de métrica×SQL
- [ ] `pnpm --filter @elemento/api typecheck` + `lint` + `test` verdes

## Validação

```powershell
pnpm --filter @elemento/shared-schemas build
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
```

## Notas para o agente

- Custo de LLM: tokens × tarifa por modelo. Se a tarifa não estiver no catálogo, expor só
  tokens e marcar custo como indisponível (não inventar tarifa).
- IA agregada é por org; aplicar city scope só onde a entidade carrega cidade.
- Sem `any`/`as`.
