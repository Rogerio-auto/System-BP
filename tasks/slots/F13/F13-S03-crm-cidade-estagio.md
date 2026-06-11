---
id: F13-S03
title: CRM exibe cidade + estágio de Kanban (lista, ficha e card)
phase: F13
task_ref: null
status: available
priority: high
estimated_size: M
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: []
blocks: []
labels: []
source_docs:
  - docs/planejamento-2026-06-evolucao.md#a1-cidade-do-lead-visível-no-crm-e-no-kanban-item-1
  - docs/planejamento-2026-06-evolucao.md#épico-h-estágio-de-kanban-gestão-interna-no-dashboard-e-crm-item-11
  - docs/18-design-system.md
docs_required: true
docs_audience:
  - operador
  - gestor
docs_artifacts:
  - docs/help/guias/crm/cidade-e-estagio.mdx
---

# F13-S03 — CRM exibe cidade + estágio de Kanban (lista, ficha e card)

## Objetivo

Mostrar a **cidade** do lead e o **estágio de Kanban** (gestão interna) na lista e na ficha do CRM e no card do board, e permitir **mudar o estágio** a partir da ficha do CRM (reusando a mutação existente do Kanban).

## Contexto

Itens 1 e 11 do planejamento. O cadastro já coleta `city_id` (obrigatório) mas o CRM/Kanban **não exibem** a cidade. O CRM hoje só opera `lead.status` (status de atendimento), não o **estágio de Kanban** (`kanban_stages`). Decisão D18: status e estágio ficam **independentes**; quem já edita o lead pode mover o estágio.

## Escopo (faz)

- Backend (leads): enriquecer o response de lista/detalhe com `city_name` (join `cities`) e o **estágio de Kanban atual** do lead (`kanban_cards` → `kanban_stages`: `stage_id`, `stage_name`).
- `packages/shared-schemas/src/leads.ts`: estender `LeadResponseSchema`/`LeadListResponse` com `city_name` (nullable) e `kanban_stage` (`{ id, name }` nullable). **Sem** mexer no `index.ts` (já reexporta `leads`).
- Frontend CRM: exibir cidade (chip) na lista e na ficha; exibir o estágio de Kanban atual; controle para **mudar o estágio** na ficha (dropdown com os `kanban_stages`), chamando a mutação de mover card já existente (`hooks/kanban`).
- Frontend Kanban: chip de cidade no `KanbanCard`.
- Deixar visualmente clara a distinção **status de atendimento × estágio de Kanban**.

## Fora de escopo (NÃO faz)

- Métricas de estágio no dashboard (`avgDaysInStage`) — é o F13-S05.
- Alterar a lógica de movimentação de card do board (apenas consumir a mutação existente).
- Sincronizar status com estágio (D18: independentes).

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/modules/leads/repository.ts`
- `apps/api/src/modules/leads/service.ts`
- `apps/api/src/modules/leads/schemas.ts`
- `apps/api/src/modules/leads/__tests__/**`
- `packages/shared-schemas/src/leads.ts`
- `apps/web/src/features/crm/CrmListPage.tsx`
- `apps/web/src/features/crm/CrmDetailPage.tsx`
- `apps/web/src/features/crm/__tests__/**`
- `apps/web/src/components/kanban/KanbanCard.tsx`
- `apps/web/src/hooks/crm/types.ts`
- `apps/web/src/hooks/crm/useLead.ts`
- `apps/web/src/hooks/crm/useLeads.ts`
- `docs/help/guias/crm/cidade-e-estagio.mdx`

## Arquivos proibidos (`files_forbidden`)

- `packages/shared-schemas/src/index.ts` (não alterar reexports)
- `apps/web/src/features/dashboard/**` (dono é F13-S05)
- `apps/web/src/components/kanban/KanbanDetailModal.tsx` e demais do board (não alterar a lógica de move)

## Contratos de saída

- `LeadResponse.city_name: string | null` e `LeadResponse.kanban_stage: { id, name } | null` disponíveis para a UI.

## Definition of Done

- [ ] Response de lista/detalhe de leads inclui `city_name` e `kanban_stage`
- [ ] CRM lista e ficha exibem cidade + estágio de Kanban
- [ ] Ficha do CRM permite mudar o estágio (reusa mutação do Kanban) com RBAC respeitado
- [ ] `KanbanCard` mostra a cidade
- [ ] Escopo de cidade (RBAC) preservado nas queries (regra #3)
- [ ] `pnpm --filter @elemento/api typecheck && pnpm --filter @elemento/web typecheck` verdes
- [ ] `pnpm test` verde (api leads + web crm)
- [ ] Guia `docs/help/guias/crm/cidade-e-estagio.mdx` criado (sem PII real)

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api test -- leads
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test -- crm
```

## Notas para o agente

- Drift front×API: o front deve consumir o `LeadResponseSchema` real estendido aqui (ver memória `feedback_parallel_contract_drift`).
- A mutação de mover card já existe nos hooks do Kanban — **reusar**, não duplicar. Se faltar um endpoint para mover por `lead_id`, mover por `card_id` (o lead tem 1 card).
- `kanban_stage` é nullable: leads sem card (raro) ou pré-identify_city.
