---
id: F6-S10
title: QA — testes RBAC-bound do copiloto (por role/cidade, negação sem vazar, DLP, flag)
phase: F6
task_ref: docs/22-agente-interno-acoes.md
status: available
priority: high
estimated_size: M
agent_id: null
depends_on: [F6-S06, F6-S08]
blocks: []
labels: [qa, ai-assistant, rbac, lgpd]
source_docs: [docs/22-agente-interno-acoes.md, docs/13-criterios-aceite.md]
docs_required: false
---

# F6-S10 — QA: RBAC-bound do copiloto

## Objetivo

Provar que o copiloto **só revela o que o RBAC do usuário permite** (doc 22 §12.2/§12.6) — o
critério mais crítico desta superfície.

## Escopo (faz)

- Testes de integração real-DB cobrindo a matriz do §12.6:
  - `leitura` (1 cidade): contagem de leads só da cidade dele; `gestor_geral`: global.
  - `agente`: status de análise só de lead no seu escopo; fora do escopo → negação **sem vazar
    existência** de dado de outra cidade/tenant.
  - Sem `dashboard:read` → consulta de métrica negada; sem `reports:export` → export negado.
  - "Aprova o crédito do fulano" → recusado (fora de escopo).
  - **DLP:** resposta e `assistant_queries.question_redacted` nunca contêm PII bruta (CPF/telefone).
  - **Flag OFF:** `POST /api/internal-assistant/query` → `feature_disabled`.
  - Principal derivado do JWT: tentativa de forjar city/permissions no corpo é ignorada.

## Fora de escopo (NÃO faz)

- Implementação (S06/S07/S08/S09).
- Testes de UI.

## Arquivos permitidos

- `apps/api/src/modules/internal/assistant/__tests__/**`
- `apps/api/src/modules/internal-assistant/__tests__/**`
- `apps/api/test/**`

## Arquivos proibidos

- Código de produção fora de `__tests__`/`test`
- `apps/web/**`
- `apps/langgraph-service/**`

## Definition of Done

- [ ] Matriz §12.6 coberta por role/cidade com harness real-DB
- [ ] Negação fora de escopo não vaza existência de dados
- [ ] Asserção "sem PII bruta" em resposta e em `assistant_queries`
- [ ] Flag OFF e anti-forja de principal testados
- [ ] `pnpm --filter @elemento/api test` verde

## Validação

```powershell
pnpm --filter @elemento/api test
python scripts/slot.py validate F6-S10
```

## Notas para o agente

- Harness real-DB (não mockar as permissões) — o valor do teste é justamente o RBAC real.
- Só editar arquivos de teste/fixtures.
