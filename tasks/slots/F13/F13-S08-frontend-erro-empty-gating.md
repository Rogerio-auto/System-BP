---
id: F13-S08
title: Estados de erro/empty no CRM+Kanban + gating do sync-all de templates
phase: F13
task_ref: null
status: blocked
priority: high
estimated_size: S
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F13-S07]
blocks: []
labels: []
source_docs:
  - docs/planejamento-2026-06-evolucao.md
  - docs/18-design-system.md
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F13-S08 — Estados de erro/empty (CRM+Kanban) + gating do sync-all

## Objetivo

Garantir que, sem dados, o CRM e o Kanban mostrem **estados de erro/vazio honestos** (nunca dados fake), e que o botão de sincronizar templates trate a ausência de integração Meta com mensagem clara em vez de 502 cru.

## Contexto

Os **mock-fallbacks já foram removidos** nesta sessão (2026-06-10) dos hooks `useLead`, `useLeads`, `useLeadSimulations`, `useKanbanHistory` — eles não mostram mais dados fictícios; o erro agora propaga ao TanStack Query. Falta **endurecer a UI**: estados de erro/empty no DS e o gating do sync-all. Ver memória `project_crm_mock_fallbacks`. Depende de F13-S07 (endpoints reais) para a timeline/histórico exibirem dados.

## Escopo (faz)

- CRM (`CrmListPage`, `CrmDetailPage`) e Kanban (modal de histórico): estados de **loading / erro / vazio** consistentes com o Design System (sem placeholders fake). Botão "tentar novamente" onde fizer sentido (`refetch`).
- Confirmar que `useKanbanHistory` exponha `isError` (hoje só `history`+`isLoading`) e que a UI o trate.
- Templates: **gating do botão "Sincronizar"** (`POST /api/templates/sync-all`) — quando a integração Meta não está configurada, desabilitar/explicar ("Integração WhatsApp não configurada") em vez de deixar estourar 502. Tratar o erro 502 com toast claro.
- Testes de render para os estados de erro/empty.

## Fora de escopo (NÃO faz)

- Implementar os endpoints (F13-S07).
- Reintroduzir qualquer mock.
- Configurar credenciais Meta (é infra/ambiente).

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/features/crm/CrmListPage.tsx`
- `apps/web/src/features/crm/CrmDetailPage.tsx`
- `apps/web/src/features/crm/__tests__/**`
- `apps/web/src/hooks/kanban/useKanbanHistory.ts`
- `apps/web/src/components/kanban/KanbanDetailModal.tsx`
- `apps/web/src/features/templates/**`
- `apps/web/src/hooks/crm/useLead.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/web/src/features/crm/CrmListPage.tsx` e `CrmDetailPage.tsx` **se o F13-S03 estiver em andamento** (coordenar — ambos tocam CRM; sequenciar via merge).
- Qualquer `apps/api/**`.

## Contratos de entrada

- Endpoints de F13-S07 disponíveis (interactions, kanban history).

## Definition of Done

- [ ] CRM e Kanban com estados loading/erro/empty do DS (sem dados fake)
- [ ] `useKanbanHistory` expõe `isError`; modal trata
- [ ] Botão sync-all com gating + mensagem clara quando Meta não configurada
- [ ] Testes de estados verdes
- [ ] `pnpm --filter @elemento/web typecheck && lint && test` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test -- crm
pnpm --filter @elemento/web test -- templates
```

## Notas para o agente

- ⚠️ Sobreposição de arquivos com **F13-S03** (CRM list/detail). Coordenar a ordem de merge — não rodar em paralelo com S03.
- A remoção dos mocks já está feita; este slot é sobre **UX dos estados**, não sobre tirar mock.
