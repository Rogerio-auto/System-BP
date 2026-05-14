-- =============================================================================
-- 0016_credit_core.sql — Schema de crédito: produtos, regras e simulações.
--
-- Contexto: F2-S01.
-- Dependências:
--   - 0000_init       (pgcrypto, gen_random_uuid)
--   - 0001_bent_mac_gargan (organizations)
--   - 0007_leads_core (leads, customers)
--   - 0001/users      (users)
--   - 0009_kanban     (kanban_cards)
--
-- Nota sobre 0014 e 0015:
--   Reservados para F8 (schema de análise de crédito e versões).
--   Não criar arquivos com estes números sem coordenação com F8.
--
-- Tabelas criadas (em ordem de dependência):
--   1. credit_products      — catálogo de produtos de crédito
--   2. credit_product_rules — regras versionadas (parâmetros numéricos) por produto
--   3. credit_simulations   — resultados imutáveis de simulações
--
-- Alterações em tabelas existentes:
--   4. leads.last_simulation_id       — adiciona FK física para credit_simulations
--   5. kanban_cards.product_id        — nova coluna com FK física
--   6. kanban_cards.last_simulation_id — nova coluna com FK física
--
-- Seed programático (idempotente) em apps/api/src/db/seeds/creditProducts.ts:
--   - Produto 'microcredito_basico'
--   - Regra v1: R$ 500–5000, 3–24 meses, 2,5%/mês, Price
--
-- LGPD: este schema não armazena PII diretamente.
--   credit_simulations.lead_id aponta para leads (que têm PII) — não logar
--   o lead_id em contextos não protegidos por RBAC.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. credit_products — catálogo de produtos de crédito
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "credit_products" (
    "id"              uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

    -- Multi-tenant
    "organization_id" uuid        NOT NULL,

    -- Slug único por org (ex: 'microcredito_basico').
    -- Usado como referência estável em feature flags e integrações.
    "key"             text        NOT NULL,

    -- Nome legível para exibição (ex: 'Microcrédito Básico').
    "name"            text        NOT NULL,

    -- Descrição opcional para agentes e clientes.
    "description"     text,

    -- Produto disponível para novas simulações (false = descontinuado).
    "is_active"       boolean     NOT NULL DEFAULT true,

    -- Timestamps
    "created_at"      timestamptz NOT NULL DEFAULT now(),
    "updated_at"      timestamptz NOT NULL DEFAULT now(),

    -- Soft-delete: preserva histórico de simulações antigas.
    "deleted_at"      timestamptz
);
--> statement-breakpoint

-- FK: credit_products → organizations
DO $$ BEGIN
  ALTER TABLE "credit_products"
    ADD CONSTRAINT "fk_credit_products_organization"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Unique parcial: slug único por org entre produtos ativos.
-- WHERE deleted_at IS NULL: reutilização de slug após soft-delete é permitida.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_credit_products_org_key_active"
    ON "credit_products" ("organization_id", "key")
    WHERE "deleted_at" IS NULL;
--> statement-breakpoint

-- Índice: listagem de produtos ativos da organização.
CREATE INDEX IF NOT EXISTS "idx_credit_products_org_active"
    ON "credit_products" USING btree ("organization_id", "is_active");
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 2. credit_product_rules — regras versionadas por produto
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "credit_product_rules" (
    "id"               uuid         PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

    -- Produto ao qual esta regra pertence.
    "product_id"       uuid         NOT NULL,

    -- Versão sequencial (1, 2, 3...). Unique por produto.
    "version"          integer      NOT NULL,

    -- Faixa de valor permitida (em reais).
    "min_amount"       numeric(14,2) NOT NULL,
    "max_amount"       numeric(14,2) NOT NULL,

    -- Faixa de prazo permitida (em meses).
    "min_term_months"  integer      NOT NULL,
    "max_term_months"  integer      NOT NULL,

    -- Taxa mensal como decimal (ex: 0.025 = 2,5% ao mês).
    -- AVISO: armazenar como decimal, não como percentual.
    "monthly_rate"     numeric(8,6)  NOT NULL,

    -- IOF diário como decimal (null = produto isento de IOF).
    "iof_rate"         numeric(8,6),

    -- Sistema de amortização: 'price' (padrão) ou 'sac'.
    "amortization"     text         NOT NULL DEFAULT 'price'
        CONSTRAINT "chk_credit_product_rules_amortization"
            CHECK ("amortization" IN ('price', 'sac')),

    -- Restrição por cidade (null = válido para todas as cidades da org).
    -- uuid[] — array de city_id permitidos.
    "city_scope"       uuid[],

    -- Início de vigência desta versão da regra.
    "effective_from"   timestamptz  NOT NULL DEFAULT now(),

    -- Fim de vigência (null = vigente indefinidamente até nova versão).
    "effective_to"     timestamptz,

    -- Versão disponível para novas simulações (false = histórico).
    "is_active"        boolean      NOT NULL DEFAULT true,

    -- Usuário que publicou esta versão (null = seed/automação).
    "created_by"       uuid,

    -- Timestamp de criação (sem updated_at — regras são imutáveis).
    "created_at"       timestamptz  NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- FK: credit_product_rules → credit_products
DO $$ BEGIN
  ALTER TABLE "credit_product_rules"
    ADD CONSTRAINT "fk_credit_product_rules_product"
    FOREIGN KEY ("product_id") REFERENCES "public"."credit_products"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- FK: credit_product_rules → users (criador da versão)
DO $$ BEGIN
  ALTER TABLE "credit_product_rules"
    ADD CONSTRAINT "fk_credit_product_rules_created_by"
    FOREIGN KEY ("created_by") REFERENCES "public"."users"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Unique: versão única por produto.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_credit_product_rules_product_version"
    ON "credit_product_rules" ("product_id", "version");
--> statement-breakpoint

-- Índice: regra ativa por produto.
CREATE INDEX IF NOT EXISTS "idx_credit_product_rules_product_active"
    ON "credit_product_rules" USING btree ("product_id", "is_active");
--> statement-breakpoint

-- Índice: busca por versão (auditoria).
CREATE INDEX IF NOT EXISTS "idx_credit_product_rules_product_version"
    ON "credit_product_rules" USING btree ("product_id", "version");
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 3. credit_simulations — resultados imutáveis de simulações
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "credit_simulations" (
    "id"                      uuid          PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

    -- Multi-tenant (denormalizado para city-scope direto).
    "organization_id"         uuid          NOT NULL,

    -- Lead que originou esta simulação.
    "lead_id"                 uuid          NOT NULL,

    -- Cliente identificado (null = antes de coletar CPF/CNPJ).
    "customer_id"             uuid,

    -- Produto simulado.
    "product_id"              uuid          NOT NULL,

    -- Versão da regra usada. Imutável após criação (auditoria de crédito).
    -- Garante que simulações antigas sempre possam ser recalculadas.
    "rule_version_id"         uuid          NOT NULL,

    -- Parâmetros de entrada do cliente.
    "amount_requested"        numeric(14,2) NOT NULL,
    "term_months"             integer       NOT NULL,

    -- Resultados calculados.
    "monthly_payment"         numeric(14,2) NOT NULL,
    "total_amount"            numeric(14,2) NOT NULL,
    "total_interest"          numeric(14,2) NOT NULL,

    -- Snapshot da taxa mensal para exibição sem JOIN (ex: 0.025 = 2,5%).
    "rate_monthly_snapshot"   numeric(8,6)  NOT NULL,

    -- Tabela de amortização completa em JSON.
    -- Cada item: { parcela, saldo_devedor, amortizacao, juros, prestacao }.
    "amortization_table"      jsonb         NOT NULL DEFAULT '[]',

    -- Origem da simulação.
    "origin"                  text          NOT NULL DEFAULT 'manual'
        CONSTRAINT "chk_credit_simulations_origin"
            CHECK ("origin" IN ('manual', 'ai', 'import')),

    -- Usuário que criou manualmente (null = IA ou importação).
    "created_by_user_id"      uuid,

    -- Sem updated_at — simulações são imutáveis após criação.
    "created_at"              timestamptz   NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- FK: credit_simulations → organizations
DO $$ BEGIN
  ALTER TABLE "credit_simulations"
    ADD CONSTRAINT "fk_credit_simulations_organization"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- FK: credit_simulations → leads
DO $$ BEGIN
  ALTER TABLE "credit_simulations"
    ADD CONSTRAINT "fk_credit_simulations_lead"
    FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- FK: credit_simulations → customers (nullable)
DO $$ BEGIN
  ALTER TABLE "credit_simulations"
    ADD CONSTRAINT "fk_credit_simulations_customer"
    FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- FK: credit_simulations → credit_products
DO $$ BEGIN
  ALTER TABLE "credit_simulations"
    ADD CONSTRAINT "fk_credit_simulations_product"
    FOREIGN KEY ("product_id") REFERENCES "public"."credit_products"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- FK: credit_simulations → credit_product_rules (imutável)
DO $$ BEGIN
  ALTER TABLE "credit_simulations"
    ADD CONSTRAINT "fk_credit_simulations_rule_version"
    FOREIGN KEY ("rule_version_id") REFERENCES "public"."credit_product_rules"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- FK: credit_simulations → users (criador)
DO $$ BEGIN
  ALTER TABLE "credit_simulations"
    ADD CONSTRAINT "fk_credit_simulations_created_by"
    FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Índice: histórico de simulações por lead.
CREATE INDEX IF NOT EXISTS "idx_credit_simulations_lead"
    ON "credit_simulations" USING btree ("lead_id");
--> statement-breakpoint

-- Índice: analytics por produto.
CREATE INDEX IF NOT EXISTS "idx_credit_simulations_org_product"
    ON "credit_simulations" USING btree ("organization_id", "product_id");
--> statement-breakpoint

-- Índice parcial: simulações de clientes identificados.
CREATE INDEX IF NOT EXISTS "idx_credit_simulations_customer"
    ON "credit_simulations" USING btree ("customer_id")
    WHERE "customer_id" IS NOT NULL;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 4. Alteração em leads: FK física para credit_simulations
--
-- last_simulation_id era uuid sem FK física (comentado como "FK virtual" em
-- leads.ts) para evitar dependência circular no CREATE TABLE inicial.
-- Adicionada aqui como ALTER TABLE após credit_simulations existir.
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE "leads"
    ADD CONSTRAINT "fk_leads_last_simulation"
    FOREIGN KEY ("last_simulation_id") REFERENCES "public"."credit_simulations"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Índice parcial: leads com simulação associada.
CREATE INDEX IF NOT EXISTS "idx_leads_last_simulation"
    ON "leads" USING btree ("last_simulation_id")
    WHERE "last_simulation_id" IS NOT NULL;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 5. Alteração em kanban_cards: colunas product_id e last_simulation_id
-- ---------------------------------------------------------------------------

-- Coluna product_id (nullable — produto ainda não definido no início do funil)
ALTER TABLE "kanban_cards"
    ADD COLUMN IF NOT EXISTS "product_id" uuid;
--> statement-breakpoint

-- Coluna last_simulation_id (nullable — nenhuma simulação ainda)
ALTER TABLE "kanban_cards"
    ADD COLUMN IF NOT EXISTS "last_simulation_id" uuid;
--> statement-breakpoint

-- FK: kanban_cards.product_id → credit_products
DO $$ BEGIN
  ALTER TABLE "kanban_cards"
    ADD CONSTRAINT "fk_kanban_cards_product"
    FOREIGN KEY ("product_id") REFERENCES "public"."credit_products"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- FK: kanban_cards.last_simulation_id → credit_simulations
DO $$ BEGIN
  ALTER TABLE "kanban_cards"
    ADD CONSTRAINT "fk_kanban_cards_last_simulation"
    FOREIGN KEY ("last_simulation_id") REFERENCES "public"."credit_simulations"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Índice parcial: cards com produto associado.
CREATE INDEX IF NOT EXISTS "idx_kanban_cards_product"
    ON "kanban_cards" USING btree ("product_id")
    WHERE "product_id" IS NOT NULL;
--> statement-breakpoint

-- Índice parcial: cards com simulação associada.
CREATE INDEX IF NOT EXISTS "idx_kanban_cards_last_simulation"
    ON "kanban_cards" USING btree ("last_simulation_id")
    WHERE "last_simulation_id" IS NOT NULL;
