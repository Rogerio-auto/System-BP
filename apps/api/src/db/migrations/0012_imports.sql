-- =============================================================================
-- 0012_imports.sql — Pipeline de importação genérico (F1-S17).
--
-- Tabelas:
--   import_batches   — lote de importação (upload → parse → preview → confirm → process)
--   import_rows      — linha individual do lote (raw + normalized + validation errors)
--
-- Idempotência:
--   import_batches tem índice único parcial por (organization_id, file_hash) nos
--   status ativos — garante que o mesmo arquivo não gere dois batches simultâneos.
-- =============================================================================

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_batches" (
  "id"                  UUID        NOT NULL DEFAULT gen_random_uuid(),
  "organization_id"     UUID        NOT NULL,
  "created_by_user_id"  UUID        NOT NULL,
  "entity_type"         TEXT        NOT NULL,
  "file_name"           TEXT        NOT NULL,
  "file_size"           INTEGER     NOT NULL,
  "mime_type"           TEXT        NOT NULL,
  "file_hash"           TEXT        NOT NULL,
  "status"              TEXT        NOT NULL DEFAULT 'uploaded',
  "total_rows"          INTEGER     NOT NULL DEFAULT 0,
  "valid_rows"          INTEGER     NOT NULL DEFAULT 0,
  "invalid_rows"        INTEGER     NOT NULL DEFAULT 0,
  "processed_rows"      INTEGER     NOT NULL DEFAULT 0,
  "column_mapping"      JSONB,
  "confirmed_at"        TIMESTAMPTZ,
  "confirmed_by_user_id" UUID,
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "import_batches_status_check" CHECK (
    "status" IN (
      'uploaded','parsing','preview_ready','confirmed',
      'processing','completed','failed','cancelled'
    )
  ),
  CONSTRAINT "import_batches_entity_type_check" CHECK (
    "entity_type" IN ('leads','customers','agents','credit_analyses')
  )
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_rows" (
  "id"                UUID        NOT NULL DEFAULT gen_random_uuid(),
  "batch_id"          UUID        NOT NULL,
  "row_index"         INTEGER     NOT NULL,
  "raw_data"          JSONB       NOT NULL,
  "normalized_data"   JSONB,
  "validation_errors" JSONB,
  "status"            TEXT        NOT NULL DEFAULT 'pending',
  "entity_id"         UUID,
  "created_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "import_rows_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "import_rows_batch_row_unique" UNIQUE ("batch_id", "row_index"),
  CONSTRAINT "import_rows_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "import_batches"("id") ON DELETE CASCADE,
  CONSTRAINT "import_rows_status_check" CHECK (
    "status" IN ('pending','valid','invalid','persisted','failed')
  )
);

--> statement-breakpoint
-- Índice parcial de idempotência por hash
CREATE UNIQUE INDEX IF NOT EXISTS "uq_import_batch_active_hash"
  ON "import_batches" ("organization_id", "file_hash")
  WHERE "status" NOT IN ('cancelled', 'failed');

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_import_batches_org_status"
  ON "import_batches" ("organization_id", "status", "created_at" DESC);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_import_rows_batch_status"
  ON "import_rows" ("batch_id", "status");

--> statement-breakpoint
-- FK de import_batches para organizations e users
ALTER TABLE "import_batches"
  ADD CONSTRAINT "import_batches_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "import_batches_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "import_batches_confirmed_by_user_id_fkey"
    FOREIGN KEY ("confirmed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
