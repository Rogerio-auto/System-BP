---
id: F6-S24
title: DB — schema de conversas e turnos do copiloto (sem PII em repouso)
phase: F6
task_ref: docs/anexos/lgpd/dpia-historico-copiloto.md
status: done
priority: medium
estimated_size: M
agent_id: null
depends_on: [F6-S20]
blocks: [F6-S25, F6-S26, F6-S27]
labels: [db, ai-assistant, lgpd-impact]
source_docs: [docs/anexos/lgpd/dpia-historico-copiloto.md, docs/03-modelo-dados.md]
docs_required: false
claimed_at: 2026-07-14T21:18:23Z
completed_at: 2026-07-14T21:48:03Z
---

# F6-S24 — DB: conversas e turnos do copiloto

## Objetivo

Schema de persistência do histórico, gravando **apenas o esqueleto + referências** — nenhuma PII de cliente
(conforme DPIA nível A).

## Escopo (faz)

- Migration com duas tabelas (org-scoped, multi-tenant, `organization_id`):
  - `assistant_conversations`: `id`, `organization_id`, `user_id` (dono), `title` (por intenção, **sem PII**),
    `created_at`, `updated_at`, `deleted_at`.
  - `assistant_turns`: `id`, `conversation_id` (FK), `question_sanitized` (nome/CPF/telefone mascarados),
    `narrative` (sem PII), `blocks` jsonb (**só `{type, ref}`** — nunca `value`/PII), `sources` jsonb,
    `created_at`.
- Índices: por `(user_id, updated_at)` para a barra lateral; por `conversation_id`.
- FK `on delete cascade` de turno→conversa. Soft-delete na conversa.
- **Constraint/nota de invariante:** `blocks` NÃO deve conter valores hidratados; só `type` + `ref`.
- Entry no journal + `check-migrations`.

## Fora de escopo (NÃO faz)

- Escrita/leitura (F6-S25). Hidratação (F6-S27). Frontend.

## Arquivos permitidos

- `apps/api/src/db/schema/assistantConversations.ts`
- `apps/api/src/db/schema/assistantTurns.ts`
- `apps/api/src/db/schema/index.ts`
- `apps/api/src/db/migrations/**`

## Definition of Done

- [ ] Tabelas `assistant_conversations` + `assistant_turns` (org-scoped; título/pergunta/narrativa sem PII; `blocks` só refs)
- [ ] Índices para sidebar + FK cascade + soft-delete
- [ ] Migration + journal + `check-migrations` OK
- [ ] `pnpm --filter @elemento/api typecheck` verde

## Validação

```powershell
python scripts/slot.py check-migrations
pnpm --filter @elemento/api typecheck
```

## Notas para o agente

- **Bloqueado até F6-S23 (parecer do DPO).** Não iniciar antes. Não coloque `slot.py validate` no bloco.
- Reveja o prazo de retenção (90 dias) e a política de título contra o parecer antes de finalizar.
