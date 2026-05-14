---
id: F2-S03
title: CRUD credit-products + publicação versionada de regras
phase: F2
task_ref: T2.3
status: in-progress
priority: high
estimated_size: M
agent_id: backend-engineer
claimed_at: 2026-05-14T21:07:00Z
completed_at:
pr_url:
depends_on: [F2-S01, F1-S04, F1-S15]
blocks: [F2-S04, F2-S07]
labels: []
source_docs:
  - docs/05-modulos-funcionais.md
  - docs/03-modelo-dados.md
  - docs/04-eventos.md
  - docs/10-seguranca-permissoes.md
---

# F2-S03 — CRUD credit-products + rule versioning

## Objetivo

Endpoints admin para CRUD de produtos de crédito e publicação versionada de regras.
Publicar regra é uma operação especial: cria nova `credit_product_rules.version` e marca
anterior como `is_active=false` com `effective_to=now()` — **nunca** edita versão antiga.

## Escopo

Módulo `apps/api/src/modules/credit-products/`.

### Endpoints (base `/api/credit-products`)

Todos exigem `authenticate()` + permissão (`credit_products:read` ou `credit_products:write`).
Adicionar essas permissões em migration de seed (parte deste slot).

#### Produtos

- `GET /api/credit-products` — lista; inclui última versão ativa de regra (resumo).
- `POST /api/credit-products` — cria produto. Body: `{ key, name, description? }`. Org via contexto.
- `GET /api/credit-products/:id` — detalhe + lista de regras (timeline).
- `PATCH /api/credit-products/:id` — atualiza `name`, `description`, `is_active`. **Não** mexe em regras.
- `DELETE /api/credit-products/:id` — soft-delete (`deleted_at=now()`). Bloqueia se houver simulações nos últimos 90 dias (409).

#### Regras

- `POST /api/credit-products/:id/rules` — publica nova regra.
  - Body: `{ minAmount, maxAmount, minTermMonths, maxTermMonths, monthlyRate, iofRate?, amortization, cityScope?, effectiveFrom? }`.
  - Em transação:
    1. Lê última `version` ativa do produto.
    2. Insere nova com `version = max+1`, `is_active=true`, `effective_from=now()`.
    3. Atualiza anterior: `is_active=false`, `effective_to=now()`.
    4. Emite `credit.rule_published` via outbox com snapshot completo no payload.
  - Resposta: 201 com a nova regra.
- `GET /api/credit-products/:id/rules` — timeline (todas as versões, ordenadas DESC).

### Validação Zod

- `key`: lowercase snake_case, 3-60 chars, único por org.
- `monthlyRate`: 0..1 (decimal, não percentual).
- `minAmount/maxAmount`: 100..1_000_000, `max >= min`.
- `minTermMonths/maxTermMonths`: 1..120, `max >= min`.
- `amortization`: `'price' | 'sac'`.
- `cityScope`: array UUID, opcional; valida que cada ID existe na org.

### Audit + eventos

- Toda mutação → `audit_logs` (`entity='credit_product'` ou `'credit_product_rule'`).
- Eventos emitidos via outbox (F1-S15):
  - `credit.product_created`
  - `credit.product_updated`
  - `credit.rule_published` (payload com snapshot completo da regra)

### City scope

Produtos são globais por org. Regras podem ter `city_scope` (array de city_id). `list` de
produtos não filtra por escopo de usuário (qualquer usuário com `credit_products:read` vê
todos os produtos da org). Filtros de escopo virão em simulações (F2-S04).

### Feature flag

- `credit_simulation.enabled` (já existe em F1-S23): se desligada, endpoints de regra
  retornam 503 com `code='feature_disabled'`. Endpoints de produto continuam funcionais
  (gestão visível mesmo com módulo desligado).

## Arquivos permitidos

- `apps/api/src/modules/credit-products/routes.ts`
- `apps/api/src/modules/credit-products/controller.ts`
- `apps/api/src/modules/credit-products/service.ts`
- `apps/api/src/modules/credit-products/repository.ts`
- `apps/api/src/modules/credit-products/schemas.ts`
- `apps/api/src/modules/credit-products/__tests__/routes.test.ts`
- `apps/api/src/modules/credit-products/__tests__/service.test.ts`
- `apps/api/src/app.ts` (registrar plugin)
- `apps/api/src/events/types.ts` (adicionar 3 eventos)
- `apps/api/src/db/migrations/0018_seed_credit_products_permissions.sql` (seed `credit_products:read`, `credit_products:write`)
- `docs/04-eventos.md` (registrar eventos)

> **Migration 0017 está reservada para F2-S04** (seed permissão `simulations:*`). Se a
> ordem mudar, ajuste o número via `slot.py brief F2-S03`.

## Definition of Done

- [ ] 7 endpoints (5 produto + 2 regra) com Zod + response schema.
- [ ] Publicar regra é atômico (transação) — teste prova rollback se uma das partes falhar.
- [ ] Anterior fica `is_active=false` + `effective_to=now()` após publicar nova.
- [ ] **Editar regra antiga é impossível pela API** — não há rota `PATCH /rules/:id`. Teste prova.
- [ ] Bloqueio de soft-delete em produto com simulações recentes (409).
- [ ] Audit log + outbox em todas as mutações.
- [ ] Feature flag `credit_simulation.enabled` gate em rotas de regra.
- [ ] City scope correto para regras (validação de IDs existentes).
- [ ] `pnpm --filter @elemento/api typecheck && lint && test` verdes.
- [ ] PR aberto.

## Validação

```powershell
pnpm --filter @elemento/api db:migrate
pnpm --filter @elemento/api test -- credit-products
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api typecheck
```
