-- =============================================================================
-- 0067_tutorial_events.sql — Telemetria de adoção de tutoriais (F12-S07).
--
-- Registra eventos tutorial_opened (drawer aberto) e tutorial_completed
-- (vídeo assistido até o fim), reutilizando o padrão de doc_views (F10-S12).
--
-- LGPD (doc 17 §9):
--   user_id ON DELETE SET NULL — remoção do usuário anonimiza o evento.
--   Sem PII além do UUID do usuário (pseudônimo).
-- =============================================================================

CREATE TABLE IF NOT EXISTS tutorial_events (
  id           uuid                     PRIMARY KEY DEFAULT gen_random_uuid(),
  tutorial_id  uuid                     NOT NULL,
  feature_key  text                     NOT NULL,
  event_type   text                     NOT NULL
                 CHECK (event_type IN ('tutorial_opened', 'tutorial_completed')),
  user_id      uuid                     REFERENCES users(id) ON DELETE SET NULL,
  occurred_at  timestamptz              NOT NULL DEFAULT now()
);

-- Queries: "quantos abriram/completaram este tutorial"
CREATE INDEX IF NOT EXISTS idx_tutorial_events_tutorial_at
  ON tutorial_events (tutorial_id, occurred_at DESC);

-- Queries: "quais tutoriais este usuário assistiu"
CREATE INDEX IF NOT EXISTS idx_tutorial_events_user_at
  ON tutorial_events (user_id, occurred_at DESC);

-- Queries agregadas por tipo de evento
CREATE INDEX IF NOT EXISTS idx_tutorial_events_type_at
  ON tutorial_events (event_type, occurred_at DESC);
