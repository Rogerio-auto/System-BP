-- =============================================================================
-- 0013_chatwoot_events.sql — Webhook Chatwoot: persistência + idempotência.
--
-- Contexto: F1-S21. Destrava F1-T21 (Webhook de entrada Chatwoot).
--
-- LGPD §8.5 — CRÍTICO:
--   O campo `payload` em chatwoot_events contém payload bruto do Chatwoot.
--   PII (conteúdo de mensagens, dados de contato) é mantida APENAS nesta tabela,
--   acessada sob escopo RBAC. Nunca replicada para outbox.
--   Logs do backend redactam `*.content`.
--
-- Idempotência:
--   Unique index em (organization_id, chatwoot_id, updated_at_chatwoot) garante
--   que o mesmo evento Chatwoot não seja processado duas vezes mesmo em caso de
--   retry. Violação de constraint → 200 OK sem reprocessamento.
--
-- Eventos tratados:
--   - message_created
--   - conversation_status_changed
--   - conversation_assignee_changed
--   - Demais → recebidos mas ignorados (sem linha inserida).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. chatwoot_events — payload bruto de cada evento recebido do Chatwoot
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "chatwoot_events" (
    "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

    -- Multi-tenant
    "organization_id"     uuid NOT NULL,

    -- ID numérico do objeto raiz do evento no Chatwoot
    -- (message.id para message_created, conversation.id para os demais)
    "chatwoot_id"         integer NOT NULL,

    -- Tipo do evento conforme enviado pelo Chatwoot
    -- (ex: "message_created", "conversation_status_changed")
    "event_type"          citext NOT NULL,

    -- Payload completo do webhook Chatwoot (JSONB).
    -- LGPD: pode conter PII (content de mensagens, dados de contato).
    -- Acesso controlado por RBAC.
    -- Logs NÃO registram este campo diretamente — pino.redact cobre os paths.
    "payload"             jsonb NOT NULL,

    -- updated_at do objeto Chatwoot (conforme campo updated_at ou created_at do evento).
    -- Usado em conjunto com chatwoot_id para garantir idempotência:
    -- o mesmo evento pode chegar mais de uma vez (retry do Chatwoot), mas
    -- (chatwoot_id, updated_at_chatwoot) é único dentro da organização.
    "updated_at_chatwoot" timestamp with time zone NOT NULL,

    -- Timestamp de recebimento pelo backend (monotônico, set pelo DB)
    "received_at"         timestamp with time zone DEFAULT now() NOT NULL,

    -- Timestamp de processamento pelo outbox worker (null = ainda não processado)
    "processed_at"        timestamp with time zone
);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Foreign Keys — chatwoot_events
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE "chatwoot_events"
    ADD CONSTRAINT "fk_chatwoot_events_organization"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
    ON DELETE restrict ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Índices — chatwoot_events
-- ---------------------------------------------------------------------------

-- UNIQUE por (org, chatwoot_id, updated_at_chatwoot) — garante idempotência
-- O mesmo evento (mesma versão do objeto no Chatwoot) nunca é inserido duas vezes.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_chatwoot_events_org_id_updated_at"
  ON "chatwoot_events" ("organization_id", "chatwoot_id", "updated_at_chatwoot");
--> statement-breakpoint

-- Índice em event_type para queries de processamento por tipo
CREATE INDEX IF NOT EXISTS "idx_chatwoot_events_event_type"
  ON "chatwoot_events" USING btree ("event_type");
--> statement-breakpoint

-- Índice em received_at para o job de limpeza periódica e queries de tempo
CREATE INDEX IF NOT EXISTS "idx_chatwoot_events_received_at"
  ON "chatwoot_events" USING btree ("received_at" DESC);
--> statement-breakpoint

-- Índice parcial para eventos não processados — usado pelo worker de outbox
CREATE INDEX IF NOT EXISTS "idx_chatwoot_events_unprocessed"
  ON "chatwoot_events" ("received_at" ASC)
  WHERE "processed_at" IS NULL;
--> statement-breakpoint
