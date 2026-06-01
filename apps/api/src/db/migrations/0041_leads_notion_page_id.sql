-- no-transaction
-- =============================================================================
-- 0041_leads_notion_page_id.sql — Coluna notion_page_id em leads.
--
-- Contexto: F7-S04 (adapter de importação Notion → leads).
-- Dependências:
--   - 0007_leads_core (tabela leads)
--
-- Alterações:
--   1. ADD COLUMN notion_page_id text NULL
--      ID opaco da page Notion — não é PII (identificador interno Notion).
--      Usado para dedupe em re-importações: mesma page nunca cria dois leads.
--
--   2. CREATE UNIQUE INDEX CONCURRENTLY uq_leads_notion_page_id
--      Índice único parcial (organization_id, notion_page_id) WHERE NOT NULL.
--      CONCURRENTLY: permite criação sem lock total de escrita na tabela leads.
--      WHERE notion_page_id IS NOT NULL: não bloqueia leads sem origem Notion.
--
-- LGPD §12.1 (doc 17):
--   - notion_page_id é ID opaco (UUIDs do Notion) — não constitui dado pessoal.
--   - Mantido após cutover para auditoria de origem. Não expira por retenção.
--
-- Rollback:
--   DROP INDEX IF EXISTS uq_leads_notion_page_id;
--   ALTER TABLE leads DROP COLUMN IF EXISTS notion_page_id;
-- =============================================================================

ALTER TABLE leads ADD COLUMN IF NOT EXISTS notion_page_id text NULL;
--> statement-breakpoint

-- CONCURRENTLY não pode rodar dentro de uma transação explícita.
-- O Drizzle runner executa cada statement separadamente por default.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_leads_notion_page_id
  ON leads (organization_id, notion_page_id)
  WHERE notion_page_id IS NOT NULL;
