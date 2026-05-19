---
id: F3-S37
title: Schema chatwoot_handoffs + persistência no endpoint de handoff
phase: F3
task_ref: T3.8
status: review
priority: high
estimated_size: M
agent_id: backend-engineer
claimed_at: 2026-05-19T01:15:14Z
completed_at: 2026-05-19T01:24:51Z
pr_url:
depends_on: [F3-S01, F3-S07]
blocks: [F3-S17]
labels: [lgpd-impact]
source_docs:
  - docs/06-langgraph-agentes.md
  - docs/03-modelo-dados.md
  - docs/07-integracoes-whatsapp-chatwoot.md
  - docs/17-lgpd-protecao-dados.md
---
# F3-S37 — Tabela chatwoot_handoffs + persistência

## Contexto

O doc 06 §7.4 especifica que `request_handoff` **cria um registro `chatwoot_handoffs`**.
Essa tabela nunca foi materializada. F3-S07 entregou o endpoint `POST /internal/handoffs`
funcional via outbox + `idempotency_keys` + API do Chatwoot, mas **sem tabela de handoffs
consultável** — o `handoff_id` é gerado em runtime e só vive no `response_body` da
idempotency key. Este slot fecha o gap.

## Objetivo

Criar a tabela `chatwoot_handoffs` e fazer o endpoint de F3-S07 persistir o handoff
nela, dentro da mesma transação que emite o outbox.

## Escopo

### Migration `0024_chatwoot_handoffs.sql` + schema Drizzle

Tabela `chatwoot_handoffs`:

- `id` uuid PK `gen_random_uuid()`.
- `organization_id` uuid FK → `organizations` (`on delete restrict`).
- `lead_id` uuid FK → `leads` (`on delete set null`, nullable).
- `conversation_id` uuid (ref. à conversa da IA).
- `chatwoot_conversation_id` text.
- `reason` text — catálogo do doc 06 §7.4 (inclui `ai_unavailable`).
- `summary` text — resumo gerado pela IA. **LGPD:** pode conter contexto do cliente;
  comentário explícito no schema; coberto por `pino.redact`; nunca em log bruto.
- `simulation_id` uuid FK → `credit_simulations` (`on delete set null`, nullable).
- `assigned_agent_id` uuid FK → `agents` (`on delete set null`, nullable).
- `status` text — `requested` | `accepted` | `resolved` | `cancelled` (default `requested`).
- `idempotency_key` text — chave do header `Idempotency-Key` (UNIQUE parcial por org).
- `created_at`, `updated_at` (trigger), `deleted_at` nullable.
- Índices: `(organization_id, conversation_id)`, `(organization_id, status)`,
  único parcial `(organization_id, idempotency_key)`.

### Wiring no endpoint F3-S07

- Em `apps/api/src/modules/internal/handoffs/service.ts`: dentro da transação que já
  emite `chatwoot.handoff_requested`, **INSERT em `chatwoot_handoffs`**.
- O `handoff_id` retornado passa a ser o `id` real da linha (não mais UUID solto).
- Idempotência: reuso da chave — se já existe handoff com a mesma `idempotency_key`,
  retorna o existente (mantém o comportamento atual de F3-S07).
- Atualizar os testes de `handoffs/__tests__/routes.test.ts` para afirmar a persistência.

## LGPD

- `summary` é o campo sensível — comentário LGPD no schema, `pino.redact`, nunca em
  outbox bruto (já garantido por F3-S07 — outbox manda `summary: ''`).
- Slot com label `lgpd-impact`: checklist §14.2 do doc 17 no PR.

## Fora de escopo

- Tool Python `request_handoff` (F3-S17). Telas de gestão de handoff.

## Arquivos permitidos

- `apps/api/src/db/schema/chatwootHandoffs.ts`
- `apps/api/src/db/schema/index.ts`
- `apps/api/src/db/migrations/0024_chatwoot_handoffs.sql`
- `apps/api/src/db/migrations/meta/_journal.json`
- `apps/api/src/modules/internal/handoffs/service.ts`
- `apps/api/src/modules/internal/handoffs/__tests__/routes.test.ts`

## Definition of Done

- [ ] Tabela `chatwoot_handoffs` criada com FKs `on delete` explícitas e índices.
- [ ] Entry no `_journal.json` no mesmo commit; `slot.py check-migrations` verde.
- [ ] Endpoint de F3-S07 persiste o handoff na tabela, na mesma transação do outbox.
- [ ] `handoff_id` retornado é o `id` da linha persistida.
- [ ] Idempotência preservada (reenvio retorna o handoff existente).
- [ ] Testes atualizados afirmam a persistência.
- [ ] `pnpm --filter @elemento/api typecheck && lint && test` verdes.
- [ ] PR com label `lgpd-impact` + checklist §14.2.

## Validação

```powershell
python scripts/slot.py check-migrations
pnpm --filter @elemento/api test -- internal/handoffs
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api typecheck
```
