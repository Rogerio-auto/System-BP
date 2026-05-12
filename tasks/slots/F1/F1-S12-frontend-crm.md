---
id: F1-S12
title: Frontend CRM — lista + detalhe + form de lead
phase: F1
task_ref: T1.12
status: review
priority: high
estimated_size: L
agent_id: claude-code
claimed_at: 2026-05-12T00:00:00Z
completed_at: 2026-05-12T03:00:00Z
pr_url: null
depends_on: [F1-S08, F1-S11]
blocks: []
source_docs:
  - docs/12-tasks-tecnicas.md#T1.12
  - docs/18-design-system.md
  - docs/design-system/index.html
---

# F1-S12 — Frontend CRM

## Objetivo

Tela `/crm` (lista com filtros), `/crm/:id` (detalhe + timeline), modal "Novo lead". Padrão visual world-class seguindo `docs/18-design-system.md` (light-first, funciona em ambos os temas).

## Escopo

- `features/crm/CrmListPage.tsx` — tabela densa seguindo o componente `Table` do DS (§9.7): `th` em caption-style, hover de linha, avatar com `--grad-rondonia`/variantes, coluna de valor em JetBrains Mono (classe `td-amount`). Filtros (cidade, status, agente, busca) em barra superior usando `Input` e `Select` primitivos do DS. Paginação cursor.
- Header da página com `stats` row (4 KPIs em `Stat` primitivos do DS — total leads, novos no mês, em análise, conversão).
- `features/crm/CrmDetailPage.tsx` — header com avatar (variante `azul`) + nome em Bricolage + meta caption. Timeline de interações em coluna lateral usando `Card` com Spotlight hover. Dados pessoais em `Card` agrupado. Status como `Badge` colorido conforme estado.
- `features/crm/NewLeadModal.tsx` — modal com `box-shadow: var(--elev-5)`, header com close button (ghost), form Zod compartilhado (`shared-schemas`). Animação de entrada fade-up.
- TanStack Query para fetch + invalidação após mutate.
- Loading: skeletons que respeitam o layout final. Empty state com ilustração + CTA.

## Definition of Done

- [ ] Tela lista carrega com filtros funcionais
- [ ] Tabela usa componente `Table` canônico, com hover de linha e badges de status
- [ ] Avatares usam `--grad-rondonia`/variantes
- [ ] Criar lead via modal (`--elev-5`) funciona
- [ ] Telefone valida no client (mesma normalização do backend)
- [ ] Funciona em ambos os temas sem regressão
- [ ] PR com screenshots (light + dark, lista + detalhe + modal)
