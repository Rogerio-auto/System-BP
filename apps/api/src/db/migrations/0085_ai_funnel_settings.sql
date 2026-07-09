-- =============================================================================
-- Migration 0085_ai_funnel_settings.sql -- Configuracao do agente proativo (F25-S05).
--
-- Cria a tabela ai_funnel_settings com configuracoes por org
-- para o worker funnel-housekeeping (limiares stagnant/abandon).
-- =============================================================================

CREATE TABLE IF NOT EXISTS "ai_funnel_settings" (
  "organization_id"      uuid    NOT NULL,
  "stagnant_after_days"  integer NOT NULL DEFAULT 7,
  "abandon_after_days"   integer NOT NULL DEFAULT 30,
  "enabled"              boolean NOT NULL DEFAULT false,
  "created_at"           timestamptz NOT NULL DEFAULT now(),
  "updated_at"           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "ai_funnel_settings_pkey"
    PRIMARY KEY ("organization_id"),

  CONSTRAINT "fk_ai_funnel_settings_organization"
    FOREIGN KEY ("organization_id")
    REFERENCES "organizations" ("id")
    ON DELETE CASCADE,

  CONSTRAINT "chk_ai_funnel_settings_stagnant_min"
    CHECK ("stagnant_after_days" >= 1),

  CONSTRAINT "chk_ai_funnel_settings_abandon_gt_stagnant"
    CHECK ("abandon_after_days" > "stagnant_after_days")
);
