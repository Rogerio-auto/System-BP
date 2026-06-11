---
id: F13-S06
title: Produto de crédito — ativar/usar versão de regra
phase: F13
task_ref: null
status: done
priority: medium
estimated_size: M
agent_id: null
claimed_at: null
completed_at: 2026-06-11T19:32:35Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/213
depends_on: []
blocks: []
labels: []
source_docs:
  - docs/planejamento-2026-06-evolucao.md#épico-d-versão-do-produto-de-crédito-a-usar-item-6
  - docs/18-design-system.md
docs_required: true
docs_audience:
  - gestor
docs_artifacts:
  - docs/help/guias/admin/versao-produto.mdx
---

# F13-S06 — Produto de crédito: ativar/usar versão de regra

## Objetivo

Permitir, na configuração do produto de crédito, **escolher explicitamente qual versão de regra usar** — incluindo voltar a uma versão anterior — com a UI deixando claro qual está vigente.

## Contexto

Item 6 do planejamento. `credit_product_rules` já é versionado (`version` + `is_active` + `effective_from/to`), mas a "versão vigente" é implícita e não há controle de UI para trocá-la. Decisão D6: "usar uma versão antiga" **cria uma nova versão (cópia)** e a ativa, preservando a linearidade/auditoria (campos numéricos imutáveis — ver schema).

## Escopo (faz)

- Backend (`credit-products`): endpoint para **ativar uma versão** — implementado como **clone** da versão escolhida em `version+1` com `is_active=true`, desativando a anterior na mesma transação, respeitando `city_scope`. Auditoria + idempotência (regra #7). RBAC: reusar a permissão de publicação de regra já existente (não criar role novo).
- `apps/api/src/modules/credit-products/schemas.ts` + `routes.ts` + `service.ts` + `repository.ts`.
- Frontend (`features/admin/products`): botão **"Usar esta versão"** em cada versão no `RuleTimeline`, com badge de **"versão vigente"** e modal de confirmação (mudança sensível — afeta novas simulações).

## Fora de escopo (NÃO faz)

- Editar valores de uma versão existente (imutável por design).
- Simulação/uso da regra (já consome a versão ativa).
- Criar nova permissão/role (reusar a existente de publicação).

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/modules/credit-products/repository.ts`
- `apps/api/src/modules/credit-products/service.ts`
- `apps/api/src/modules/credit-products/controller.ts`
- `apps/api/src/modules/credit-products/schemas.ts`
- `apps/api/src/modules/credit-products/routes.ts`
- `apps/api/src/modules/credit-products/__tests__/**`
- `apps/web/src/features/admin/products/RuleTimeline.tsx`
- `apps/web/src/features/admin/products/PublishRuleDrawer.tsx`
- `apps/web/src/features/admin/products/__tests__/**`
- `docs/help/guias/admin/versao-produto.mdx`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/db/schema/creditProductRules.ts` (schema já suporta — não migrar)
- `apps/api/src/db/seed/permissions.ts` (reusar permissão existente)

## Contratos de saída

- `POST /api/products/:id/rules/:version/activate` (ou rota equivalente do módulo) → clona+ativa, devolve a regra vigente.

## Definition of Done

- [ ] Endpoint ativa versão via clone transacional (nova `version`, `is_active` único por produto+cidade)
- [ ] Auditoria + idempotência aplicadas
- [ ] RBAC: só quem publica regra pode ativar (positivo + negativo testados)
- [ ] UI `RuleTimeline` com "Usar esta versão" + badge "vigente" + confirmação
- [ ] Simulações antigas não mudam (capturam `rule_version_id` imutável)
- [ ] `pnpm --filter @elemento/api typecheck && pnpm --filter @elemento/web typecheck` verdes
- [ ] `pnpm test` verde (api credit-products + web products)
- [ ] Guia `docs/help/guias/admin/versao-produto.mdx` criado

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- credit-products
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web test -- products
```

## Notas para o agente

- Confirmar a forma exata da rota existente do módulo `credit-products` (publish) e seguir o mesmo padrão de RBAC/auditoria.
- "Apenas 1 versão `is_active` por produto+cidade vigente" é validado na service layer (não há constraint SQL por causa do `city_scope` array) — manter essa invariante na transação.
