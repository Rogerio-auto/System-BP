---
id: F16-S32
title: Permitir criar lead sem city_id no canal IA (remover guard obsoleto)
phase: F16
task_ref: docs/06-langgraph-agentes.md
status: available
priority: critical
estimated_size: XS
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: []
blocks: [F16-S30]
labels: [lgpd-impact]
source_docs:
  - docs/06-langgraph-agentes.md
  - docs/17-lgpd-protecao-dados.md
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F16-S32 — Criar lead sem city_id no canal IA (remover guard obsoleto)

## Objetivo

Permitir que `getOrCreateLead`/`createNewLead` crie um **lead-shell sem `city_id`** quando o canal
IA (LangGraph) chama `/internal/leads/get-or-create` no primeiro contato, em vez de retornar 422.

## Contexto

**Blocker de produção do agente IA do livechat.** Hoje `createNewLead`
(`apps/api/src/modules/leads/service.ts`) tem um guard que lança `AppError 422` quando `city_id` é
`undefined` — comentado como tech debt à espera de "migration 23 tornar a coluna nullable". **Essa
migration já foi aplicada:** `leads.city_id` é `nullable: YES` no banco e o schema Drizzle
(`db/schema/leads.ts:104`) já é `uuid('city_id')` sem `.notNull()`. O guard ficou obsoleto e agora
**bloqueia todo primeiro contato**: o nó `identify_or_create_lead` do grafo nunca envia `city_id`
(a cidade é desconhecida numa saudação), recebe 422, cai em handoff — que por sua vez exige um lead
que não existe — e a conversa morre no timeout sem responder o cidadão. (Diagnóstico em sessão
2026-06-17 com logs reais do LangGraph.)

## Escopo (faz)

- Em `createNewLead` (`apps/api/src/modules/leads/service.ts`):
  - **Remover** o guard `if (input.cityId === undefined) throw new AppError(422, ...)`.
  - Passar `cityId: input.cityId ?? null` para `insertLead` (remover o `as string`).
- Confirmar que o restante já lida com `city_id` null (kanban via `findInitialStage` por org; outbox
  `leads.created`/`kanban.card_created` carregam `city_id` apenas como dado; audit `redactLeadPii`).
  Nenhum desses exige cidade — só validar, sem reescrever.
- Teste: `POST /internal/leads/get-or-create` **sem** `city_id` para telefone novo → **200**,
  `created: true`, `city_id: null` (não 422). Manter o caso com `city_id` funcionando.

## Fora de escopo (NÃO faz)

- Mexer no nó do grafo `identify_or_create_lead` (forwarding de city_id é outro caminho; aqui o
  desbloqueio é no backend — cidade é resolvida depois por `identify_city`/`PATCH /internal/leads/:id`).
- Mudar o pipeline antigo `whatsapp/handlers/**`.
- Alterar a coluna/schema (já nullable) ou criar migration.

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/modules/leads/service.ts`
- `apps/api/src/modules/internal/leads/__tests__/routes.test.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/db/schema/leads.ts` (já correto — não tocar)
- `apps/api/src/workers/livechat-ai.ts` (F16-S30)
- `apps/api/src/modules/livechat/**`

## Contratos de entrada

- `GetOrCreateLeadInput.cityId?: string` (já opcional no tipo).
- `insertLead` aceita `cityId: string | null` (schema Drizzle nullable).

## Contratos de saída

- `POST /internal/leads/get-or-create` sem `city_id` (telefone novo) → 200 `{ created: true, city_id: null, ... }`.

## Definition of Done

- [ ] Guard de `city_id` removido; `insertLead` recebe `cityId: input.cityId ?? null`
- [ ] Sem `as string` injustificado no `cityId`
- [ ] Teste: get-or-create sem city_id (telefone novo) → 200 created, city_id null
- [ ] Teste existente com city_id continua verde
- [ ] `pnpm --filter @elemento/api typecheck` / `lint` / `test` verdes
- [ ] Checklist LGPD §14.2 (doc 17) no PR + label `lgpd-impact` (toca criação de lead/PII)
- [ ] PR aberto com link para o slot

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
```

## Notas para o agente

- Não logar telefone/nome (PII) — cobertos por `pino.redact`; o teste não deve imprimir PII.
- A cidade null é estado transitório esperado: o lead entra no kanban (estágio inicial por org) e a
  cidade é preenchida depois quando o cidadão informa (fluxo `identify_city` + `PATCH /internal/leads/:id`).
- Manter o mapeamento de erro de unique-violation (`LeadMergeRequiredError`) intacto.
