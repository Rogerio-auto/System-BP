---
id: F6-S30
title: Backend — escalar lead ao Departamento de Crédito (human-in-the-loop, via notificação)
phase: F6
task_ref: docs/22-agente-interno-acoes.md
status: available
priority: medium
estimated_size: L
agent_id: null
depends_on: [F6-S08, F24-S06]
blocks: [F6-S31]
labels: [backend, ai-assistant, notifications, rbac, lgpd-impact]
source_docs:
  [docs/22-agente-interno-acoes.md, docs/17-lgpd-protecao-dados.md, docs/10-seguranca-permissoes.md]
docs_required: false
---

# F6-S30 — Backend: escalar lead ao Crédito

## Objetivo

Permitir que um operador, a partir do copiloto, **notifique o analista de crédito da matriz** sobre um
lead — human-in-the-loop (a IA propõe/oferece, o humano confirma). Reusa a engine de notificação (F24) e o
molde de ação auditada do F25 (`ai-actions`). A IA **nunca** escala sozinha.

## Contexto

- Destinatário: **analista de crédito da matriz** (Ariquemes) — independe da cidade do lead.
  A matriz é `organizations.settings.matriz_city_id` (config; setar = city_id de Ariquemes).
  Resolver via `resolveByRoleCity` (F24, `notification-rules/recipients.ts`) com os roles que têm
  `credit_analyses:decide` escopados à matriz. **Fallback:** `gestor_geral` (escopo global). Se
  `matriz_city_id` não configurado, usar o fallback global.
- Notificação: `sendInApp` (`notifications/senders/inApp.ts`) + email (F24, quando a env do Resend estiver
  ligada — o gate de 2 camadas do F24-S18 cuida disso; nada a fazer aqui além de disparar o canal).
- Molde: `apps/api/src/modules/ai-actions/` (ação idempotente, audit com o USUÁRIO como ator, evento no
  outbox, sem PII bruta).

## Escopo (faz)

- Migration `0088`: permissão `assistant:escalate` concedida a **todos os roles de operador** (qualquer
  operador com acesso ao lead pode escalar — decisão do Rogério). ON CONFLICT idempotente + journal.
- Endpoint `POST /api/assistant/escalate` `{ lead_id, note? }`:
  - **RBAC:** `assistant:escalate` + o lead no **escopo de cidade** do usuário (senão 404, sem vazar).
  - **Resolver destinatários** (analistas da matriz, ver Contexto). Zero destinatário → 409 claro.
  - **Idempotência:** dedup por (lead_id + janela curta, ex.: 1h) — não escalar o mesmo lead repetidamente.
  - **Notificar** cada destinatário (`sendInApp` + canal email do F24): `type='assistant.escalation'`,
    título/corpo referenciando o lead + a `note` — **sem PII bruta** (referência ao lead + resumo mínimo;
    o analista abre com o próprio escopo). LGPD §8.5: outbox/evento sem PII bruta.
  - **Audit:** `auditLog` com o **usuário humano** como ator (`actor_type='user'`), ação
    `assistant.lead_escalated`. **Evento** `assistant.escalation.created` no outbox (mesma transação).
- Validação Zod. Nunca logar PII.

## Fora de escopo (NÃO faz)

- Frontend (F6-S31). Configurar a env do Resend (o Rogério faz). Persistência de histórico (outro épico).

## Arquivos permitidos

- `apps/api/src/modules/assistant-escalation/**`
- `apps/api/src/app.ts`
- `apps/api/src/events/types.ts`
- `apps/api/src/db/migrations/**`

## Arquivos proibidos

- `apps/web/**`, `apps/langgraph-service/**`, `apps/api/src/modules/notification-rules/recipients.ts` (só CHAMAR)

## Definition of Done

- [ ] `POST /api/assistant/escalate` com `assistant:escalate` + escopo de cidade do lead (404 fora)
- [ ] Destinatários = analistas da matriz (settings.matriz_city_id; fallback gestor_geral global); zero → 409
- [ ] Idempotência (dedup lead+janela); notificação in-app + canal email; sem PII bruta no outbox/evento
- [ ] Audit com o usuário humano (`actor_type='user'`); evento no outbox na mesma transação
- [ ] Migration 0088 (permissão a operadores) + journal + check-migrations OK
- [ ] Testes: happy path, fora de escopo (404), sem destinatário (409), idempotência, sem PII em log/evento
- [ ] `pnpm --filter @elemento/api typecheck` + `lint` + `test` verdes

## Validação

```powershell
python scripts/slot.py check-migrations
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
```

## Notas para o agente

- **Não** coloque `slot.py validate` no bloco Validação (fork bomb). Não rode `taskkill python`.
- Reuse `resolveByRoleCity` (não reimplemente) e `sendInApp`. Espelhe o padrão de audit/idempotência/emit do
  `ai-actions/service.ts`. `emit()` com `onConflictDoNothing` para idempotência determinística.
- `lgpd-impact`: checklist §14.2 do doc 17 no PR. É a **primeira ação de escrita** do copiloto — o
  human-in-the-loop (confirmação no F6-S31) é o eixo de segurança; aqui garanta RBAC + audit + sem PII.
