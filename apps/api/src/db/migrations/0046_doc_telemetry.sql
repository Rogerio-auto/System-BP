-- 0046_doc_telemetry.sql - Telemetria da Central de Ajuda (F10-S12).
--
-- LGPD: user_id ON DELETE SET NULL (Art. 18 VI LGPD).
-- Base legal: Art. 7 IX (legitimo interesse - melhoria do servico).
-- Rollback: DROP TABLE IF EXISTS doc_feedback; DROP TABLE IF EXISTS doc_views;

CREATE TABLE IF NOT EXISTS "doc_views" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id"      uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "article_slug" text NOT NULL,
  "viewed_at"    timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_doc_views_slug_time"
  ON "doc_views" ("article_slug", "viewed_at" DESC);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "doc_feedback" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id"      uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "article_slug" text NOT NULL,
  "helpful"      boolean NOT NULL,
  "comment"      text,
  "created_at"   timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_doc_feedback_slug"
  ON "doc_feedback" ("article_slug", "created_at" DESC);
