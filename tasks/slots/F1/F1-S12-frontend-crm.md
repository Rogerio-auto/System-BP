---
id: F1-S12
title: Frontend CRM — lista + detalhe + form de lead
phase: F1
task_ref: T1.12
status: blocked
priority: high
estimated_size: L
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F1-S08, F1-S11]
blocks: []
source_docs:
  - docs/12-tasks-tecnicas.md#T1.12
---

# F1-S12 — Frontend CRM

## Objetivo
Tela `/crm` (lista com filtros), `/crm/:id` (detalhe + timeline), modal "Novo lead". Design world-class dark.

## Escopo
- `features/crm/CrmListPage.tsx` — tabela densa, filtros (cidade, status, agente, busca), paginação cursor.
- `features/crm/CrmDetailPage.tsx` — timeline de interações, dados pessoais, ações.
- `features/crm/NewLeadModal.tsx` — form Zod compartilhado (`shared-schemas`).
- TanStack Query para fetch + invalidação após mutate.

## Definition of Done
- [ ] Tela lista carrega com filtros funcionais
- [ ] Criar lead via modal funciona
- [ ] Telefone valida no client (mesma normalização do backend)
- [ ] PR com screenshots
