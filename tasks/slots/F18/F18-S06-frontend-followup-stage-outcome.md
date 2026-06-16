---
id: F18-S06
title: Frontend — follow-up por estágio e outcome (Onda 1 item 8)
phase: F18
task_ref: docs/planejamento-2026-06-evolucao.md#épico-g--follow-up-por-estágio-e-segmentação-item-8
status: available
priority: medium
estimated_size: S
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: []
blocks: []
labels: [frontend, followup]
source_docs:
  - docs/planejamento-2026-06-evolucao.md
  - docs/18-design-system.md
docs_required: false
---

# F18-S06 — Frontend: follow-up por estágio e outcome

## Objetivo

Expor os campos `applies_to_stage` e `applies_to_outcome` no formulário de criação/edição de regras de follow-up.

## Contexto

Item 8 (Onda 1 quick win). O **backend já suporta** `followup_rules.applies_to_stage` e `applies_to_outcome`. O gap é apenas no frontend: o form de regra de follow-up não expõe esses filtros. A decisão D16 é: expor `stage + outcome` agora, construtor de segmento depois.

## Escopo (faz)

- No form de criação/edição de regra de follow-up (`features/followup/`):
  - **Campo `applies_to_stage`**: dropdown com os `kanban_stages` disponíveis. Obter via `GET /api/kanban/stages` (ou usar lista estática se os stages forem fixos — verificar). Valor vazio = aplica a todos os estágios.
  - **Campo `applies_to_outcome`**: select com `closed_won`, `closed_lost`, `archived`, `any` (valor vazio/null = qualquer outcome).
- Incluir esses campos no body da mutation de criar/editar regra.
- Exibir os valores na listagem de regras (texto descritivo: "Estágio: Simulação" ou "Todos os estágios").

## Fora de escopo (NÃO faz)

- Construtor de segmento avançado (fase 2, explicitamente excluído por D16).
- Backend — já pronto.

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/features/followup/**`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/**`
- `packages/shared-schemas/**`

## Contratos de entrada

- `followup_rules.applies_to_stage` (string nullable) e `applies_to_outcome` (string nullable) já existem no response.
- `FollowupRuleCreateSchema` em `packages/shared-schemas` — verificar se já tem os campos (provavelmente sim).

## Definition of Done

- [ ] Dropdown de estágio no form de follow-up.
- [ ] Select de outcome no form.
- [ ] Valores exibidos na listagem de regras.
- [ ] `pnpm --filter @elemento/web typecheck && lint` verdes.

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
```

## Notas para o agente

- Leia `apps/web/src/features/followup/` completo antes de editar.
- Se os `kanban_stages` vierem de API, use o hook existente. Se forem enum fixo no shared-schema, use diretamente.
- Não altere o schema shared — o backend já aceita os campos; só verifique que o form os envia no body.
