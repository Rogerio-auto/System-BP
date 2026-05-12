-- =============================================================================
-- 0003_outbox_events.sql — Outbox pattern: event_outbox, event_processing_logs,
--                           event_dlq e trigger NOTIFY para o worker LISTEN.
--
-- Contexto: F1-S15. Destrava F1-S11, F1-S13, F1-S22.
--
-- LGPD §8.5 — CRÍTICO:
--   O campo `payload` em event_outbox e event_dlq carrega APENAS referências
--   (UUIDs opacos). NUNCA CPF, e-mail, telefone ou qualquer PII bruta.
--   Migração que viole essa regra é rejeitada.
--
-- Novidades:
--   1. Tabela event_outbox — fila transacional de saída.
--   2. Tabela event_processing_logs — idempotência por (event_id, handler_name).
--   3. Tabela event_dlq — dead-letter queue para eventos que esgotaram tentativas.
--   4. Trigger fn_notify_outbox_new() + NOTIFY no canal 'outbox_new'.
--      O worker faz LISTEN 'outbox_new' para acordar sem polling constante.
--   5. Índice parcial em event_outbox para o worker (WHERE processed_at IS NULL
--      AND failed_at IS NULL) — não gerado pelo Drizzle, criado aqui explicitamente.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. event_outbox
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "event_outbox" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

    -- Multi-tenant
    "organization_id" uuid NOT NULL,

    -- Identificação do evento
    "event_name" text NOT NULL,
    "event_version" integer NOT NULL DEFAULT 1,

    -- Agregado de origem
    "aggregate_type" text NOT NULL,
    "aggregate_id" uuid NOT NULL,

    -- Payload (SEM PII — §8.5 LGPD)
    "payload" jsonb NOT NULL,

    -- Rastreabilidade
    "correlation_id" uuid,

    -- Idempotência do produtor
    "idempotency_key" text NOT NULL,

    -- Estado
    "attempts" integer NOT NULL DEFAULT 0,
    "last_error" text,
    "processed_at" timestamp with time zone,
    "failed_at" timestamp with time zone,

    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. event_processing_logs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "event_processing_logs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "event_id" uuid NOT NULL,
    "organization_id" uuid NOT NULL,
    "handler_name" text NOT NULL,
    "status" text NOT NULL CHECK ("status" IN ('success', 'failed', 'skipped')),
    "error_message" text,
    "duration_ms" integer,
    "processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. event_dlq
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "event_dlq" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "original_event_id" uuid NOT NULL,
    "organization_id" uuid NOT NULL,
    "event_name" text NOT NULL,
    "event_version" integer NOT NULL DEFAULT 1,
    "aggregate_type" text NOT NULL,
    "aggregate_id" uuid NOT NULL,
    "payload" jsonb NOT NULL,
    "correlation_id" uuid,
    "total_attempts" integer NOT NULL,
    "last_error" text,
    "reprocessed" boolean NOT NULL DEFAULT false,
    "reprocess_event_id" uuid,
    "moved_at" timestamp with time zone DEFAULT now() NOT NULL,
    "reprocessed_at" timestamp with time zone
);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Foreign Keys — event_outbox
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE "event_outbox"
    ADD CONSTRAINT "fk_event_outbox_organization"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
    ON DELETE restrict ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. Foreign Keys — event_processing_logs
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE "event_processing_logs"
    ADD CONSTRAINT "fk_event_processing_logs_event"
    FOREIGN KEY ("event_id") REFERENCES "public"."event_outbox"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "event_processing_logs"
    ADD CONSTRAINT "fk_event_processing_logs_organization"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
    ON DELETE restrict ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 6. Foreign Keys — event_dlq
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE "event_dlq"
    ADD CONSTRAINT "fk_event_dlq_organization"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
    ON DELETE restrict ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 7. Índices — event_outbox
-- ---------------------------------------------------------------------------

-- B-tree em FK para joins org → events
CREATE INDEX IF NOT EXISTS "idx_event_outbox_org"
  ON "event_outbox" USING btree ("organization_id");
--> statement-breakpoint

-- Índice parcial para o worker:
-- Seleciona apenas eventos pendentes, ordenados por criação (FIFO).
-- SKIP LOCKED no worker garante que múltiplas instâncias não colidam.
CREATE INDEX IF NOT EXISTS "idx_event_outbox_pending"
  ON "event_outbox" USING btree ("created_at")
  WHERE "processed_at" IS NULL AND "failed_at" IS NULL;
--> statement-breakpoint

-- B-tree em aggregate para ordering serial por agregado
CREATE INDEX IF NOT EXISTS "idx_event_outbox_aggregate"
  ON "event_outbox" USING btree ("aggregate_type", "aggregate_id");
--> statement-breakpoint

-- Unique parcial de idempotência do produtor por (org, idempotency_key)
CREATE UNIQUE INDEX IF NOT EXISTS "uq_event_outbox_idempotency"
  ON "event_outbox" ("organization_id", "idempotency_key");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 8. Índices — event_processing_logs
-- ---------------------------------------------------------------------------

-- Unique (event_id, handler_name) — garante idempotência do consumer
CREATE UNIQUE INDEX IF NOT EXISTS "uq_event_processing_event_handler"
  ON "event_processing_logs" ("event_id", "handler_name");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_event_processing_event_id"
  ON "event_processing_logs" USING btree ("event_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_event_processing_org"
  ON "event_processing_logs" USING btree ("organization_id");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 9. Índices — event_dlq
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS "idx_event_dlq_org"
  ON "event_dlq" USING btree ("organization_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_event_dlq_original"
  ON "event_dlq" USING btree ("original_event_id");
--> statement-breakpoint

-- Índice parcial para lista admin de DLQ pendente de reprocessamento
CREATE INDEX IF NOT EXISTS "idx_event_dlq_pending_reprocess"
  ON "event_dlq" USING btree ("moved_at")
  WHERE "reprocessed" = false;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 10. Trigger NOTIFY — acorda o worker LISTEN sem polling ativo
-- ---------------------------------------------------------------------------
--
-- O worker faz: LISTEN outbox_new;
-- Quando um novo evento é inserido no event_outbox, esta função dispara
-- automaticamente e notifica todos os processos ouvindo o canal.
--
-- Isso reduz latência de delivery de ~1s (poll interval) para ~10ms.
-- A notificação não carrega payload — o worker faz SELECT para pegar dados.
-- (Canal NOTIFY tem limite de 8000 bytes; evitamos problemas não passando payload)

CREATE OR REPLACE FUNCTION fn_notify_outbox_new()
  RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  -- Acorda worker(s) ouvindo no canal 'outbox_new'.
  -- Sem payload — worker lê event_outbox com FOR UPDATE SKIP LOCKED.
  PERFORM pg_notify('outbox_new', '');
  RETURN NEW;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_notify_outbox_new ON "event_outbox";
--> statement-breakpoint

CREATE TRIGGER trg_notify_outbox_new
  AFTER INSERT ON "event_outbox"
  FOR EACH ROW
  EXECUTE FUNCTION fn_notify_outbox_new();
