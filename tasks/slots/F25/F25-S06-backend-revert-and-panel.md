---
id: F25-S06
title: Backend — reversão de ação da IA + endpoint do painel "IA nas últimas 24h"
phase: F25
task_ref: docs/22-agente-interno-acoes.md
status: in-progress
priority: medium
estimated_size: M
agent_id: null
depends_on: [F25-S02, F25-S03, F25-S05]
blocks: [F25-S07]
labels: [backend, ai-agent, rbac, audit]
source_docs: [docs/22-agente-interno-acoes.md, docs/10-seguranca-permissoes.md]
docs_required: false
claimed_at: 2026-07-10T14:30:53Z
---

# F25-S06 — Backend: reversão + painel de ações da IA

## Objetivo

Dar ao gestor o controle humano exigido pelo doc 22 §8.B/§11: reverter em 1 clique uma ação
autônoma da IA e ver o que a IA fez no funil nas últimas 24h — tudo sob RBAC + escopo de cidade.

## Escopo (faz)

- `GET /api/ai-actions?window=24h` (guard `authorize({permissions:['ai_actions:read']})` +
  `applyCityScope`): lista de ações da IA (qualificações, estagnações, abandonos) a partir de
  `audit_logs` com `actor_type='ai'` (+ join mínimo p/ nome do lead mascarado). Zod + paginação.
- `POST /api/ai-actions/:id/revert` (guard `ai_actions:revert` + `applyCityScope`): reverte a ação
  referenciada — reabrir lead abandonado (`closed_lost`→stage não-terminal + `leads.status`
  coerente) ou desfazer qualificação. Idempotente; audit da reversão com o **usuário** como actor;
  emite evento coerente; histórico preservado (append-only, nunca apaga).
- Schemas Zod + repository com filtro de cidade injetado.

## Fora de escopo (NÃO faz)

- UI (F25-S07).
- Configuração dos limiares (parte de F25-S07 na UI; a tabela já existe em F25-S05).
- Qualquer ação da IA em si.

## Arquivos permitidos

- `apps/api/src/modules/ai-actions/routes.ts`
- `apps/api/src/modules/ai-actions/controller.ts`
- `apps/api/src/modules/ai-actions/service.ts`
- `apps/api/src/modules/ai-actions/repository.ts`
- `apps/api/src/modules/ai-actions/schemas.ts`
- `apps/api/src/app.ts`
- `apps/api/src/modules/ai-actions/__tests__/ai-actions.test.ts`

## Arquivos proibidos

- `apps/web/**`
- `apps/langgraph-service/**`
- `apps/api/src/db/migrations/**`

## Definition of Done

- [ ] `GET /api/ai-actions` city-scoped, `ai_actions:read`, PII mascarada, paginado
- [ ] `POST /api/ai-actions/:id/revert` city-scoped, `ai_actions:revert`, idempotente, audit com usuário
- [ ] Reversão preserva histórico (append-only); nega fora do escopo sem vazar existência
- [ ] Zod nas bordas; `pnpm --filter @elemento/api typecheck` + `lint` + `test` verdes

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
python scripts/slot.py validate F25-S06
```

## Notas para o agente

- Reaproveitar o padrão de módulo existente (ex.: `reports/`) para estrutura routes/controller/service/repository.
- `applyCityScope` é obrigatório em ambas as rotas — um gestor_regional só vê/reverte na sua cidade.
- Registrar rota em `app.ts` (roteador vivo).
