-- =============================================================================
-- 0005_whatsapp_webhook.sql — Webhook WhatsApp: persistência + idempotência.
--
-- Contexto: F1-S19. Destrava F1-T19 (Webhook de entrada WhatsApp).
--
-- LGPD §8.5 — CRÍTICO:
--   O campo `payload` em whatsapp_messages contém corpo de mensagem WhatsApp.
--   PII (telefone, texto livre do cidadão) é mantida APENAS nesta tabela,
--   acessada sob escopo RBAC. Nunca replicada para outbox.
--   Logs do backend redactam `payload.text.body` e `payload.from`.
--
-- Novidades:
--   1. Tabela whatsapp_messages — armazena webhooks brutos do Meta.
--   2. Tabela idempotency_keys — chave de idempotência HTTP para o webhook.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. whatsapp_messages — payload bruto de cada mensagem recebida/enviada
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "whatsapp_messages" (
    "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

    -- Multi-tenant
    "organization_id" uuid NOT NULL,

    -- Identificador único dado pela Cloud API Meta.
    -- UNIQUE garante idempotência em nível de banco (segunda linha de defesa;
    -- a primeira é a tabela idempotency_keys).
    "wa_message_id"   text NOT NULL,

    -- FK opcional para a conversa do Chatwoot (pode ser null até o upsert)
    "conversation_id" uuid,

    -- 'inbound' | 'outbound'
    "direction"       text NOT NULL CHECK ("direction" IN ('inbound', 'outbound')),

    -- Payload completo do webhook Meta (JSONB).
    -- LGPD: contém PII (from, text.body). Acesso controlado por RBAC.
    -- Logs NÃO registram este campo diretamente — pino.redact cobre os paths.
    "payload"         jsonb NOT NULL,

    -- Timestamp da mensagem conforme campo `timestamp` do webhook Meta
    "received_at"     timestamp with time zone NOT NULL,

    "created_at"      timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. idempotency_keys — cache de resposta HTTP para o endpoint webhook
--
-- Permite responder 200 imediatamente para requisições duplicadas sem
-- reprocessar a lógica de negócio. Chave = header Idempotency-Key enviado
-- pelo caller (ou gerado internamente para o webhook Meta).
--
-- Retenção: linhas antigas limpas por job diário (índice em created_at).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "idempotency_keys" (
    "key"             text PRIMARY KEY NOT NULL,

    -- Endpoint que originou a chave (ex: "POST /api/whatsapp/webhook")
    "endpoint"        text NOT NULL,

    -- SHA-256 do corpo da requisição (hex) para detectar corpo diferente
    -- com mesma chave — retorna 422 Unprocessable Entity nesses casos.
    "request_hash"    text NOT NULL,

    -- HTTP status da resposta original
    "response_status" integer NOT NULL,

    -- Corpo da resposta original (para replay)
    -- LGPD: nunca armazenar PII aqui — apenas { ok: true, id: uuid }
    "response_body"   jsonb NOT NULL,

    "created_at"      timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Foreign Keys — whatsapp_messages
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE "whatsapp_messages"
    ADD CONSTRAINT "fk_whatsapp_messages_organization"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
    ON DELETE restrict ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Índices — whatsapp_messages
-- ---------------------------------------------------------------------------

-- Unique em wa_message_id — idempotência de segundo nível
CREATE UNIQUE INDEX IF NOT EXISTS "uq_whatsapp_messages_wa_message_id"
  ON "whatsapp_messages" ("wa_message_id");
--> statement-breakpoint

-- Índice composto para queries por organização ordenadas por data (dashboard)
CREATE INDEX IF NOT EXISTS "idx_whatsapp_messages_org_received"
  ON "whatsapp_messages" USING btree ("organization_id", "received_at" DESC);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. Índices — idempotency_keys
-- ---------------------------------------------------------------------------

-- Índice em created_at para o job de limpeza periódica
CREATE INDEX IF NOT EXISTS "idx_idempotency_keys_created_at"
  ON "idempotency_keys" USING btree ("created_at");
--> statement-breakpoint
