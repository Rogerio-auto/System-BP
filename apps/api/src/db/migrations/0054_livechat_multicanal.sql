-- Migration 0054: Schema multicanal do live chat (F16-S02, decisao D2).
-- LGPD: colunas PII em bytea (enc via encryptPii em app layer).

CREATE TABLE IF NOT EXISTS "channels" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL REFERENCES "organizations" ("id") ON DELETE CASCADE,
  "city_id" UUID,
  "provider" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "display_handle" TEXT NOT NULL,
  "phone_number" TEXT,
  "phone_number_id" TEXT,
  "waba_id" TEXT,
  "meta_app_id" TEXT,
  "ig_user_id" TEXT,
  "ig_username" TEXT,
  "ig_account_type" TEXT,
  "fb_page_id" TEXT,
  "waha_session_id" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "is_default" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "deleted_at" TIMESTAMPTZ,
  CONSTRAINT "channels_provider_fields_check" CHECK (
    (provider = 'meta_whatsapp' AND phone_number_id IS NOT NULL)
    OR (provider = 'meta_instagram' AND ig_user_id IS NOT NULL)
    OR (provider = 'waha' AND waha_session_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "channels_org_provider_phone_number_id_key" ON "channels" ("organization_id", "provider", "phone_number_id");
CREATE INDEX IF NOT EXISTS "channels_org_provider_idx" ON "channels" ("organization_id", "provider");
CREATE INDEX IF NOT EXISTS "channels_org_city_idx" ON "channels" ("organization_id", "city_id");

CREATE TABLE IF NOT EXISTS "channel_secrets" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "channel_id" UUID NOT NULL UNIQUE REFERENCES "channels" ("id") ON DELETE CASCADE,
  "access_token_enc" BYTEA NOT NULL,
  "app_secret_enc" BYTEA,
  "api_key_enc" BYTEA,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "conversations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL REFERENCES "organizations" ("id") ON DELETE CASCADE,
  "city_id" UUID,
  "channel_id" UUID NOT NULL REFERENCES "channels" ("id") ON DELETE RESTRICT,
  "contact_remote_id" TEXT NOT NULL,
  "contact_name" TEXT,
  "contact_phone_enc" BYTEA,
  "lead_id" UUID,
  "customer_id" UUID,
  "status" TEXT NOT NULL DEFAULT 'open',
  "kind" TEXT NOT NULL DEFAULT 'dm',
  "assigned_user_id" UUID,
  "last_inbound_at" TIMESTAMPTZ,
  "last_message_at" TIMESTAMPTZ,
  "unread_count" INTEGER NOT NULL DEFAULT 0,
  "metadata" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "deleted_at" TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS "conversations_org_channel_last_message_idx" ON "conversations" ("organization_id", "channel_id", "last_message_at");
CREATE INDEX IF NOT EXISTS "conversations_org_status_idx" ON "conversations" ("organization_id", "status");
CREATE INDEX IF NOT EXISTS "conversations_channel_contact_idx" ON "conversations" ("channel_id", "contact_remote_id");
CREATE INDEX IF NOT EXISTS "conversations_org_city_idx" ON "conversations" ("organization_id", "city_id");

CREATE TABLE IF NOT EXISTS "messages" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "conversation_id" UUID NOT NULL REFERENCES "conversations" ("id") ON DELETE CASCADE,
  "channel_id" UUID NOT NULL REFERENCES "channels" ("id") ON DELETE RESTRICT,
  "direction" TEXT NOT NULL,
  "external_id" TEXT,
  "type" TEXT NOT NULL,
  "content" TEXT,
  "media_url" TEXT,
  "media_mime" TEXT,
  "media_size_bytes" INTEGER,
  "media_sha256" TEXT,
  "interactive_payload" JSONB,
  "view_status" TEXT,
  "reply_to_external_id" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "messages_conversation_created_idx" ON "messages" ("conversation_id", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "messages_channel_external_id_key" ON "messages" ("channel_id", "external_id") WHERE "external_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "messages_conversation_direction_idx" ON "messages" ("conversation_id", "direction");

CREATE TABLE IF NOT EXISTS "webhook_events" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "provider" TEXT NOT NULL,
  "event_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "raw_payload" JSONB NOT NULL,
  "processed_at" TIMESTAMPTZ,
  "processing_error" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "expires_at" TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days')
);

CREATE UNIQUE INDEX IF NOT EXISTS "webhook_events_provider_event_id_key" ON "webhook_events" ("provider", "event_id");
CREATE INDEX IF NOT EXISTS "webhook_events_provider_type_idx" ON "webhook_events" ("provider", "event_type");
CREATE INDEX IF NOT EXISTS "webhook_events_unprocessed_idx" ON "webhook_events" ("processed_at", "created_at");
CREATE INDEX IF NOT EXISTS "webhook_events_expires_at_idx" ON "webhook_events" ("expires_at");
