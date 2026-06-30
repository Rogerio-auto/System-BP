---
id: F24-S04
title: Backend — catálogo de gatilhos + schemas Zod de regras (shared-schemas)
phase: F24
task_ref: docs/planejamento-notificacoes.md
status: done
priority: high
estimated_size: M
agent_id: null
depends_on: []
blocks: [F24-S05, F24-S06, F24-S07]
labels: [backend, notifications, shared-schemas]
source_docs: [docs/planejamento-notificacoes.md, docs/04-eventos.md]
docs_required: false
claimed_at: 2026-06-30T17:04:45Z
completed_at: 2026-06-30T17:19:56Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/394

---
# F24-S04 — Backend: catálogo de gatilhos + schemas de regra

## Objetivo

Definir o **catálogo fechado** de gatilhos de notificação (eventos + eixos de inatividade) e os
schemas Zod compartilhados das regras, em `@elemento/shared-schemas`, para o front e a API
consumirem o mesmo contrato (evita drift).

## Contexto

Planejamento §4.1/§4.2. O catálogo é a lista validada que o Admin escolhe num dropdown — não há
chave livre. Cada entrada declara `key`, `kind`, `category`, `entityType`, placeholders permitidos
e (para inatividade) a fonte de timestamp. Eventos vêm de `docs/04-eventos.md` / `events/types.ts`.
Já existe `packages/shared-schemas/src/notifications.ts` — estender ou criar `notification-rules.ts`.

## Escopo (faz)

- Catálogo (`packages/shared-schemas/src/notification-rules.ts`):
  - Enum de categorias: `lifecycle_stalled|assignment|credit|billing|handoff|system`.
  - Enum `trigger_kind`, `recipient_mode`, `severity`, `channel`.
  - `TRIGGER_CATALOG`: array tipado de entradas (event triggers: `simulations.generated`,
    `credit_analysis.status_changed`, `chatwoot.handoff_requested`, `contract.signed`,
    `contract.near_end`, `payment_due.overdue_15d`, `billing.collection_sent`, `task.created`,
    `customer.law_firm_referred`; inactivity triggers: `kanban_stage:*`, `handoff:requested`,
    `simulation:sent_no_reply`, `analysis:pendente`, `contract:draft_unsigned`,
    `payment_due:overdue`, `conversation:no_reply`).
  - Schemas Zod: `notificationRuleCreateSchema`, `notificationRuleUpdateSchema`,
    `notificationRuleResponseSchema`, `notificationRuleListResponseSchema`,
    `notificationRuleTestResponseSchema` (preview de destinatários).
  - Validação cruzada: `threshold_hours` obrigatório se `trigger_kind='stage_inactivity'`;
    `trigger_key` ∈ catálogo; placeholders do template ⊆ permitidos do gatilho.
- Exportar tudo em `packages/shared-schemas/src/index.ts`.

## Fora de escopo (NÃO faz)

- Persistência, rotas ou worker (slots seguintes).
- UI.

## Arquivos permitidos

- `packages/shared-schemas/src/notification-rules.ts`
- `packages/shared-schemas/src/index.ts`
- `packages/shared-schemas/src/__tests__/notification-rules.test.ts`

## Arquivos proibidos

- `apps/web/**`
- `apps/langgraph-service/**`
- `apps/api/src/**`

## Definition of Done

- [ ] `TRIGGER_CATALOG` tipado e fechado, com placeholders por gatilho
- [ ] Schemas Zod create/update/response/list/test exportados
- [ ] Validação cruzada threshold/trigger_key/placeholders
- [ ] Testes de schema (válido/ inválido) verdes
- [ ] `pnpm --filter @elemento/shared-schemas build` + test verdes

## Validação

```powershell
pnpm --filter @elemento/shared-schemas build
pnpm --filter @elemento/shared-schemas test
python scripts/slot.py validate F24-S04
```

## Notas para o agente

- `shared-schemas` é runtime-build: garantir export em `index.ts` e geração de dist.
- Catálogo é a fonte da verdade compartilhada — sem `any`, tudo `as const` + inferência.
