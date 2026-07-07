---
id: F25-S02
title: Seed — permissões ai_actions:* + role_permissions + flags + MODULE_PREFIX_MAP
phase: F25
task_ref: docs/22-agente-interno-acoes.md
status: review
priority: high
estimated_size: S
agent_id: db-schema-engineer
claimed_at: 2026-07-07T21:50:05Z
depends_on: [F25-S01]
blocks: [F25-S03, F25-S05, F25-S06]
labels: [db-schema, rbac, feature-flags]
source_docs:
  [docs/22-agente-interno-acoes.md, docs/09-feature-flags.md, docs/10-seguranca-permissoes.md]
docs_required: false
completed_at: 2026-07-07T22:40:25Z
---

# F25-S02 — Seed: permissões ai_actions:\* + flags do agente no funil

## Objetivo

Catalogar as permissões humanas de supervisão das ações da IA (doc 22 §8.B) e garantir as
flags do módulo, com o pré-mapeamento por role já semeado.

## Contexto

Doc 22 §8.B define 3 permissões novas no padrão `recurso:ação`. A flag
`internal_assistant.actions.enabled` já existe no catálogo (`db/seeds/featureFlags.ts:112`,
`disabled`) — este slot garante o texto/label corretos e o agrupamento na UI de papéis.

## Escopo (faz)

- Migration seed `INSERT INTO permissions … ON CONFLICT DO NOTHING`:
  - `ai_actions:read` — "Ver o registro e o painel de ações do agente de IA no funil"
  - `ai_actions:revert` — "Reverter uma ação autônoma do agente de IA"
  - `ai_actions:manage` — "Configurar o agente de IA no funil (habilitar ações, limiares)"
- `INSERT INTO role_permissions` (SELECT por `roles.key`) conforme pré-mapeamento §8.B:
  `read`→todos os 6 roles; `revert`→admin,gestor_geral,gestor_regional,agente;
  `manage`→admin,gestor_geral. (`admin` também recebe tudo pelo seed geral.)
- Registrar as 3 keys em `PERMISSIONS` e no dicionário `ROLE_PERMISSIONS` de
  `apps/api/scripts/seed.ts` (para bancos criados do zero).
- Adicionar prefixo `ai_actions:` ao `MODULE_PREFIX_MAP` (`apps/api/src/modules/roles/service.ts`)
  com label **"Agente de IA"**.
- Garantir flag `internal_assistant.actions.enabled` no catálogo (`db/seeds/featureFlags.ts`),
  `status: disabled`, `visible: true`, uiLabel/descrição alinhados ao doc 22.

## Fora de escopo (NÃO faz)

- Guards nas rotas / uso das permissões (F25-S06).
- Qualquer worker ou lógica (F25-S03/S05).
- Permissão `ai_assistant:use` do copiloto (essa é F6, superfície B).

## Arquivos permitidos

- `apps/api/src/db/migrations/0081_seed_ai_actions_permissions.sql`
- `apps/api/src/db/migrations/meta/_journal.json`
- `apps/api/scripts/seed.ts`
- `apps/api/src/modules/roles/service.ts`
- `apps/api/src/db/seeds/featureFlags.ts`

## Arquivos proibidos

- `apps/web/**`
- `apps/langgraph-service/**`
- `apps/api/src/modules/**` (exceto `roles/service.ts` acima)

## Definition of Done

- [ ] 3 permissões `ai_actions:*` no catálogo (migration + seed.ts)
- [ ] `role_permissions` semeado conforme pré-mapeamento §8.B
- [ ] `MODULE_PREFIX_MAP` agrupa `ai_actions:` como "Agente de IA"
- [ ] Flag `internal_assistant.actions.enabled` no catálogo (disabled/visible)
- [ ] `check-migrations` verde; `db:migrate` aplica limpo
- [ ] `pnpm --filter @elemento/api typecheck` + `lint` verdes

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
python scripts/slot.py validate F25-S02
```

## Notas para o agente

- Espelhar o padrão de `0017_seed_credit_products_permissions.sql` e `0072_seed_reports_permissions.sql`.
- `admin` recebe todas as permissões automaticamente (seed.ts linha ~466) — não duplicar manualmente.
- **Migration:** `0081` é sugestão; verificar colisão com F24 em voo e usar a próxima livre.
