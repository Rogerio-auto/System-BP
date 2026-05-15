---
id: F2-S07
title: Frontend gestão de produtos + timeline de versões
phase: F2
task_ref: T2.3
status: done
priority: medium
estimated_size: M
agent_id: frontend-engineer
claimed_at: 2026-05-14T22:40:32Z
completed_at: 2026-05-14T23:00:30Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/59
depends_on: [F2-S03, F1-S08]
blocks: []
labels: []
source_docs:
  - docs/18-design-system.md
  - docs/design-system/index.html
  - docs/05-modulos-funcionais.md
---

# F2-S07 — Frontend produtos + timeline

## Objetivo

Tela `/admin/products` para gestores criarem/editarem produtos de crédito e **publicarem
novas versões de regras** — com timeline mostrando todas as versões e qual está ativa.
Consumindo F2-S03.

## Escopo

### Tela `/admin/products` — lista

- Header com título "Produtos de crédito" (Bricolage), botão "Novo produto".
- Stats row: total produtos ativos, regras ativas, versão média (caption).
- Tabela: nome, key (caption Mono), regra ativa (chip com `monthly_rate` formatada %),
  faixa `R$ X – R$ Y`, prazo `N–M meses`, status (Badge), ações (kebab).
- Filtros: busca por nome/key, status (ativo/inativo).

### Drawer "Novo produto" / "Editar produto"

- Form: `name`, `key` (lowercase auto), `description`.
- Ao criar: ao salvar, abre form de "Publicar primeira regra" inline.
- Ao editar: form com `is_active` toggle.

### Tela `/admin/products/:id` — detalhe + timeline

Layout em 2 colunas:

**Esquerda — Identidade do produto:**

- Card com nome, key, description, status.
- Botão "Editar" abre drawer.

**Direita — Timeline de regras (Card lista vertical):**

- Cada item: versão `v3` (badge grande), data de publicação, "ativa" (badge verde) ou
  "expirada" (badge cinza com `effective_to`). Resumo: `2.5% mensal · R$ 500–5.000 · 3–24m
· Price`. Cidades do escopo se houver (chips).
- Item mais novo no topo.
- Botão "Publicar nova versão" (primary) no header da timeline.

### Drawer "Publicar nova versão"

- Form: `monthlyRate` (%), `iofRate?` (%), `minAmount`, `maxAmount`, `minTermMonths`,
  `maxTermMonths`, `amortization` (Price/SAC radio), `cityScope` (multi-select cidades,
  opcional — vazio = todas).
- Preview: ao mudar campos, calcular live exemplo: "R$ 1.000 / 12 meses = R$ X/mês"
  (reusa `calculator` se for empacotado em `shared-schemas`; senão, fórmula Price
  inline simples só para preview — explicar no PR).
- Confirmação modal: "Publicar v4 → versão v3 será marcada como expirada. Confirmar?"

### Estados

- Loading: skeleton.
- Empty: CTA "Criar primeiro produto".
- Erro: card retry.
- Erro 409 ao soft-delete produto com simulações recentes: Toast + link "Ver simulações"
  (futuro — só link preparado).

### Feature flag

- `credit_simulation.enabled` off: aviso amarelo no topo + bloqueia "Publicar nova versão"
  (mas permite gerir produtos).

### Acesso

- Permissão `credit_products:read` para ver; `credit_products:write` para mutações.
- Sidebar item "Produtos" sob seção "Administração" ou "Crédito".

## Arquivos permitidos

- `apps/web/src/pages/admin/Products.tsx` (lista)
- `apps/web/src/pages/admin/ProductDetail.tsx` (detalhe + timeline)
- `apps/web/src/features/admin/products/ProductList.tsx`
- `apps/web/src/features/admin/products/ProductDrawer.tsx`
- `apps/web/src/features/admin/products/RuleTimeline.tsx`
- `apps/web/src/features/admin/products/PublishRuleDrawer.tsx`
- `apps/web/src/features/admin/products/__tests__/ProductDrawer.test.tsx`
- `apps/web/src/features/admin/products/__tests__/RuleTimeline.test.tsx`
- `apps/web/src/hooks/admin/useProducts.ts`
- `apps/web/src/hooks/admin/usePublishRule.ts`
- `apps/web/src/hooks/admin/types.ts`
- `apps/web/src/App.tsx` (rotas)
- `apps/web/src/components/layout/Sidebar.tsx` (item de menu)

## Definition of Done

- [ ] Lista de produtos com regra ativa visível no resumo.
- [ ] Drawer criar/editar funciona; key gerada lowercase auto.
- [ ] Timeline mostra TODAS as versões com data e status; versão ativa destacada.
- [ ] Publicar nova versão confirma e exibe v+1 no topo após sucesso (invalida cache TanStack Query).
- [ ] Preview de simulação live no drawer de publicação (com aviso "estimativa").
- [ ] Erros 409/422 tratados.
- [ ] Feature flag bloqueia publicação de regra.
- [ ] Funciona em ambos os temas, mobile.
- [ ] PR com screenshots (lista + detalhe + drawer publicar).

## Validação

```powershell
pnpm --filter @elemento/web test -- admin/products
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web build
```
