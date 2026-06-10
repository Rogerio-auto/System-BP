-- =============================================================================
-- 0050_media_header_boleto.sql — Header de mídia em whatsapp_templates +
--                                campos de boleto em payment_dues + flags (F5-S10).
--
-- Contexto: docs/07-integracoes-whatsapp-chatwoot.md#midia-boleto.
--   Habilita o caminho oficial da Meta para enviar BOLETO na cobrança:
--   template aprovado com header de mídia (DOCUMENT/IMAGE) + parâmetro de
--   documento no envio. Este passo é SOMENTE schema + flags; a lógica de
--   submissão/upload/envio vem em F5-S11..S14.
--
-- Decisão de produto (2026-06-10): boleto é IMPORTADO/ANEXADO (gerado pelo
--   sistema do Banco do Povo) — sem integração bancária/PSP. Guardamos apenas
--   a REFERÊNCIA (URL controlada/assinada ou media id), não os bytes do PDF.
--
-- LGPD (doc 17): boleto contém PII (nome, CPF, endereço). boleto_url deve ser
--   controlada/assinada; boleto_url/boleto_digitable_line/pix_copia_cola entram
--   no pino.redact; outbox jamais carrega esses campos; retenção = 5 anos (parcela).
--
-- Dependências:
--   - 0034_followup_and_templates (whatsapp_templates)
--   - 0036_collection             (payment_dues)
--   - 0006_feature_flags          (feature_flags)
--
-- Idempotente: ADD COLUMN IF NOT EXISTS; CREATE INDEX IF NOT EXISTS;
--   INSERT ... ON CONFLICT (key) DO NOTHING.
-- Rollback manual:
--   ALTER TABLE whatsapp_templates DROP COLUMN header_type, DROP COLUMN header_text, DROP COLUMN header_handle;
--   ALTER TABLE payment_dues DROP COLUMN boleto_url, ... ;
--   DELETE FROM feature_flags WHERE key IN ('templates.media.enabled','billing.boleto.enabled');
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. whatsapp_templates — header de mídia
-- ---------------------------------------------------------------------------

ALTER TABLE "whatsapp_templates"
  ADD COLUMN IF NOT EXISTS "header_type" text NOT NULL DEFAULT 'none';
--> statement-breakpoint

ALTER TABLE "whatsapp_templates"
  ADD COLUMN IF NOT EXISTS "header_text" text;
--> statement-breakpoint

ALTER TABLE "whatsapp_templates"
  ADD COLUMN IF NOT EXISTS "header_handle" text;
--> statement-breakpoint

-- Enum de header_type (defensivo; Drizzle usa text + enum no app).
ALTER TABLE "whatsapp_templates"
  DROP CONSTRAINT IF EXISTS "chk_whatsapp_templates_header_type";
--> statement-breakpoint
ALTER TABLE "whatsapp_templates"
  ADD CONSTRAINT "chk_whatsapp_templates_header_type"
  CHECK ("header_type" IN ('none', 'text', 'document', 'image', 'video'));
--> statement-breakpoint

-- header_text só quando header_type='text'; NULL nos demais.
ALTER TABLE "whatsapp_templates"
  DROP CONSTRAINT IF EXISTS "chk_whatsapp_templates_header_text";
--> statement-breakpoint
ALTER TABLE "whatsapp_templates"
  ADD CONSTRAINT "chk_whatsapp_templates_header_text"
  CHECK (
    ("header_type" = 'text' AND "header_text" IS NOT NULL)
    OR ("header_type" <> 'text' AND "header_text" IS NULL)
  );
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. payment_dues — referência de boleto (todas nullable)
-- ---------------------------------------------------------------------------

ALTER TABLE "payment_dues"
  ADD COLUMN IF NOT EXISTS "boleto_url" text;
--> statement-breakpoint

ALTER TABLE "payment_dues"
  ADD COLUMN IF NOT EXISTS "boleto_media_id" text;
--> statement-breakpoint

ALTER TABLE "payment_dues"
  ADD COLUMN IF NOT EXISTS "boleto_media_expires_at" timestamptz;
--> statement-breakpoint

ALTER TABLE "payment_dues"
  ADD COLUMN IF NOT EXISTS "boleto_digitable_line" text;
--> statement-breakpoint

ALTER TABLE "payment_dues"
  ADD COLUMN IF NOT EXISTS "pix_copia_cola" text;
--> statement-breakpoint

ALTER TABLE "payment_dues"
  ADD COLUMN IF NOT EXISTS "boleto_filename" text;
--> statement-breakpoint

ALTER TABLE "payment_dues"
  ADD COLUMN IF NOT EXISTS "boleto_attached_at" timestamptz;
--> statement-breakpoint

-- Índice PARCIAL: parcelas com boleto anexado (scanner do sender F5-S14).
CREATE INDEX IF NOT EXISTS "idx_payment_dues_with_boleto"
  ON "payment_dues" ("status", "due_date")
  WHERE "boleto_url" IS NOT NULL OR "boleto_media_id" IS NOT NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Feature flags (default disabled — habilitação progressiva pós sign-off)
--    templates.media.enabled : gate de templates com header de mídia.
--    billing.boleto.enabled  : gate de anexar/enviar boleto na cobrança.
--      Operacional: só habilitar após billing.enabled E templates.media.enabled.
-- ---------------------------------------------------------------------------

INSERT INTO "feature_flags" ("key", "status", "visible", "ui_label", "description", "updated_by")
VALUES (
  'templates.media.enabled',
  'disabled',
  true,
  'Templates com mídia',
  'Habilita templates de WhatsApp com header de mídia (documento/imagem). Pré-requisito para enviar boleto na cobrança.',
  NULL
)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

INSERT INTO "feature_flags" ("key", "status", "visible", "ui_label", "description", "updated_by")
VALUES (
  'billing.boleto.enabled',
  'disabled',
  true,
  'Boleto na cobrança',
  'Habilita anexar e enviar boleto (documento) nas mensagens de cobrança. Requer billing.enabled e templates.media.enabled ativos.',
  NULL
)
ON CONFLICT ("key") DO NOTHING;
