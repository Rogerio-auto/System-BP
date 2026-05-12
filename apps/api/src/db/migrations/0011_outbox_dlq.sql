-- =============================================================================
-- 0011_outbox_dlq.sql — Índice adicional em event_dlq para endpoints admin DLQ.
--
-- A tabela event_dlq já existe desde 0003_outbox_events.sql.
-- Esta migration adiciona índice composto (event_name, moved_at DESC) para
-- suportar listagem admin por tipo de evento ordenada por data de falha.
--
-- F1-S22 (chatwoot-attrs-sync) introduz o primeiro consumidor real de DLQ
-- via endpoints GET/POST /api/admin/dlq.
-- =============================================================================

-- Índice composto para listagem admin: filtrar por event_name, ordenar por data
CREATE INDEX IF NOT EXISTS idx_event_dlq_name_moved_at
  ON event_dlq (event_name, moved_at DESC);

-- Índice para replay pendente (não-reprocessados)
CREATE INDEX IF NOT EXISTS idx_event_dlq_pending
  ON event_dlq (moved_at DESC)
  WHERE reprocessed = false;
