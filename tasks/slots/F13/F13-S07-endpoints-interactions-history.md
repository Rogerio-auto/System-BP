---
id: F13-S07
title: Endpoints de timeline — interactions do lead + histórico do card Kanban
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
blocks: [F13-S08]
labels: []
source_docs:
  - docs/planejamento-2026-06-evolucao.md
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F13-S07 — Endpoints de timeline (interactions do lead + histórico do card)

## Objetivo

Implementar os dois endpoints GET que o frontend já consome mas **não existem no backend** (hoje retornam 404), eliminando a necessidade dos mock-fallbacks que mostravam dados fictícios.

## Contexto

Descoberto na bateria de smoke (2026-06-10): `GET /api/leads/:id/interactions` e `GET /api/kanban/cards/:cardId/history` davam 404 → os hooks do front caíam em **dados fake hardcoded**. Os mocks já foram removidos nesta sessão (os hooks agora chamam a API real); falta o backend existir. As tabelas `interactions` (116 linhas no seed) e `kanban_stage_history` já existem. Ver memória `project_crm_mock_fallbacks`.

## Escopo (faz)

- `GET /api/leads/:id/interactions` — timeline de interações do lead.
  - RBAC: permissão de leitura de lead + **escopo de cidade** via `lead.city_id` (regra #3).
  - Fonte: tabela `interactions` (e/ou `lead_history` para eventos de sistema) ordenada por `created_at`.
  - Mapear para o shape consumido pelo front (`LeadInteraction`: `id`, `leadId`, `type`, `content`, `actorName`, `createdAt`).
  - **LGPD (doc 17):** `content` pode conter PII de conversa — aplicar `pino.redact` nos logs; não expor PII bruta além do necessário; seguir o mascaramento já usado no CRM (teste "timeline não expõe PII bruta").
  - Paginação (limit/cursor) coerente com os outros endpoints de lead.
- `GET /api/kanban/cards/:cardId/history` — histórico de movimentação do card.
  - RBAC + escopo de cidade via o lead do card.
  - Fonte: `kanban_stage_history` (join `kanban_stages` para os nomes from/to).
  - Shape `KanbanStageHistory` (`id`, `cardId`, `fromStageId`, `toStageId`, `fromStageName`, `toStageName`, `actorName`, `note`, `createdAt`).
- Testes de rota (positivo + negativo de RBAC/city-scope) + fixtures.

## Fora de escopo (NÃO faz)

- Frontend (estados de erro/empty, gating) — é o F13-S08.
- Escrita de interações/histórico (só leitura).

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/modules/leads/routes.ts`
- `apps/api/src/modules/leads/controller.ts`
- `apps/api/src/modules/leads/service.ts`
- `apps/api/src/modules/leads/repository.ts`
- `apps/api/src/modules/leads/schemas.ts`
- `apps/api/src/modules/leads/__tests__/**`
- `apps/api/src/modules/kanban/routes.ts`
- `apps/api/src/modules/kanban/controller.ts`
- `apps/api/src/modules/kanban/service.ts`
- `apps/api/src/modules/kanban/repository.ts`
- `apps/api/src/modules/kanban/schemas.ts`
- `apps/api/src/modules/kanban/__tests__/**`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/db/schema/**` (tabelas já existem — não migrar)
- `apps/web/**` (dono é F13-S08)

## Contratos de saída

- `GET /api/leads/:id/interactions` → `LeadInteraction[]` (ou envelope paginado coerente com o front).
- `GET /api/kanban/cards/:cardId/history` → `KanbanStageHistory[]`.

## Definition of Done

- [ ] Ambos endpoints implementados com Zod + RBAC + city-scope
- [ ] LGPD: PII de `content` tratada (redact nos logs; sem PII bruta indevida)
- [ ] Testes positivo + negativo (sem permissão / fora de cidade) verdes
- [ ] Shapes batem com os tipos do front (`LeadInteraction`, `KanbanStageHistory`)
- [ ] `pnpm --filter @elemento/api typecheck && lint && test` verdes
- [ ] Smoke: `GET /api/leads/:id/interactions` e `/api/kanban/cards/:id/history` retornam 200 com dados do seed

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- leads
pnpm --filter @elemento/api test -- kanban
```

## Notas para o agente

- O front espera `actorName` — derivar de `lead_history.actor_user_id`/`users` quando aplicável; para mensagens de WhatsApp, usar o canal/direção para compor o tipo.
- Mapear `interactions.channel`/`direction` → `LeadInteraction.type` (`system`/`note`/`status_change`/`whatsapp`).
- Confirmar os tipos reais em `apps/web/src/hooks/crm/types.ts` e `apps/web/src/hooks/kanban/types.ts`.
