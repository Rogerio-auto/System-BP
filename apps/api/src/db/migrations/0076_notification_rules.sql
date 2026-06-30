-- =============================================================================
-- 0076_notification_rules.sql — Motor de regras de notificação (F24-S01).
--
-- Alterações nesta migration:
--   1. Adiciona coluna `category` (text, nullable) em notification_preferences.
--   2. Substitui o UNIQUE (user_id, channel) por dois índices únicos parciais
--      que tratam NULL corretamente (NULL <> NULL em SQL).
--   3. Cria a tabela `notification_rules` com FKs, CHECK e índices.
--   4. Cria a tabela `notification_rule_deliveries` com FK CASCADE, UNIQUE e índice.
--
-- Dependências:
--   - 0000_init      (extensões pgcrypto, pg_trgm, unaccent, citext)
--   - 0001 / F1-S01  (tabelas organizations, users)
--   - 0057           (tabela notification_preferences já existente)
--
-- Idempotente:
--   ADD COLUMN IF NOT EXISTS; DROP INDEX IF EXISTS;
--   CREATE UNIQUE INDEX IF NOT EXISTS; CREATE INDEX IF NOT EXISTS;
--   CREATE TABLE IF NOT EXISTS.
--
-- Rollback manual (em caso de necessidade — migrations mergeadas não devem
-- ser revertidas; prefira criar nova migration corretiva):
--   DROP TABLE IF EXISTS notification_rule_deliveries;
--   DROP TABLE IF EXISTS notification_rules;
--   DROP INDEX IF EXISTS uq_notification_preferences_user_channel_cat;
--   DROP INDEX IF EXISTS uq_notification_preferences_user_channel_null_cat;
--   CREATE UNIQUE INDEX uq_notification_preferences_user_channel
--     ON notification_preferences (user_id, channel);
--   ALTER TABLE notification_preferences DROP COLUMN IF EXISTS category;
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Coluna category em notification_preferences
-- ---------------------------------------------------------------------------

-- Adiciona category como nullable: NULL = preferência genérica de canal
-- (fallback para todas as categorias). NOT NULL = preferência específica.
ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS category text;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Substituição do UNIQUE (user_id, channel) por dois índices parciais
--
-- Contexto: a introdução de category (nullable) invalida o UNIQUE simples.
-- Em SQL, NULL <> NULL — dois registros (user_id, channel, NULL) não
-- conflitariam num UNIQUE (user_id, channel, category) padrão. A solução
-- correta são dois índices parciais com cláusulas WHERE mutuamente exclusivas.
-- ---------------------------------------------------------------------------

-- Remove o índice anterior (simples, sem categoria).
DROP INDEX IF EXISTS uq_notification_preferences_user_channel;
--> statement-breakpoint

-- Preferência genérica de canal (category IS NULL):
--   Garante 1 registro por (user_id, channel) sem categoria específica.
--   Upsert: INSERT ... ON CONFLICT (user_id, channel) WHERE category IS NULL.
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_preferences_user_channel_null_cat
  ON notification_preferences (user_id, channel)
  WHERE category IS NULL;
--> statement-breakpoint

-- Preferência específica por categoria (category IS NOT NULL):
--   Garante 1 registro por (user_id, channel, category) com categoria preenchida.
--   Upsert: INSERT ... ON CONFLICT (user_id, channel, category) WHERE category IS NOT NULL.
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_preferences_user_channel_cat
  ON notification_preferences (user_id, channel, category)
  WHERE category IS NOT NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. notification_rules
--    Regras configuráveis que definem QUANDO e PARA QUEM gerar notificações.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS notification_rules (
  id               uuid        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Multi-tenant root (§8 CLAUDE.md).
  organization_id  uuid        NOT NULL,

  -- Nome descritivo para exibição na UI de configuração.
  name             text        NOT NULL,

  -- Tipo de gatilho:
  --   'event'            → evento específico no outbox (trigger_key = slug do evento).
  --   'stage_inactivity' → inatividade no kanban stage por threshold_hours horas.
  trigger_kind     text        NOT NULL
    CONSTRAINT chk_notification_rules_trigger_kind
      CHECK (trigger_kind IN ('event', 'stage_inactivity')),

  -- Slug do gatilho específico (evento outbox ou kanban stage).
  trigger_key      text        NOT NULL,

  -- Categoria da notificação gerada (espelhada em notification_preferences.category).
  category         text        NOT NULL,

  -- Horas de inatividade necessárias para disparar.
  -- OBRIGATÓRIO quando trigger_kind='stage_inactivity' (ver CHECK abaixo).
  -- NULL quando trigger_kind='event'.
  threshold_hours  integer,

  -- Filtros adicionais (schema aberto — sem migration para refinamentos).
  -- Exemplos: { "stage": "qualifying" }, { "credit_product_id": "<uuid>" }.
  filters          jsonb       NOT NULL DEFAULT '{}',

  -- Modo de destinatário da notificação gerada.
  recipient_mode   text        NOT NULL
    CONSTRAINT chk_notification_rules_recipient_mode
      CHECK (recipient_mode IN ('by_role_city', 'assignee', 'managers')),

  -- Roles que receberão a notificação (para recipient_mode='by_role_city').
  -- Sem FK — keys de roles são imutáveis (doc 10 §3.1).
  recipient_roles  text[]      NOT NULL DEFAULT '{}',

  -- Canais de entrega (ex: '{in_app}', '{in_app,whatsapp}').
  channels         text[]      NOT NULL DEFAULT '{in_app}',

  -- Severidade visual: 'info' (azul) | 'warning' (amarelo) | 'critical' (vermelho).
  severity         text        NOT NULL DEFAULT 'info'
    CONSTRAINT chk_notification_rules_severity
      CHECK (severity IN ('info', 'warning', 'critical')),

  -- Horas mínimas entre disparos para a mesma entidade (0 = sem cooldown).
  cooldown_hours   integer     NOT NULL DEFAULT 0,

  -- Templates de título e corpo com interpolação Handlebars-like.
  -- LGPD: podem conter PII indireta após renderização — não logar sem redact.
  title_template   text        NOT NULL,
  body_template    text        NOT NULL,

  -- Gating: false (default) = regra cadastrada mas INATIVA (worker ignora).
  enabled          boolean     NOT NULL DEFAULT false,

  -- Usuário criador para auditoria. NULL = criado via seed/migration.
  created_by       uuid,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  -- -------------------------------------------------------------------------
  -- Foreign Keys
  -- -------------------------------------------------------------------------

  CONSTRAINT fk_notification_rules_organization
    FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE RESTRICT,

  CONSTRAINT fk_notification_rules_created_by
    FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,

  -- -------------------------------------------------------------------------
  -- Check Constraint (lógico)
  -- -------------------------------------------------------------------------

  -- threshold_hours obrigatório quando trigger_kind='stage_inactivity'.
  -- Sem threshold_hours, o worker não saberia quantas horas aguardar.
  -- Para trigger_kind='event', threshold_hours é irrelevante (NULL permitido).
  CONSTRAINT chk_notification_rules_threshold_hours
    CHECK (trigger_kind <> 'stage_inactivity' OR threshold_hours IS NOT NULL)
);
--> statement-breakpoint

-- Query do worker: regras ativas por tipo de gatilho.
-- "Todas as regras ativas de trigger_kind X na organização Y."
CREATE INDEX IF NOT EXISTS idx_notification_rules_org_enabled_trigger_kind
  ON notification_rules (organization_id, enabled, trigger_kind);
--> statement-breakpoint

-- Lookup de regras por evento específico.
-- "Quais regras respondem ao evento 'lead.stage_changed' na org X?"
CREATE INDEX IF NOT EXISTS idx_notification_rules_org_trigger_key
  ON notification_rules (organization_id, trigger_key);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. notification_rule_deliveries
--    Registro imutável de cada entrega: idempotência + controle de cooldown.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS notification_rule_deliveries (
  id               uuid        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Multi-tenant root: incluso para queries de limpeza por org sem JOIN.
  organization_id  uuid        NOT NULL,

  -- Regra que disparou esta entrega.
  -- CASCADE: ao remover a regra, todos os registros de entrega são apagados.
  rule_id          uuid        NOT NULL,

  -- Entidade alvo (polimorfismo — sem FK rígida).
  entity_type      text        NOT NULL,
  entity_id        uuid        NOT NULL,

  -- Slot temporal ou chave de idempotência (ex: "2026-06-30", hash do event_id).
  -- Junto com rule_id+entity_type+entity_id garante 1 entrega por bucket.
  bucket           text        NOT NULL,

  -- Timestamp do disparo (usado para cálculo de cooldown e limpeza LGPD).
  fired_at         timestamptz NOT NULL DEFAULT now(),

  -- -------------------------------------------------------------------------
  -- Foreign Keys
  -- -------------------------------------------------------------------------

  CONSTRAINT fk_notification_rule_deliveries_organization
    FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE RESTRICT,

  CONSTRAINT fk_notification_rule_deliveries_rule
    FOREIGN KEY (rule_id) REFERENCES notification_rules (id) ON DELETE CASCADE,

  -- -------------------------------------------------------------------------
  -- Unique Constraint (Idempotência de entrega)
  -- -------------------------------------------------------------------------

  -- 1 entrega por (regra, entidade, bucket).
  -- Worker: INSERT ... ON CONFLICT (rule_id, entity_type, entity_id, bucket)
  -- DO NOTHING → skip idempotente se já foi entregue neste bucket.
  CONSTRAINT uq_notification_rule_deliveries_rule_entity_bucket
    UNIQUE (rule_id, entity_type, entity_id, bucket)
);
--> statement-breakpoint

-- Query de cooldown e limpeza de registros antigos.
-- Cooldown: WHERE rule_id=X AND entity_id=Y ORDER BY fired_at DESC LIMIT 1.
-- Limpeza LGPD: WHERE rule_id=X AND fired_at < (now() - interval 'N days').
CREATE INDEX IF NOT EXISTS idx_notification_rule_deliveries_rule_fired_at
  ON notification_rule_deliveries (rule_id, fired_at);
