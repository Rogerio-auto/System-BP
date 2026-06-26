-- =============================================================================
-- 0073_reports_mv_unique_indexes_fix.sql
-- Corrige os índices únicos das MVs de relatórios (F23-S01 / 0071).
--
-- O 0071 criou os índices únicos com uma EXPRESSÃO (COALESCE(city_id::text,'__null__'))
-- para tratar city_id/product_id nulos. Mas o PostgreSQL exige um índice único de
-- COLUNAS PURAS (sem expressão, sem WHERE) para `REFRESH MATERIALIZED VIEW CONCURRENTLY`
-- — com índice de expressão, o refresh concorrente falha com:
--   "cannot refresh materialized view concurrently / Create a unique index with no
--    WHERE clause on one or more columns".
-- Isso quebrava o worker reports-refresh em produção (não pego antes: o teste do worker
-- era mockado e o E2E não executa o refresh).
--
-- Fix: recriar com colunas puras + NULLS NOT DISTINCT (PG15+) — trata os NULLs de
-- city_id/product_id como iguais (mantendo a unicidade que a expressão garantia) e
-- satisfaz o requisito do REFRESH CONCURRENTLY.
--
-- Idempotente (DROP IF EXISTS + CREATE IF NOT EXISTS). Transacional.
-- =============================================================================

DROP INDEX IF EXISTS uq_mv_reports_overview;
CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_reports_overview
  ON mv_reports_overview (organization_id, day, city_id) NULLS NOT DISTINCT;

DROP INDEX IF EXISTS uq_mv_reports_funnel;
CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_reports_funnel
  ON mv_reports_funnel (organization_id, stage_id, city_id) NULLS NOT DISTINCT;

DROP INDEX IF EXISTS uq_mv_reports_stage_dwell;
CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_reports_stage_dwell
  ON mv_reports_stage_dwell (organization_id, stage_id, city_id) NULLS NOT DISTINCT;

DROP INDEX IF EXISTS uq_mv_reports_credit;
CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_reports_credit
  ON mv_reports_credit (organization_id, product_id, city_id) NULLS NOT DISTINCT;

DROP INDEX IF EXISTS uq_mv_reports_collection;
CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_reports_collection
  ON mv_reports_collection (organization_id, status, city_id) NULLS NOT DISTINCT;
