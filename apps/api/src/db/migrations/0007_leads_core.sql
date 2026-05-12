-- =============================================================================
-- 0007_leads_core.sql — Core CRM: leads, customers, lead_history, interactions.
--
-- Contexto: F1-S09.
-- Dependências: 0000_init (extensions), 0001 (users), 0002 (cities, agents),
--               0001_bent_mac_gargan (organizations).
--
-- Tabelas criadas nesta migration (em ordem de dependência):
--   1. leads       — pipeline central do CRM
--   2. customers   — leads convertidos (closed_won)
--   3. lead_history — audit trail append-only
--   4. interactions — histórico de comunicações
--
-- LGPD (doc 17):
--   - name, email, phone_*: PII — pino.redact obrigatório no backend.
--   - cpf_encrypted/cpf_hash: NULL até F1-S24 implementar criptografia.
--   - interactions.content: PII potencial — TODO: cifrar em F2+.
--
-- Nota sobre GIN trgm:
--   - idx_leads_name_trgm usa gin_trgm_ops (operator class explícito).
--   - Drizzle não suporta operator class nativo — escrito manualmente aqui.
--   - Schema Drizzle declara .using('gin') como placeholder; este SQL é canônico.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tabela leads
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "leads" (
    "id"                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Multi-tenant
    "organization_id"    uuid        NOT NULL,
    "city_id"            uuid        NOT NULL,

    -- Atribuição (nullable — sem agente = aguardando roteamento)
    "agent_id"           uuid,

    -- Dados de contato (PII — ver LGPD)
    "name"               text        NOT NULL,
    "phone_e164"         text        NOT NULL
        CONSTRAINT "chk_leads_phone_e164_format" CHECK ("phone_e164" ~ '^\+\d{10,15}$'),
    "phone_normalized"   text        NOT NULL
        CONSTRAINT "chk_leads_phone_normalized_format" CHECK ("phone_normalized" ~ '^\d{10,15}$'),

    -- Pipeline
    "source"             text        NOT NULL
        CONSTRAINT "chk_leads_source" CHECK ("source" IN ('whatsapp','manual','import','chatwoot','api')),
    "status"             text        NOT NULL DEFAULT 'new'
        CONSTRAINT "chk_leads_status" CHECK ("status" IN ('new','qualifying','simulation','closed_won','closed_lost','archived')),

    -- FK virtual para simulations (F1-S22 criará a tabela; sem FK física aqui)
    "last_simulation_id" uuid,

    -- Dados adicionais (PII)
    "email"              citext,

    -- CPF cifrado (F1-S24 — NULL até lá)
    -- LGPD: dado sensível art. 11; armazenado apenas cifrado
    "cpf_encrypted"      bytea,
    "cpf_hash"           text,

    -- Livre
    "notes"              text,
    "metadata"           jsonb       NOT NULL DEFAULT '{}',

    -- Timestamps
    "created_at"         timestamptz NOT NULL DEFAULT now(),
    "updated_at"         timestamptz NOT NULL DEFAULT now(),

    -- Soft-delete
    "deleted_at"         timestamptz
);
--> statement-breakpoint

-- Foreign Keys
DO $$ BEGIN
  ALTER TABLE "leads"
    ADD CONSTRAINT "fk_leads_organization"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "leads"
    ADD CONSTRAINT "fk_leads_city"
    FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "leads"
    ADD CONSTRAINT "fk_leads_agent"
    FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Índices leads
-- Dedupe por telefone (parcial — apenas ativos)
CREATE UNIQUE INDEX IF NOT EXISTS "uq_leads_org_phone_active"
  ON "leads" ("organization_id", "phone_normalized")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

-- Pipeline view: org + status + created_at DESC
CREATE INDEX IF NOT EXISTS "idx_leads_org_status_created"
  ON "leads" USING btree ("organization_id", "status", "created_at" DESC);
--> statement-breakpoint

-- Filtro por cidade (city-scope RBAC)
CREATE INDEX IF NOT EXISTS "idx_leads_org_city"
  ON "leads" USING btree ("organization_id", "city_id");
--> statement-breakpoint

-- Atendimentos por agente (parcial — só leads com agente)
CREATE INDEX IF NOT EXISTS "idx_leads_agent"
  ON "leads" USING btree ("agent_id")
  WHERE "agent_id" IS NOT NULL;
--> statement-breakpoint

-- Busca fuzzy por nome (GIN trigram — operator class explícito)
-- Requer: pg_trgm (criado em 0000_init.sql)
CREATE INDEX IF NOT EXISTS "idx_leads_name_trgm"
  ON "leads" USING gin ("name" gin_trgm_ops);
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 2. Tabela customers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "customers" (
    "id"               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    "organization_id"  uuid        NOT NULL,

    -- Lead de origem (1:1 — UNIQUE garante que cada lead vira 1 customer no máximo)
    "primary_lead_id"  uuid        NOT NULL,

    -- Momento da conversão (imutável após criação)
    "converted_at"     timestamptz NOT NULL DEFAULT now(),

    -- Dados adicionais do cliente (ex: número de contrato, valor liberado)
    "metadata"         jsonb       NOT NULL DEFAULT '{}',

    "created_at"       timestamptz NOT NULL DEFAULT now(),
    "updated_at"       timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- Foreign Keys
DO $$ BEGIN
  ALTER TABLE "customers"
    ADD CONSTRAINT "fk_customers_organization"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "customers"
    ADD CONSTRAINT "fk_customers_lead"
    FOREIGN KEY ("primary_lead_id") REFERENCES "public"."leads"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Índices customers
-- 1 customer por lead (garantia de idempotência na conversão)
CREATE UNIQUE INDEX IF NOT EXISTS "uq_customers_primary_lead"
  ON "customers" ("primary_lead_id");
--> statement-breakpoint

-- Listagem de clientes por org, mais recentes primeiro
CREATE INDEX IF NOT EXISTS "idx_customers_org_converted"
  ON "customers" USING btree ("organization_id", "converted_at" DESC);
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 3. Tabela lead_history (append-only — sem updated_at)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "lead_history" (
    "id"            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Lead ao qual o evento pertence
    "lead_id"       uuid        NOT NULL,

    -- Nome do evento (aberto — não enum — para evitar migrations em novos eventos)
    -- Exemplos: 'created', 'status_changed', 'agent_assigned', 'simulation_started'
    "action"        text        NOT NULL,

    -- Snapshots (parciais — apenas campos que mudaram)
    -- LGPD: não incluir CPF, telefone ou email bruto nestes snapshots
    "before"        jsonb,
    "after"         jsonb,

    -- Quem executou (null = sistema/automação)
    "actor_user_id" uuid,

    "metadata"      jsonb       NOT NULL DEFAULT '{}',

    -- Imutável
    "created_at"    timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- Foreign Keys
DO $$ BEGIN
  ALTER TABLE "lead_history"
    ADD CONSTRAINT "fk_lead_history_lead"
    FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "lead_history"
    ADD CONSTRAINT "fk_lead_history_actor_user"
    FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Índices lead_history
-- Timeline do lead (mais recentes primeiro)
CREATE INDEX IF NOT EXISTS "idx_lead_history_lead_created"
  ON "lead_history" USING btree ("lead_id", "created_at" DESC);
--> statement-breakpoint

-- Auditoria por usuário (parcial — apenas ações humanas)
CREATE INDEX IF NOT EXISTS "idx_lead_history_actor"
  ON "lead_history" USING btree ("actor_user_id")
  WHERE "actor_user_id" IS NOT NULL;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 4. Tabela interactions (histórico de comunicações)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "interactions" (
    "id"              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Lead e org (org denormalizada para city-scope direto)
    "lead_id"         uuid        NOT NULL,
    "organization_id" uuid        NOT NULL,

    -- Canal e direção
    "channel"         text        NOT NULL
        CONSTRAINT "chk_interactions_channel" CHECK ("channel" IN ('whatsapp','phone','email','in_person','chatwoot')),
    "direction"       text        NOT NULL
        CONSTRAINT "chk_interactions_direction" CHECK ("direction" IN ('inbound','outbound')),

    -- Conteúdo
    -- LGPD §8.5: pode conter PII — TODO: cifrar em F2+. DLP obrigatório antes de LLM.
    "content"         text        NOT NULL,

    "metadata"        jsonb       NOT NULL DEFAULT '{}',

    -- ID externo para dedupe (WhatsApp message_id, Chatwoot message_id, etc.)
    "external_ref"    text,

    -- Imutável
    "created_at"      timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- Foreign Keys
DO $$ BEGIN
  ALTER TABLE "interactions"
    ADD CONSTRAINT "fk_interactions_lead"
    FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "interactions"
    ADD CONSTRAINT "fk_interactions_organization"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Índices interactions
-- Timeline de interações do lead
CREATE INDEX IF NOT EXISTS "idx_interactions_lead_created"
  ON "interactions" USING btree ("lead_id", "created_at" DESC);
--> statement-breakpoint

-- Relatórios por canal e org
CREATE INDEX IF NOT EXISTS "idx_interactions_org_channel_created"
  ON "interactions" USING btree ("organization_id", "channel", "created_at" DESC);
--> statement-breakpoint

-- Dedupe de mensagens externas (parcial — só quando external_ref presente)
CREATE UNIQUE INDEX IF NOT EXISTS "uq_interactions_channel_external_ref"
  ON "interactions" ("channel", "external_ref")
  WHERE "external_ref" IS NOT NULL;
