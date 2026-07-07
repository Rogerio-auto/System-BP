---
id: F6-S06
title: Backend — endpoints de leitura RBAC-bound do copiloto (principal do usuário + city scope)
phase: F6
task_ref: docs/22-agente-interno-acoes.md
status: in-progress
priority: high
estimated_size: L
agent_id: backend-engineer
claimed_at: 2026-07-07T21:50:05Z
depends_on: [F6-S05]
blocks: [F6-S07, F6-S08]
labels: [backend, ai-assistant, rbac, lgpd, dlp]
source_docs:
  [docs/22-agente-interno-acoes.md, docs/10-seguranca-permissoes.md, docs/17-lgpd-protecao-dados.md]
docs_required: false
---

# F6-S06 — Backend: superfície de leitura do copiloto (RBAC-bound)

## Objetivo

O núcleo do doc 22 §12.2: expor consultas de dados para o copiloto que **re-autorizam com o
principal do usuário** (permissions + cityScopeIds), reusando os repositories existentes com
`applyCityScope`. O copiloto nunca lê com privilégio próprio.

## Contexto

Superfície B. As tools do grafo (F6-S07) chamam estes endpoints passando o principal do usuário
(threading, §12.4). Os endpoints reusam `reports`/`leads`/`credit-analyses` já prontos (F23) —
não reimplementar cálculo, só expor com re-autorização por principal.

## Escopo (faz)

- Endpoints `/internal/assistant/*` (auth `X-Internal-Token`) que recebem no corpo o **principal**
  do usuário (`user_id`, `organization_id`, `permissions[]`, `city_scope_ids`) e:
  - Re-checam a permissão do domínio (ex.: `dashboard:read` para métricas, `analyses:read` para
    análise, `leads:read` para lead) — negam com erro estruturado se ausente.
  - Aplicam `applyCityScope(principal)` em toda query (reusar repositories de `reports`/`leads`).
  - **Mascaram PII** na resposta (reusar `phoneMasked`; nunca CPF bruto) — doc 22 §12.5.
  - Retornam dado estruturado + `source` (qual métrica/endpoint originou) para auditabilidade.
- Cobrir o conjunto inicial: métricas de funil/conversão, contagem de leads (por cidade/período),
  status de análise por lead, cobranças a vencer. Read-only — nenhuma mutação.
- Zod nas bordas (request com principal + query; response mascarada).

## Fora de escopo (NÃO faz)

- Grafo/tools Python (F6-S07).
- Endpoint público `/api/internal-assistant/query` (F6-S08).
- Qualquer escrita.

## Arquivos permitidos

- `apps/api/src/modules/internal/assistant/routes.ts`
- `apps/api/src/modules/internal/assistant/controller.ts`
- `apps/api/src/modules/internal/assistant/service.ts`
- `apps/api/src/modules/internal/assistant/schemas.ts`
- `apps/api/src/app.ts`
- `apps/api/src/modules/internal/assistant/__tests__/assistant-readonly.test.ts`

## Arquivos proibidos

- `apps/web/**`
- `apps/langgraph-service/**`
- `apps/api/src/db/migrations/**`
- Repositories de outros módulos (reusar, não editar)

## Definition of Done

- [ ] Endpoints re-autorizam por principal (permission do domínio + `applyCityScope`)
- [ ] Nenhum vazamento cross-city/cross-tenant; negação não revela existência
- [ ] PII mascarada em toda resposta; `source` presente para auditabilidade
- [ ] Read-only; Zod nas bordas; reusa repositories de F23 (sem duplicar cálculo)
- [ ] `pnpm --filter @elemento/api typecheck` + `lint` + `test` verdes

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
python scripts/slot.py validate F6-S06
```

## Notas para o agente

- **Regra de ouro (§12.2):** se o usuário não veria pela tela, o endpoint não retorna. O filtro é
  aqui, no backend — nunca no LLM.
- O principal vem do chamador (F6-S08 injeta a partir do JWT). Validar que os campos existem; não confiar em default.
