---
id: F14-S05
title: Backend — disparo de simulação por WhatsApp
phase: F14
task_ref: null
status: review
priority: high
estimated_size: M
agent_id: null
claimed_at: 2026-06-11T20:00:16Z
completed_at: 2026-06-11T20:23:56Z
pr_url: null
depends_on: []
blocks: [F14-S06]
labels: []
source_docs:
  - docs/planejamento-2026-06-evolucao.md#épico-b-disparo-de-simulação-por-whatsapp-item-2
  - docs/07-integracoes-whatsapp-chatwoot.md
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F14-S05 — Backend: disparo de simulação por WhatsApp

## Objetivo

Permitir enviar ao cliente, por WhatsApp, uma mensagem com os dados da simulação criada manualmente — via template aprovado da Meta.

## Contexto

Item 2 / Épico B. Decisão D4: criar um **template Meta dedicado de simulação**. Já existem `whatsapp_templates`, `metaClient` (envio) e o motor usado por cobrança/follow-up. Falta o endpoint que monta as variáveis da simulação e dispara.

## Escopo (faz)

- Seed/registro do **template de simulação** (`whatsapp_templates`, ex: key `simulacao_resultado`) com variáveis: nome, valor, parcelas, valor da parcela, taxa — migration de seed (`0053_*` — confirmar próximo livre) ou reaproveitar o cadastro existente de templates.
- Endpoint `POST /api/simulations/:id/send`:
  - RBAC: permissão de simulação (reusar existente ou `simulations:send` — seed se nova).
  - Monta as variáveis a partir da simulação + lead; chama `metaClient.sendTemplate` (mesma esteira de cobrança/follow-up).
  - Registra a interação na timeline (`interactions`, channel whatsapp, outbound).
  - **Idempotência** via header `Idempotency-Key` (regra #7) — não reenviar a mesma simulação.
  - **Feature flag** (4 camadas, regra #6) — ex: `simulations.send.enabled`; gated.
  - Trata Meta indisponível/não configurada com erro claro (não 500 cru) — alinhado ao gating do sync-all (F13-S08).
- Testes de rota + service (positivo, sem telefone, flag off, idempotente).

## Fora de escopo (NÃO faz)

- Frontend do botão (F14-S06).
- Lead PJ / email (F14-S01..S04).

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/modules/simulations/service.ts`
- `apps/api/src/modules/simulations/routes.ts`
- `apps/api/src/modules/simulations/controller.ts`
- `apps/api/src/modules/simulations/schemas.ts`
- `apps/api/src/modules/simulations/__tests__/**`
- `apps/api/src/db/migrations/0053_seed_simulation_template_flag.sql`
- `apps/api/src/db/migrations/meta/_journal.json`
- `apps/api/src/db/seed/permissions.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/modules/templates/metaClient.ts` (consumir, não editar)
- `apps/web/**` (dono é F14-S06)

## Contratos de saída

- `POST /api/simulations/:id/send` → `200 { status, sent_message_id }` (ou erro tipado claro).
- Template `simulacao_resultado` + flag `simulations.send.enabled`.

## Definition of Done

- [ ] Endpoint envia o template de simulação com variáveis corretas
- [ ] RBAC + feature flag (4 camadas) + idempotência aplicadas
- [ ] Interação registrada na timeline (outbound, sem PII bruta no outbox)
- [ ] Meta indisponível → erro claro (não 500)
- [ ] Testes verdes; `pnpm --filter @elemento/api typecheck && lint && test -- simulations`

## Comandos de validação

```powershell
python scripts/slot.py check-migrations
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- simulations
```

## Notas para o agente

- Reaproveitar a esteira de envio Meta de cobrança/follow-up (`metaClient.sendTemplate`) — não reimplementar.
- LGPD: mensagem ao titular = tratamento; valores financeiros ok; sem PII bruta no outbox.
- Template precisa estar `approved` na Meta para enviar fora da janela de 24h — em dev usar mock; documentar.
