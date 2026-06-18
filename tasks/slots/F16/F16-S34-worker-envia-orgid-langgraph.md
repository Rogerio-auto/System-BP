---
id: F16-S34
title: Worker livechat-ai envia organization_id no request ao LangGraph
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
blocks: [F16-S35]
labels: []
source_docs:
  - docs/06-langgraph-agentes.md
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F16-S34 — Worker envia organization_id ao LangGraph

## Objetivo

Incluir `organization_id` no request que o worker `livechat-ai.ts` envia ao LangGraph, para que o
serviço possa repassá-lo a todas as chamadas `/internal/*` de escrita (que exigem `organization_id`).

## Contexto

**Blocker do agente IA (lado backend).** O `organization_id` é conhecido no worker
(`livechat-ai.ts` — vem do job, `job.organizationId`), mas o tipo `LangGraphWhatsAppRequest`
(`integrations/langgraph/schemas.ts`) **não tem campo `organization_id`** e o worker monta o request
sem ele. Consequência: o LangGraph não tem org e TODA chamada de escrita ao backend
(`POST /internal/leads/get-or-create`, `PUT /internal/conversations/:id/state`,
`POST /internal/ai/decisions`) volta **400 `organization_id é obrigatório`**. Diagnóstico com logs
reais (sessão 2026-06-18). Par do F16-S35 (lado LangGraph).

## Escopo (faz)

- Adicionar `organization_id: z.string().uuid()` ao schema/tipo `LangGraphWhatsAppRequest` em
  `apps/api/src/integrations/langgraph/schemas.ts`.
- No worker `apps/api/src/workers/livechat-ai.ts`, incluir `organization_id: organizationId` no
  objeto `langGraphRequest`.
- Atualizar o teste do worker para asserir que o request enviado contém `organization_id`.

## Fora de escopo (NÃO faz)

- Qualquer mudança no serviço LangGraph (`apps/langgraph-service/**`) — isso é o F16-S35.
- Mudar o contrato dos endpoints `/internal/*` (já exigem org_id, está correto).

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/integrations/langgraph/schemas.ts`
- `apps/api/src/workers/livechat-ai.ts`
- `apps/api/src/workers/__tests__/livechat-ai.test.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/langgraph-service/**` (F16-S35)
- `apps/api/src/modules/internal/**`

## Contratos de saída

- O request POST `/process/whatsapp/message` enviado pelo backend passa a conter
  `organization_id` (uuid) além de `conversation_id`, `customer_phone`, etc.

## Definition of Done

- [ ] `LangGraphWhatsAppRequest` tem `organization_id` (uuid)
- [ ] Worker preenche `organization_id` a partir do job
- [ ] Teste assere org_id no request enviado
- [ ] `pnpm --filter @elemento/api typecheck` / `lint` / `test` verdes
- [ ] PR aberto com link para o slot

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
```

## Notas para o agente

- Não logar `customer_phone`/PII. O org_id não é PII.
- Mantenha o request retrocompatível: adicionar o campo não deve quebrar consumidores existentes.
