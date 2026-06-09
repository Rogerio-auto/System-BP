---
id: F12-S09
title: Semear feature flag tutorials.enabled
phase: F12
task_ref: docs/21-tutoriais-em-video.md#12
status: in-progress
priority: medium
estimated_size: XS
agent_id: null
claimed_at: 2026-06-09T22:12:32Z
completed_at: null
pr_url: null
depends_on: [F12-S02]
blocks: []
source_docs:
  - docs/21-tutoriais-em-video.md#12
  - docs/21-tutoriais-em-video.md#9
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F12-S09 — Seed da flag tutorials.enabled

## Objetivo

Criar a linha da feature flag `tutorials.enabled` no banco para que a F12 possa ser ativada/gerenciada. Sem ela, todas as rotas de tutoriais e o item de menu do admin ficam fail-closed (403/ocultos).

## Contexto

Norma 21 §12. O F12-S02 referencia a flag `tutorials.enabled` no código (`lib/featureFlags.ts`) e o featureGate fecha as rotas quando a flag **não existe** no DB. O F12-S05 condiciona o nav item do admin a essa flag. Este slot só semeia a linha — a tabela `feature_flags` tem `key` como PK (flag global), igual às demais. Modelo de seed: `0045_enable_followup_flag.sql` (mas aquele faz UPDATE de uma linha já existente; aqui a linha **não existe** → INSERT).

## Escopo (faz)

- Migration `0049_seed_tutorials_flag.sql`:
  - `INSERT INTO feature_flags (key, status, visible, ui_label, description) VALUES ('tutorials.enabled', 'enabled', true, '<rótulo>', '<descrição>') ON CONFLICT (key) DO NOTHING;`
  - **Idempotente** (`ON CONFLICT (key) DO NOTHING`) — re-rodar não regride nem sobrescreve toggle feito pela UI de admin.
  - `updated_by` = NULL (origem sistema/migration), conforme convenção do 0045.
  - Status inicial **`enabled`**: libera a admin `/admin/tutoriais` para o Rogério cadastrar vídeos e a leitura `GET /api/help/tutorials`. Operadores não veem nada até existirem tutoriais ativos cadastrados **e** o ⓘ ser pendurado nas telas (F12-S06) — então ligar agora é seguro.
- Adicionar a entry em `apps/api/src/db/migrations/meta/_journal.json` no mesmo commit (migration manual — PROTOCOL §3).

## Fora de escopo (NÃO faz)

- Mudar o schema de `feature_flags`.
- Tocar no código de rotas/lib (a flag já é conhecida pelo código desde F12-S02).
- Instrumentar telas (F12-S06).

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/db/migrations/0049_seed_tutorials_flag.sql` (criar)
- `apps/api/src/db/migrations/meta/_journal.json` (entry)
- `tasks/slots/F12/F12-S09-seed-tutorials-flag.md`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/db/schema/**`
- `apps/api/src/modules/**`, `apps/web/**`, `packages/**`
- outras migrations
- `tasks/STATUS.md`

## Contratos de entrada

- F12-S02 mergeado (rotas + featureGate de `tutorials.enabled`). Tabela `feature_flags` existente.

## Contratos de saída

- Linha `tutorials.enabled` (status `enabled`) presente em `feature_flags`; admin de Feature Flags pode togglar.

## Definition of Done

- [ ] Migration idempotente criada + entry no journal
- [ ] `python scripts/slot.py check-migrations` sem novos erros
- [ ] `pnpm --filter @elemento/api typecheck` verde (sem regressão)

## Comandos de validação

```powershell
python scripts/slot.py check-migrations
pnpm --filter @elemento/api typecheck
```

## Notas para o agente

- Próxima migration livre = **0049** (0048 = F12-S08).
- Confirme o nome real das colunas em `apps/api/src/db/schema/featureFlags.ts` (`ui_label`, `visible`, `status`) antes de escrever o INSERT.
- `ON CONFLICT (key) DO NOTHING` é obrigatório (idempotência + não regredir toggle manual).
