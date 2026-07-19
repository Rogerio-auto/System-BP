---
id: F26-S02
title: Backend — enriquecer contexto das notificações (handoff, escalação, SLA)
phase: F26
task_ref: docs/sessions/2026-07-19-notificacoes-arquitetura-e-gaps.md
status: done
priority: high
estimated_size: M
agent_id: null
depends_on: []
blocks: []
labels: [backend, notifications, lgpd-impact]
source_docs:
  [
    docs/23-notificacoes.md,
    docs/17-lgpd-protecao-dados.md,
    docs/sessions/2026-07-19-notificacoes-arquitetura-e-gaps.md,
  ]
docs_required: false
claimed_at: 2026-07-19T17:28:47Z
completed_at: 2026-07-19T17:58:02Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/424
---

# F26-S02 — Backend: enriquecer contexto das notificações

## Objetivo

Deixar as notificações **informativas** em vez de genéricas: corpo de handoff/escalação com
contexto operacional (motivo, tempo esperando, refs para deep-link) e contexto de template do
worker de SLA com os placeholders que o catálogo anuncia. Corrige gaps G4 e G8 (doc 23 §12.3/§14),
respeitando LGPD (sem PII bruta no outbox, `pino.redact`, resumo da IA permanece fora do evento).

## Contexto

Análise em `docs/sessions/2026-07-19-notificacoes-arquitetura-e-gaps.md` e doc 23 §12.3/§13/§14.

- **Handoff ad-hoc** (`livechat/ai-handoff.ts`): body hoje é _"Uma conversa no WhatsApp (cidade)
  precisa de atendimento humano."_ — só o município.
- **Escalação ad-hoc** (`assistant-escalation/service.ts`): body genérico + nota opcional.
- **Fan-out de handoff** (`internal/handoffs/service.ts`): carimba `aggregateType: 'lead'` →
  a linha fica com `entity_type='lead'`, não `conversation` (pegadinha de deep-link, doc 23 §13).
- **Worker SLA** (`workers/notification-sla-scan.ts`): monta contexto de template só com
  `{ entity_id, entity_type, city_id }`; placeholders ricos do catálogo (`lead_id`,
  `chatwoot_conversation_id`, `hours_stalled`, `stage_name`) renderizam **literais**.

## Escopo (faz)

- **Handoff/escalação:** enriquecer o body com contexto **não-sensível** — motivo do handoff,
  tempo esperando (derivável), e ids de entidade para deep-link. Manter o município. **Não**
  embutir CPF/telefone; resumo bruto da IA continua blanked no evento (LGPD §8.5).
- **Deep-link do handoff:** fazer a notificação apontar para a **conversa** (não só o lead) — via
  ajuste do aggregate/entity ref no `internal/handoffs/service.ts` e/ou no sender ad-hoc, de forma
  que o frontend consiga abrir a conversa correta. Documentar a escolha no PR.
- **Contexto do worker de SLA:** os finders de `sla-sources.ts` retornam os campos por eixo
  (`lead_id`, `chatwoot_conversation_id`/`conversation_id`, `hours_stalled`, `stage_name`, etc.)
  e o worker injeta esses valores no contexto de `renderTemplate`, de modo que os placeholders
  declarados no `TRIGGER_CATALOG` resolvam de fato (ids opacos + métricas, sem PII bruta).
- Testes cobrindo: body enriquecido, entity ref do handoff apontando para a conversa, e um eixo
  de SLA renderizando `{{hours_stalled}}`/`{{chatwoot_conversation_id}}` sem token literal.

## Fora de escopo (NÃO faz)

- Frontend / lista / toast (F26-S01).
- Coluna `severity` (F26-S03).
- Novos placeholders no catálogo além dos já declarados; podar catálogo.
- Persistir nome/telefone do cidadão no body em repouso — decisão LGPD separada (não fazer aqui).

## Arquivos permitidos

- `apps/api/src/modules/livechat/ai-handoff.ts`
- `apps/api/src/modules/assistant-escalation/service.ts`
- `apps/api/src/modules/internal/handoffs/service.ts`
- `apps/api/src/modules/notification-rules/sla-sources.ts`
- `apps/api/src/workers/notification-sla-scan.ts`
- `apps/api/src/**/*.test.ts`

## Arquivos proibidos

- `apps/web/**`
- `apps/langgraph-service/**`
- `apps/api/src/db/migrations/**`
- `apps/api/src/db/schema/**`
- `packages/shared-schemas/**`

## Definition of Done

- [ ] Body de handoff inclui motivo + tempo esperando; escalação idem (sem PII bruta)
- [ ] Notificação de handoff resolve deep-link para a **conversa** correta
- [ ] Worker de SLA injeta os placeholders por eixo; template com `{{hours_stalled}}` etc. renderiza valor real
- [ ] `event_outbox` continua sem PII bruta; `pino.redact` cobre qualquer campo novo sensível
- [ ] Testes novos verdes; `pnpm --filter @elemento/api typecheck` + `lint` + `test` + `build` verdes
- [ ] Checklist LGPD §14.2 (doc 17) preenchido na descrição do PR; label `lgpd-impact`

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
pnpm --filter @elemento/api build
```

## Notas para o agente

- **LGPD é lei aqui** (label `lgpd-impact`): contexto enriquecido usa dado operacional/ids, não
  PII bruta. Nada de CPF/telefone no body ou no outbox. O resumo da IA permanece fora do evento.
- Tempo esperando: derive de timestamps já disponíveis (ex.: `chatwoot_handoffs.created_at`,
  `conversations.last_inbound_at`) — não crie coluna.
- O ajuste de entity ref do handoff destrava o F26-S01/S04 para abrir a conversa certa; explique a
  escolha (mudar aggregate vs. mapear no frontend) no PR.
