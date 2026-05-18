---
id: F3-S01
title: Schema ai_conversation_states + ai_decision_logs + prompt_versions
phase: F3
task_ref: T3.1
status: review
priority: critical
estimated_size: M
agent_id: db-schema-engineer
claimed_at: 2026-05-18T21:51:26Z
completed_at: 2026-05-18T22:02:58Z
pr_url:
depends_on: []
blocks: [F3-S02, F3-S09]
labels: [lgpd-impact]
source_docs:
  - docs/06-langgraph-agentes.md
  - docs/03-modelo-dados.md
  - docs/17-lgpd-protecao-dados.md
---

# F3-S01 — Schema de estado, decisões e prompts da IA

## Objetivo

Criar as três tabelas que sustentam o agente LangGraph: estado por conversa,
log de decisão por turno e versionamento de prompts. Sem elas nenhum endpoint
interno ou nó do grafo pode persistir nada.

## Escopo

Migration `0023_ai_conversation.sql` + schemas Drizzle:

### `ai_conversation_states`

- `id` uuid PK, `organization_id` FK (multi-tenant).
- `conversation_id` uuid **UNIQUE** (1 estado por conversa), `chatwoot_conversation_id` text.
- `lead_id` / `customer_id` FK nullable.
- `phone` (telefone normalizado), `current_node` text, `graph_version` text.
- `state` jsonb — snapshot do `ConversationState`.
- `created_at`, `updated_at` (trigger), `deleted_at` nullable.
- Índice em `conversation_id`, `lead_id`.

### `ai_decision_logs`

- `id` uuid PK, `organization_id` FK, `conversation_id`, `lead_id` nullable.
- `node_name`, `intent`, `prompt_key`, `prompt_version`, `model` text.
- `tokens_in`, `tokens_out`, `latency_ms` int.
- `decision` jsonb, `error` text nullable, `correlation_id` uuid.
- `created_at`. Append-only (sem update). Índice em `conversation_id`, `created_at`.

### `prompt_versions`

- `id` uuid PK, `key` text, `version` int, `model` text, `content_hash` text, `active` bool.
- **UNIQUE (key, version)**. Índice parcial `WHERE active`.

## LGPD

- `state.messages` e `decision` **não** podem carregar CPF/RG/document_number bruto
  (doc 17 §3.4). Mensagens são truncadas/limitadas (doc 06 §8: últimas N).
- Telefone é dado pessoal — segue tratamento padrão do projeto.
- Nenhum log estruturado despeja `state`/`decision` inteiros.

## Fora de escopo

- Endpoints (F3-S02, F3-S09). Seed de prompts (vem com os slots de nó).

## Arquivos permitidos

- `apps/api/src/db/schema/aiConversationStates.ts`
- `apps/api/src/db/schema/aiDecisionLogs.ts`
- `apps/api/src/db/schema/promptVersions.ts`
- `apps/api/src/db/schema/index.ts`
- `apps/api/src/db/migrations/0023_ai_conversation.sql`
- `apps/api/src/db/migrations/meta/_journal.json`

## Definition of Done

- [ ] 3 tabelas criadas com FKs explícitas (`on delete` pensado) e índices.
- [ ] `conversation_id` UNIQUE em `ai_conversation_states`.
- [ ] `UNIQUE (key, version)` em `prompt_versions`.
- [ ] Entry no `_journal.json` no mesmo commit.
- [ ] `python scripts/slot.py check-migrations` verde.
- [ ] PR com label `lgpd-impact` + checklist §14.2 do doc 17.

## Validação

```powershell
python scripts/slot.py check-migrations
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
```
