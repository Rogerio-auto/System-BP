---
id: F18-S11
title: Backend — endpoint "enviar simulação por WhatsApp" (Onda 2 item 2)
phase: F18
task_ref: docs/planejamento-2026-06-evolucao.md#épico-b--disparo-de-simulação-por-whatsapp-item-2
status: review
priority: medium
estimated_size: M
agent_id: null
claimed_at: 2026-06-16T13:10:16Z
completed_at: 2026-06-16T13:14:00Z
pr_url: null
depends_on: []
blocks: [F18-S12]
labels: [backend, whatsapp, simulation, template]
source_docs:
  - docs/planejamento-2026-06-evolucao.md
docs_required: false
---

# F18-S11 — Backend: endpoint enviar simulação por WhatsApp

## Objetivo

Criar endpoint `POST /api/simulations/:id/send` que envia o resultado de uma simulação ao lead via template WhatsApp, registrando a interação na timeline e garantindo idempotência.

## Contexto

Item 2 (Onda 2). `metaClient.sendTemplate` existe. `POST /api/simulations` existe. Falta o endpoint de disparo. Decisão D4: template dedicado de simulação aprovado na Meta + vínculo configurável no sistema.

## Escopo (faz)

### Endpoint `POST /api/simulations/:id/send`

- RBAC: permissão `simulations:send` (criar no seed se não existir, ou reaproveitar permissão existente de simulations).
- Feature flag: `simulations.send.enabled` (4 camadas — API gate principal).
- Service: (1) busca a simulação com o lead; (2) verifica que o lead tem telefone; (3) verifica que há template `simulacao_resultado` ativo no banco (`whatsapp_templates`); (4) monta variáveis: `{nome, valor_solicitado, prazo, valor_parcela, taxa_mensal}`; (5) chama `metaClient.sendTemplate`; (6) persiste na `interactions` timeline; (7) retorna `200 { message_id }`.
- Idempotência via `idempotency_keys` table (key: `sim-send:{simulationId}:{leadId}:{date}`).
- Emit outbox evento `simulation.sent` (sem PII — apenas IDs) para rastreio.

### Seed de permissão e feature flag

- Seed migration ou seed script para: permissão `simulations:send`, feature flag `simulations.send.enabled` (default: `false`).

### Template do sistema (vínculo)

- Adicionar campo `template_purpose` enum (ou filtro por `name`) em `whatsapp_templates` para identificar o template de simulação. Alternativamente, usar feature flag com o `template_id` direto como valor do flag. Consultar o padrão existente de templates.

## Fora de escopo (NÃO faz)

- Criação do template na Meta (processo externo — o sistema usa o que está aprovado no banco).
- UI (F18-S12).
- Validação de janela de 24h da Meta (responsabilidade do `metaClient` existente).

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/modules/simulations/routes.ts`
- `apps/api/src/modules/simulations/controller.ts`
- `apps/api/src/modules/simulations/service.ts`
- `apps/api/src/modules/simulations/repository.ts`
- `apps/api/src/modules/simulations/schemas.ts`
- `apps/api/src/events/types.ts`
- `apps/api/src/db/migrations/0063_sim_send_permission_flag.sql` (se necessário)
- `apps/api/src/db/migrations/meta/_journal.json` (se necessário)
- `apps/api/src/db/seed/permissions.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/db/schema/**`
- `apps/web/**`
- `apps/api/src/templates/**` (somente importar `metaClient`)

## Definition of Done

- [ ] `POST /api/simulations/:id/send` retorna `200` com `message_id`.
- [ ] Lead sem telefone: `422 LEAD_NO_PHONE`.
- [ ] Template não encontrado: `422 TEMPLATE_NOT_CONFIGURED`.
- [ ] Idempotência: segunda chamada retorna sem reenviar.
- [ ] Feature flag `simulations.send.enabled = false` → `403`.
- [ ] RBAC: `simulations:send`.
- [ ] Evento `simulation.sent` no outbox (sem PII).
- [ ] Testes: sucesso, lead sem tel, template ausente, idempotência, flag off.
- [ ] `pnpm --filter @elemento/api typecheck && lint && test -- simulation` verdes.

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- simulation
```

## Notas para o agente

- Leia `apps/api/src/modules/simulations/` completo antes de editar.
- Leia `apps/api/src/templates/metaClient.ts` para entender como `sendTemplate` funciona.
- Leia `apps/api/src/modules/billing/service.ts` ou equivalente para ver como outros módulos chamam `sendTemplate`.
- As variáveis do template devem ser strings — formatar `valor_parcela` como `"R$ 1.234,56"` (não número bruto).
- Não coloque nome/telefone/CPF no payload do evento outbox — apenas IDs.
