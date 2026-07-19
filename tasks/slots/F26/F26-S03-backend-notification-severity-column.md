---
id: F26-S03
title: Backend — persistir severidade na linha da notificação + expor no REST
phase: F26
task_ref: docs/sessions/2026-07-19-notificacoes-arquitetura-e-gaps.md
status: done
priority: medium
estimated_size: S
agent_id: null
depends_on: []
blocks: []
labels: [backend, db-schema, notifications]
source_docs: [docs/23-notificacoes.md, docs/sessions/2026-07-19-notificacoes-arquitetura-e-gaps.md]
docs_required: false
claimed_at: 2026-07-19T17:28:54Z
completed_at: 2026-07-19T17:43:28Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/425
---

# F26-S03 — Backend: severidade persistida na notificação

## Objetivo

Persistir `severity` na linha `notifications` e expô-la no contrato REST, para o frontend poder
diferenciar visualmente crítico/aviso/informativo na lista (hoje a severidade só existe no payload
do socket, some no reload). Habilita o gap G6 (doc 23 §14) — a parte visual fica no F26-S04.

## Contexto

Doc 23 §13: a linha `notifications` **não** tem coluna `severity` — ela é transiente, só viaja no
payload do socket (`realtime.ts`). Os senders já recebem `severity` (default `info`) mas só
repassam ao socket, não ao banco. Consequência: a lista persistente (REST) não tem severidade e
todos os itens têm o mesmo peso visual.

## Escopo (faz)

- Migration `0092_*` — adiciona coluna `severity text NOT NULL DEFAULT 'info'` em `notifications`
  com CHECK `severity IN ('info','warning','critical')`. Entry correspondente em
  `meta/_journal.json` no mesmo commit (migration à mão — doc PROTOCOL §3).
- `db/schema/notifications.ts` — refletir a coluna.
- `modules/notifications/repository.ts` (`createNotification` + `mapNotificationRow`) — aceitar e
  persistir `severity`; incluir no objeto mapeado.
- `senders/inApp.ts` — passar a `severity` recebida também para `createNotification` (hoje só vai
  para o socket).
- `packages/shared-schemas/src/notifications.ts` — adicionar `severity` ao schema REST da
  notificação (`info|warning|critical`).
- Testes: `createNotification` persiste severidade; `GET /api/notifications` retorna severidade.

## Fora de escopo (NÃO faz)

- Estilo visual por severidade na lista / ícones (F26-S04).
- Enriquecimento de texto (F26-S02).
- Backfill de severidade em linhas antigas (default `info` cobre o legado).

## Arquivos permitidos

- `apps/api/src/db/migrations/0092_notifications_severity.sql`
- `apps/api/src/db/migrations/meta/_journal.json`
- `apps/api/src/db/schema/notifications.ts`
- `apps/api/src/modules/notifications/repository.ts`
- `apps/api/src/modules/notifications/senders/inApp.ts`
- `packages/shared-schemas/src/notifications.ts`
- `apps/api/src/**/*.test.ts`

## Arquivos proibidos

- `apps/web/**`
- `apps/langgraph-service/**`
- `apps/api/src/modules/livechat/**`
- `apps/api/src/modules/assistant-escalation/**`
- `apps/api/src/workers/**`

## Definition of Done

- [ ] Migration `0092` + entry no `_journal.json` no mesmo commit; `slot.py check-migrations` verde
- [ ] Coluna `severity` com CHECK e default `info`; schema Drizzle reflete
- [ ] `createNotification` persiste severidade; `GET /api/notifications` retorna severidade
- [ ] Senders in-app gravam a severidade recebida (mesmo valor que vai ao socket)
- [ ] Testes verdes; `pnpm --filter @elemento/api typecheck` + `lint` + `test` + `build` verdes

## Validação

```powershell
python scripts/slot.py check-migrations
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
pnpm --filter @elemento/api build
```

## Notas para o agente

- Migration à mão exige entry no `_journal.json` no mesmo commit (incidente 2026-05-15).
- Manter compatibilidade: `severity` default `info` garante que linhas/rotas existentes não quebrem.
- Não alterar o payload do socket (já tem `severity`) — só alinhar o banco e o REST a ele.
