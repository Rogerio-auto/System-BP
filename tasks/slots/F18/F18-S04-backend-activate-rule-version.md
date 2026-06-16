---
id: F18-S04
title: Backend — endpoint activateRuleVersion (Onda 1 item 6)
phase: F18
task_ref: docs/planejamento-2026-06-evolucao.md#épico-d--versão-do-produto-de-crédito-a-usar-item-6
status: review
priority: medium
estimated_size: S
agent_id: null
claimed_at: 2026-06-16T05:07:41Z
completed_at: 2026-06-16T05:16:59Z
pr_url: null
depends_on: []
blocks: [F18-S05]
labels: [backend, products, rbac]
source_docs:
  - docs/planejamento-2026-06-evolucao.md
docs_required: false
---

# F18-S04 — Backend: endpoint activateRuleVersion

## Objetivo

Permitir que admins ativem explicitamente uma versão específica de regra de produto de crédito, criando uma cópia imutável como nova versão ativa.

## Contexto

Item 6 (Onda 1). O `credit_product_rules.is_active` hoje é gerenciado implicitamente ao publicar uma nova versão. Decisão D6 (recomendada, Rogério não contra-indicou): ao "usar uma versão antiga", criar uma **cópia como nova versão** (mantém histórico linear e imutabilidade da versão original).

## Escopo (faz)

- Endpoint `POST /api/products/:productId/rules/:version/activate` (RBAC: `products:write`, role `admin`/`gestor_geral`).
- Service: (1) busca a regra `version` do produto; (2) cria nova linha copiando todos os campos da versão selecionada como nova versão (incrementa `version`); (3) marca a nova como `is_active = true`, seta `effective_from = now()`; (4) desativa todas as outras versões do mesmo produto+cidade (`is_active = false`, `effective_to = now()`). Tudo em transação.
- Auditoria: emit `product_rule.activated` via outbox (sem PII, apenas IDs).
- Idempotência: se a versão já é a ativa, retorna `200` sem criar duplicata.
- Response: a nova versão criada (tipo `CreditProductRuleResponse`).

## Fora de escopo (NÃO faz)

- UI (F18-S05).
- Reativar a linha original diretamente (estratégia é cópia, conforme D6).
- Alterar campos da versão copiada (cópia fiel).

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/modules/products/routes.ts`
- `apps/api/src/modules/products/controller.ts`
- `apps/api/src/modules/products/service.ts`
- `apps/api/src/modules/products/repository.ts`
- `apps/api/src/modules/products/schemas.ts`
- `apps/api/src/events/types.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/db/schema/**`
- `apps/api/src/db/migrations/**`
- `apps/web/**`

## Contratos de saída

- `POST /api/products/:productId/rules/:version/activate` → `201` com nova versão criada.
- Evento `product_rule.activated: { productId, newVersion, copiedFromVersion, organizationId }` no outbox.

## Definition of Done

- [ ] Endpoint cria nova versão copiando a selecionada e ativa apenas ela.
- [ ] Idempotente: segunda chamada retorna sem criar duplicata.
- [ ] RBAC: apenas `products:write` (admin/gestor_geral).
- [ ] Testa: ativação bem-sucedida, versão já ativa (idempotência), versão inexistente (404).
- [ ] `pnpm --filter @elemento/api typecheck && lint && test -- products` verdes.

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- products
```

## Notas para o agente

- Leia `apps/api/src/modules/products/` completo antes de editar — entenda como `PublishRuleDrawer` atual usa o endpoint de publicação para não duplicar lógica.
- O próximo `version` é `MAX(version) + 1` para o produto + cidade.
- `city_id` da nova versão copiada deve ser o mesmo da versão original.
- Use `db.transaction()` do Drizzle para garantir atomicidade.
