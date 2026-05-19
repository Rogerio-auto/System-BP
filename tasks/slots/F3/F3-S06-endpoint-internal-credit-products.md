---
id: F3-S06
title: Endpoint GET /internal/credit-products
phase: F3
task_ref: T3.6
status: review
priority: high
estimated_size: S
agent_id: backend-engineer
claimed_at: 2026-05-19T00:22:32Z
completed_at: 2026-05-19T00:29:07Z
pr_url:
depends_on: [F3-S04]
blocks: [F3-S15]
labels: []
source_docs:
  - docs/06-langgraph-agentes.md
---

# F3-S06 — Endpoint interno list_credit_products

## Objetivo

Listar produtos de crédito ativos para a IA escolher antes de simular.
Consumido pela tool `list_credit_products` (F3-S15).

## Escopo

### `GET /internal/credit-products`

- Auth `X-Internal-Token` → 401 sem.
- Query params opcionais: `cityId` (filtra produtos com regra para a cidade).
- Retorna **apenas produtos ativos** com a regra vigente: `id, name, min_amount,
max_amount, min_term, max_term, interest_rate, amortization_type`.
- Reusa o serviço/repository de `credit-products` de F2-S03.
- Sem dados internos sensíveis no payload (doc 06 §5.6).

## Fora de escopo

- Tool Python (F3-S15). Geração de simulação (endpoint já existe — F2-S05).

## Arquivos permitidos

- `apps/api/src/modules/internal/credit-products/routes.ts`
- `apps/api/src/modules/internal/credit-products/schemas.ts`
- `apps/api/src/modules/internal/credit-products/__tests__/routes.test.ts`

> A sub-rota é descoberta pelo autoload do plugin agregador (F3-S04) — não há
> arquivo compartilhado a editar.

## Definition of Done

- [ ] `X-Internal-Token` exigido → 401.
- [ ] Só produtos ativos retornados (produto inativo não aparece).
- [ ] Filtro por `cityId` retorna produtos com regra para a cidade.
- [ ] Payload sem campos internos sensíveis.
- [ ] `pnpm --filter @elemento/api typecheck && lint && test` verdes.

## Validação

```powershell
pnpm --filter @elemento/api test -- internal/credit-products
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api typecheck
```
