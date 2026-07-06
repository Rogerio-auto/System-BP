---
id: F6-S05
title: DB/Seed — ai_assistant:use + flag ai.internal_assistant.enabled + tabela assistant_queries
phase: F6
task_ref: docs/22-agente-interno-acoes.md
status: available
priority: high
estimated_size: M
agent_id: null
depends_on: []
blocks: [F6-S06, F6-S08]
labels: [db-schema, rbac, feature-flags, ai-assistant]
source_docs:
  [docs/22-agente-interno-acoes.md, docs/09-feature-flags.md, docs/10-seguranca-permissoes.md]
docs_required: false
---

# F6-S05 — DB/Seed: fundação do copiloto interno

## Objetivo

Fundação de RBAC/flag/auditoria do copiloto interno (doc 22 §12): a permissão de acesso, a flag
guarda-chuva e a tabela de log de consultas.

## Contexto

Superfície B do doc 22. `ai.internal_assistant.enabled` já existe no catálogo (Fase 6). A permissão
`ai_assistant:use` só dá acesso ao copiloto — **não** concede leitura de dados (cada consulta ainda
exige a permissão do domínio, §12.2/§12.3).

## Escopo (faz)

- Migration seed permissão `ai_assistant:use` — "Conversar com o copiloto interno" — + `role_permissions`
  para **todos os 6 roles** operacionais (admin/gestor_geral/gestor_regional/agente/operador/leitura).
- Registrar em `PERMISSIONS` + `ROLE_PERMISSIONS` (`apps/api/scripts/seed.ts`) e adicionar o prefixo
  ao `MODULE_PREFIX_MAP` (label "Agente de IA", junto de `ai_actions:`).
- Garantir flag `ai.internal_assistant.enabled` no catálogo (`db/seeds/featureFlags.ts`), disabled/visible.
- Tabela `assistant_queries`: `id`, `organization_id` (FK, NOT NULL), `user_id` (FK users),
  `question_redacted` text (pergunta com DLP aplicado — **sem PII bruta**), `answer_summary` text nullable,
  `tools_called` jsonb, `city_scope_snapshot` jsonb, `created_at`. Índice `(organization_id, user_id, created_at)`.
  Schema Drizzle + migration + `_journal.json`.

## Fora de escopo (NÃO faz)

- Endpoints/grafo/UI (F6-S06/S07/S08/S09).
- Permissões `ai_actions:*` (essas são F25, superfície A).

## Arquivos permitidos

- `apps/api/src/db/schema/assistantQueries.ts`
- `apps/api/src/db/schema/index.ts`
- `apps/api/src/db/migrations/0083_assistant_queries_and_perm.sql`
- `apps/api/src/db/migrations/meta/_journal.json`
- `apps/api/scripts/seed.ts`
- `apps/api/src/modules/roles/service.ts`
- `apps/api/src/db/seeds/featureFlags.ts`

## Arquivos proibidos

- `apps/web/**`
- `apps/langgraph-service/**`
- `apps/api/src/modules/**` (exceto `roles/service.ts`)

## Definition of Done

- [ ] `ai_assistant:use` no catálogo + concedida aos 6 roles (migration + seed.ts)
- [ ] Flag `ai.internal_assistant.enabled` garantida (disabled/visible)
- [ ] `assistant_queries` com `organization_id NOT NULL`, sem PII bruta, índice
- [ ] `check-migrations` verde; `db:migrate` aplica limpo
- [ ] `pnpm --filter @elemento/api typecheck` + `lint` verdes

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
python scripts/slot.py validate F6-S05
```

## Notas para o agente

- **Migration:** `0083` sugestão; verificar colisão com F24/F25 em voo e usar a próxima livre.
- `question_redacted` guarda a pergunta **após DLP** — nunca a original com PII.
