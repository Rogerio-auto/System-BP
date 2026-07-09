---
id: F24-S06
title: Backend — fan-out rules-driven por evento + registro no outbox + dedup
phase: F24
task_ref: docs/planejamento-notificacoes.md
status: review
priority: high
estimated_size: L
agent_id: null
depends_on: [F24-S03, F24-S04, F24-S05, F24-S09]
blocks: [F24-S07, F24-S08, F24-S14]
labels: [backend, notifications, outbox, multi-tenant, lgpd-impact]
source_docs: [docs/planejamento-notificacoes.md, docs/04-eventos.md, docs/17-lgpd-protecao-dados.md]
docs_required: false
claimed_at: 2026-07-08T18:24:44Z
completed_at: 2026-07-08T22:03:18Z
---

# F24-S06 — Backend: fan-out rules-driven + wiring no outbox

## Objetivo

Reescrever o handler de fan-out para ser **dirigido por `notification_rules`** (não mais
hard-coded) e **registrá-lo no worker do outbox** para todos os eventos do catálogo, com
idempotência por `event_id` e dedup/cooldown via `notification_rule_deliveries`.

## Contexto

Planejamento §4.1–§4.4. Gap crítico: `handleFanoutNotification` existe mas **não está registrado**
(`events/handlers.ts`/`workers/index.ts`) — nada notifica hoje. Reusar `recipients.ts` (F24-S05),
o catálogo (F24-S04), `isCategoryChannelEnabled` (F24-S09) e os senders in-app/email (F24-S03).

## Escopo (faz)

- Reescrever `handlers/fanout-notification.ts`:
  - Para o evento recebido, buscar `notification_rules` `enabled` da org com `trigger_kind='event'`
    e `trigger_key = eventName`; aplicar `filters` (cidade/produto).
  - Resolver destinatários por `recipient_mode`; para cada um, checar `isCategoryChannelEnabled`
    por canal da regra; renderizar `title_template`/`body_template` (sem PII bruta).
  - Idempotência: pular se já houver delivery `(rule_id, entity_type, entity_id, bucket=event_id)`;
    gravar delivery após despachar. Despacho in-app + email (S03); falha de 1 canal não derruba o outro.
- Registrar o handler para todos os eventos do catálogo em `events/handlers.ts` (ou `workers/index.ts`).
- Atualizar/realocar testes do fan-out.

## Fora de escopo (NÃO faz)

- Estagnação/worker periódico (F24-S07).
- Push em tempo real (F24-S08) — aqui só persiste in-app + email.
- UI.

## Arquivos permitidos

- `apps/api/src/handlers/fanout-notification.ts`
- `apps/api/src/handlers/index.ts`
- `apps/api/src/events/handlers.ts`
- `apps/api/src/workers/index.ts`
- `apps/api/src/modules/notifications/senders/inApp.ts`
- `apps/api/src/handlers/__tests__/fanout-notification.test.ts`

## Arquivos proibidos

- `apps/web/**`
- `apps/langgraph-service/**`
- `apps/api/src/db/migrations/**`
- `apps/api/src/plugins/**`

## Definition of Done

- [ ] Fan-out lê `notification_rules` (event) e aplica filtros/destinatários/canais/templates
- [ ] Handler registrado no outbox para os eventos do catálogo
- [ ] Idempotência por `event_id` + dedup via `notification_rule_deliveries`
- [ ] Preferências por categoria honradas; falha de canal isolada
- [ ] Templates/logs sem PII bruta (redact)
- [ ] Testes verdes; checklist LGPD §14.2 no PR
- [ ] `pnpm --filter @elemento/api typecheck` + `lint` + `test` verdes

## Validação

```powershell
pnpm --filter @elemento/shared-schemas build
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
python scripts/slot.py validate F24-S06
```

## Notas para o agente

- `bucket=event_id` para evento garante 1 disparo por (regra, entidade, evento) mesmo com reprocesso.
- Reusar `recipients.ts` e o helper de template; não duplicar resolução.
- `featureGate` não se aplica a handler — checar `notifications.rules.enabled` via `requireFlag` no início.
