-- =============================================================================
-- 0006_feature_flags.sql — Tabela feature_flags + seed inicial.
--
-- Contexto: F1-S23.
--
-- Catálogo canônico em docs/09-feature-flags.md §3.
--
-- status:
--   'enabled'       — funcionalidade ativa para todos (ou audience qualificado)
--   'disabled'      — funcionalidade desativada; se visible=true, exibe badge
--   'internal_only' — visível apenas para roles em audience.roles
--
-- audience: JSONB com filtros opcionais.
--   Ex: { "roles": ["admin", "superadmin"], "city_ids": [] }
--   Vazio ({}) significa sem restrição de audience (todos os usuários).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tabela feature_flags
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "feature_flags" (
    "key" text PRIMARY KEY NOT NULL,

    -- Controle de visibilidade/comportamento
    "status" text NOT NULL DEFAULT 'disabled'
        CHECK ("status" IN ('enabled', 'disabled', 'internal_only')),

    -- true = aparece na UI (com badge se disabled); false = totalmente oculto
    "visible" boolean NOT NULL DEFAULT true,

    -- Label exibida na UI quando status='disabled' e visible=true
    -- null → usa default "Em desenvolvimento"
    "ui_label" text,

    "description" text,

    -- Filtros de audience (roles, city_ids, etc.) — sem PII
    "audience" jsonb NOT NULL DEFAULT '{}',

    -- Auditoria de quem fez o último toggle
    "updated_by" uuid,

    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Foreign Key — updated_by → users
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE "feature_flags"
    ADD CONSTRAINT "fk_feature_flags_updated_by"
    FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Índice para queries por status (lista admin filtrada)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "idx_feature_flags_status"
  ON "feature_flags" USING btree ("status");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Seed inicial — catálogo MVP (docs/09-feature-flags.md §3)
-- Usa INSERT … ON CONFLICT DO NOTHING para idempotência em re-runs.
-- ---------------------------------------------------------------------------
INSERT INTO "feature_flags" ("key", "status", "visible", "ui_label", "description", "audience")
VALUES
  -- Módulos habilitados no MVP
  ('crm.enabled',                                'enabled',  true,  NULL, 'Módulo CRM — pipeline de leads',                              '{}'),
  ('crm.import.enabled',                         'enabled',  true,  NULL, 'Importação de leads via planilha',                            '{}'),
  ('kanban.enabled',                             'enabled',  true,  NULL, 'Quadro Kanban de atendimento',                                '{}'),
  ('credit_simulation.enabled',                  'enabled',  true,  NULL, 'Simulação de crédito',                                        '{}'),
  ('credit_analysis.enabled',                    'enabled',  true,  NULL, 'Análise de crédito',                                          '{}'),
  ('credit_analysis.import.enabled',             'enabled',  true,  NULL, 'Importação de análises de crédito',                           '{}'),
  ('chatwoot.integration.enabled',               'enabled',  true,  NULL, 'Integração com Chatwoot',                                     '{}'),
  ('ai.whatsapp_agent.enabled',                  'enabled',  true,  NULL, 'Agente IA no WhatsApp',                                       '{}'),
  ('dashboard.enabled',                          'enabled',  true,  NULL, 'Dashboard principal',                                         '{}'),
  ('multi_city_routing.enabled',                 'enabled',  true,  NULL, 'Roteamento multi-cidade',                                     '{}'),

  -- Módulos desabilitados (futuras fases)
  ('ai.internal_assistant.enabled',              'disabled', true,  'Disponível na Fase 6', 'Assistente interno IA para agentes',         '{}'),
  ('internal_assistant.actions.enabled',         'disabled', true,  'Em desenvolvimento',   'Ações automatizadas via assistente interno', '{}'),
  ('followup.enabled',                           'disabled', true,  'Disponível na Fase 5', 'Régua de follow-up automático',              '{}'),
  ('collection.enabled',                         'disabled', true,  'Disponível na Fase 5', 'Módulo de cobrança',                        '{}'),
  ('dashboard.by_agent.enabled',                 'disabled', true,  'Disponível na Fase 6', 'Dashboard por agente',                      '{}'),
  ('dashboard.followup_metrics.enabled',         'disabled', true,  'Disponível na Fase 6', 'Métricas de follow-up no dashboard',        '{}'),
  ('reports.export.enabled',                     'disabled', true,  'Disponível na Fase 6', 'Exportação de relatórios',                  '{}'),
  ('internal_score.enabled',                     'disabled', true,  'Em desenvolvimento',   'Score interno de crédito',                  '{}'),

  -- Módulos ocultos (não visíveis na UI padrão)
  ('pwa.enabled',                                'disabled', false, NULL, 'Suporte a Progressive Web App',                               '{}'),
  ('auto_complete_on_chatwoot_resolved.enabled', 'disabled', false, NULL, 'Completar lead ao resolver conversa no Chatwoot',             '{}'),
  ('imports.regional.enabled',                   'disabled', false, NULL, 'Importações regionais sob demanda',                           '{}')

ON CONFLICT ("key") DO NOTHING;
