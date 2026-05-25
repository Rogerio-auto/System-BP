---
id: F7-S04
title: Adapter de importação Notion → leads + lead_history
phase: F7
task_ref: T7.4
status: done
priority: high
estimated_size: L
agent_id: backend-engineer
claimed_at: 2026-05-25T15:01:31Z
completed_at: 2026-05-25T15:20:07Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/143
depends_on: [F1-S17, F1-S18, F1-S24]
blocks: [F7-S07]
labels: [lgpd-impact]
source_docs:
  - docs/08-importacoes.md
  - docs/17-lgpd-protecao-dados.md
  - docs/11-roadmap-executavel.md
---

# F7-S04 — Adapter Notion → leads

> **Nota:** o slot F7-S05 (adapter Trello) que constava em propostas anteriores foi cancelado em 2026-05-22. A migração da operação histórica fica restrita a Notion + planilhas (análises via F4-S06).

## Objetivo

Migrar a base histórica do Banco do Povo hoje em Notion para o sistema Elemento. Adapter usa a Notion API (read-only) e mapeia propriedades de uma database de leads para o schema interno.

## Escopo

- Cliente Notion `apps/api/src/integrations/notion/client.ts`:
  - Autenticação via integration token (env `NOTION_INTEGRATION_TOKEN`)
  - `listDatabasePages(databaseId, cursor?) → { results, nextCursor }`
  - `getPageProperties(pageId) → propertiesMap`
  - Rate-limit aware (3 req/s, retry 429)
- Adapter `apps/api/src/services/imports/adapters/notionLeadsAdapter.ts`:
  - Recebe `import_batch` com `kind='notion_leads'` + `source_config = { databaseId, propertyMapping }`
  - Para cada page:
    - Lê propriedades via cliente
    - Aplica `propertyMapping` (jsonb no batch): `{ "Nome": "display_name", "WhatsApp": "primary_phone", "Cidade": "city_lookup", "Status": "stage_lookup", ... }`
    - Normaliza telefone (E.164 via F1-S10), cidade (fuzzy via cities)
    - Cria/atualiza lead via service existente (não bypass — usa `leadsService.upsertFromImport`)
    - Cria entries em `lead_history` com `actor_kind='system'`, `event_type='imported_from_notion'`, `payload={ notion_page_id, notion_database_id }`
- Schema novo: column `notion_page_id text` adicionada em `leads` para dedupe entre múltiplas execuções:
  - Migration `0041_leads_notion_page_id.sql`:
    - `ALTER TABLE leads ADD COLUMN notion_page_id text NULL;`
    - `CREATE UNIQUE INDEX uq_leads_notion_page_id ON leads (organization_id, notion_page_id) WHERE notion_page_id IS NOT NULL;`
- Registry: registrar `kind='notion_leads'` em `apps/api/src/services/imports/registry.ts`
- UI: opção "Notion (database)" no wizard de importação (F1-S18) — campo `databaseId` + editor de propertyMapping (UI tabular)
- Testes:
  - Cliente Notion: mock httpx, paginação, rate-limit
  - Adapter: fixture de page com 5 props, mapping completo, dedupe (re-import = `status='duplicate'`)

## LGPD

- **Notion = suboperador internacional.** Atualizar doc 17 §11.3 (lista de suboperadores) **somente para a janela de importação** — após cutover, integração é desativada. Documentar no PR.
- **DPIA:** finalidade nova "migração de base histórica" — registrar no DPIA atual (doc 17 §11). Janela limitada (≤30 dias de operação paralela).
- **PII em trânsito:** chamada à Notion API usa HTTPS. Tokens guardados em env, não no banco.
- **PII em log:** propriedades brutas da page **nunca** logadas (apenas `notion_page_id` + count). `pino.redact` cobre `properties.*`.
- **Outbox:** evento `lead.imported` carrega só `lead_id`, `notion_page_id`, `batch_id`.
- **Audit log:** 1 entry por batch (`actor_user_id`, `action=import_notion`, `batch_id`).
- **Retenção:** `notion_page_id` na tabela `leads` é mantido para auditoria e dedupe — não é PII (id opaco Notion).

## Fora de escopo

- Migração de páginas de "Histórico" e "Análises" do Notion (F4-S06 cobre análises; histórico vai como `lead_history` automaticamente)
- Sync bidirecional (write-back para Notion) — não é o objetivo
- Anexos em pages — slot futuro de storage

## Arquivos permitidos

```
apps/api/src/integrations/notion/client.ts
apps/api/src/integrations/notion/types.ts
apps/api/src/integrations/notion/__tests__/client.test.ts
apps/api/src/services/imports/adapters/notionLeadsAdapter.ts
apps/api/src/services/imports/registry.ts
apps/api/src/services/imports/__tests__/notionLeadsAdapter.test.ts
apps/api/src/services/imports/__tests__/fixtures/notion-page-sample.json
apps/api/src/db/migrations/0041_leads_notion_page_id.sql
apps/api/src/db/migrations/meta/_journal.json
apps/api/src/db/schema/leads.ts
apps/api/src/env.ts
.env.example
apps/web/src/features/imports/components/NotionConfigStep.tsx
apps/web/src/features/imports/constants.ts
docs/17-lgpd-protecao-dados.md
```

## Definition of Done

- [ ] Cliente Notion implementado com auth + paginação + rate-limit
- [ ] Adapter mapeia propriedades configuráveis
- [ ] Migration 0041 adiciona `notion_page_id`
- [ ] Dedupe via `(organization_id, notion_page_id)` testada
- [ ] UI permite configurar `databaseId` + mapping no wizard
- [ ] Doc 17 §11.3 atualizado com Notion como suboperador temporário
- [ ] PII redact em logs + outbox sem PII bruta
- [ ] Testes: import bem sucedido, paginação, rate-limit, re-import idempotente
- [ ] PR com label `lgpd-impact` + checklist doc 17

## Validação

```powershell
python scripts/slot.py check-migrations
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- notion
pnpm --filter @elemento/web typecheck
```
