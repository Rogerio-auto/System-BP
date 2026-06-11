---
id: F13-S04
title: Follow-up — segmentar por estágio e outcome no frontend
phase: F13
task_ref: null
status: available
priority: medium
estimated_size: S
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: []
blocks: []
labels: []
source_docs:
  - docs/planejamento-2026-06-evolucao.md#épico-g-follow-up-por-estágio-e-segmentação-item-8
  - docs/18-design-system.md
docs_required: true
docs_audience:
  - operador
  - gestor
docs_artifacts:
  - docs/help/guias/follow-up/segmentar-por-estagio.mdx
---

# F13-S04 — Follow-up: segmentar por estágio e outcome no frontend

## Objetivo

Expor no formulário de regras de follow-up os filtros **estágio de Kanban** (`applies_to_stage`) e **outcome** (`applies_to_outcome`), que o backend já suporta mas a UI não permite configurar.

## Contexto

Item 8 do planejamento. As colunas `followup_rules.applies_to_stage` / `applies_to_outcome` já existem e o scheduler as respeita; o seed inclusive cria regras por estágio. O gap é só frontend. Decisão D16: começar por estágio+outcome agora; construtor de segmento avançado fica para fase 2 (fora deste slot).

## Escopo (faz)

- `features/followup/FollowupRulesPage.tsx`: adicionar ao form de criação/edição de regra:
  - dropdown de **estágio de Kanban** (lista de `kanban_stages`) — opcional ("Qualquer estágio").
  - campo de **outcome** — opcional.
- `features/followup/schemas.ts` + `hooks/useFollowup.ts` + `api.ts`: incluir os dois campos no payload de create/update.
- Conferir que a rota backend de create/update de regra aceita os campos; se o Zod do módulo não os inclui, adicioná-los (sem mudar a tabela — já existe).

## Fora de escopo (NÃO faz)

- Construtor de segmento multi-critério (fase 2).
- Régua de cobrança (`collection_rules`) — outro épico.
- Qualquer mudança no scheduler/worker.

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/features/followup/FollowupRulesPage.tsx`
- `apps/web/src/features/followup/schemas.ts`
- `apps/web/src/features/followup/api.ts`
- `apps/web/src/features/followup/hooks/useFollowup.ts`
- `apps/web/src/features/followup/__tests__/**`
- `apps/api/src/modules/followup/schemas.ts`
- `apps/api/src/modules/followup/service.ts`
- `apps/api/src/modules/followup/__tests__/**`
- `docs/help/guias/follow-up/segmentar-por-estagio.mdx`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/db/schema/followupRules.ts` (colunas já existem — não migrar)
- `apps/api/src/workers/**` (scheduler fora de escopo)

## Contratos de entrada

- `followup_rules.applies_to_stage` / `applies_to_outcome` já no banco e respeitados pelo scheduler.

## Definition of Done

- [ ] Form de regra permite escolher estágio de Kanban e outcome (ambos opcionais)
- [ ] Create/update enviam e persistem os campos
- [ ] Backend valida os campos no Zod do módulo (se ainda não validava)
- [ ] `pnpm --filter @elemento/web typecheck && pnpm --filter @elemento/api typecheck` verdes
- [ ] `pnpm test` verde (web followup + api followup)
- [ ] Guia `docs/help/guias/follow-up/segmentar-por-estagio.mdx` criado

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api test -- followup
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test -- followup
```

## Notas para o agente

- A lista de `kanban_stages` provavelmente já tem endpoint/hook (usado pelo board) — reusar para o dropdown.
- `applies_to_stage` casa pelo **nome** do stage (ver schema: "slug válido de kanban_stages, validação app-level"). Confirmar formato esperado pelo scheduler antes de enviar id vs nome.
