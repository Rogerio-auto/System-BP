-- =============================================================================
-- 0009_kanban.sql — Schema kanban: stages, cards e histórico de transições.
--
-- Contexto: F1-S13.
-- Dependências:
--   - 0000_init     (pgcrypto, pg_trgm, unaccent, citext)
--   - 0001_bent_mac_gargan (organizations)
--   - 0001/users    (users)
--   - 0007_leads_core (leads)
--
-- Tabelas criadas (em ordem de dependência):
--   1. kanban_stages        — definição das colunas do pipeline por org
--   2. kanban_cards         — estado atual de cada lead no pipeline (1:1 com leads)
--   3. kanban_stage_history — audit trail append-only das transições
--
-- Imutabilidade de kanban_stage_history:
--   Garantida pela camada de aplicação (service/repository só expõem insert).
--   Trigger não implementado para manter portabilidade e testabilidade.
--   Ver kanbanStageHistory.ts para justificativa completa.
--
-- LGPD (doc 17):
--   - Nenhuma coluna armazena PII diretamente.
--   - kanban_cards.notes é texto livre — aplicar redact antes de logar.
--   - kanban_stage_history.metadata NÃO deve conter PII bruta.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. kanban_stages — definição das colunas do pipeline
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "kanban_stages" (
    "id"               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Multi-tenant
    "organization_id"  uuid        NOT NULL,

    -- Identificação
    "name"             text        NOT NULL,
    "order_index"      integer     NOT NULL,

    -- Visual
    "color"            text,

    -- Flags de estado terminal
    "is_terminal_won"  boolean     NOT NULL DEFAULT false,
    "is_terminal_lost" boolean     NOT NULL DEFAULT false,

    -- Timestamps
    "created_at"       timestamptz NOT NULL DEFAULT now(),
    "updated_at"       timestamptz NOT NULL DEFAULT now(),

    -- Check: não pode ser won E lost ao mesmo tempo
    CONSTRAINT "chk_kanban_stages_terminal_exclusive"
        CHECK (NOT ("is_terminal_won" AND "is_terminal_lost"))
);
--> statement-breakpoint

-- Foreign Key: kanban_stages → organizations
DO $$ BEGIN
  ALTER TABLE "kanban_stages"
    ADD CONSTRAINT "fk_kanban_stages_organization"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Unique: (org, name) — sem dois stages com mesmo nome na mesma org
CREATE UNIQUE INDEX IF NOT EXISTS "uq_kanban_stages_org_name"
    ON "kanban_stages" ("organization_id", "name");
--> statement-breakpoint

-- Unique: (org, order_index) — posição única por org
CREATE UNIQUE INDEX IF NOT EXISTS "uq_kanban_stages_org_order"
    ON "kanban_stages" ("organization_id", "order_index");
--> statement-breakpoint

-- Índice: listagem ordenada dos stages de uma org
CREATE INDEX IF NOT EXISTS "idx_kanban_stages_org_order"
    ON "kanban_stages" USING btree ("organization_id", "order_index");
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 2. kanban_cards — estado atual de cada lead no pipeline (1:1 com leads)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "kanban_cards" (
    "id"                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Multi-tenant (denormalizado para evitar JOIN com leads no city-scope)
    "organization_id"   uuid        NOT NULL,

    -- Relação 1:1 com lead (UNIQUE garante cardinalidade)
    "lead_id"           uuid        NOT NULL,

    -- Stage atual
    "stage_id"          uuid        NOT NULL,

    -- Responsável (null = não atribuído)
    "assignee_user_id"  uuid,

    -- Prioridade (0 = normal, maiores = mais prioritário)
    "priority"          integer     NOT NULL DEFAULT 0,

    -- Notas livres (LGPD: pode conter PII — ver header)
    "notes"             text,

    -- Quando o card entrou no stage atual (atualizado em moveCard)
    "entered_stage_at"  timestamptz NOT NULL DEFAULT now(),

    -- Timestamps
    "created_at"        timestamptz NOT NULL DEFAULT now(),
    "updated_at"        timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- Foreign Keys: kanban_cards
DO $$ BEGIN
  ALTER TABLE "kanban_cards"
    ADD CONSTRAINT "fk_kanban_cards_organization"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "kanban_cards"
    ADD CONSTRAINT "fk_kanban_cards_lead"
    FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "kanban_cards"
    ADD CONSTRAINT "fk_kanban_cards_stage"
    FOREIGN KEY ("stage_id") REFERENCES "public"."kanban_stages"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "kanban_cards"
    ADD CONSTRAINT "fk_kanban_cards_assignee"
    FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Unique: 1 card por lead
CREATE UNIQUE INDEX IF NOT EXISTS "uq_kanban_cards_lead"
    ON "kanban_cards" ("lead_id");
--> statement-breakpoint

-- Índice: board query — cards de um stage por prioridade DESC
CREATE INDEX IF NOT EXISTS "idx_kanban_cards_org_stage_priority"
    ON "kanban_cards" USING btree ("organization_id", "stage_id", "priority" DESC);
--> statement-breakpoint

-- Índice: cards atribuídos a um usuário (parcial — só cards com assignee)
CREATE INDEX IF NOT EXISTS "idx_kanban_cards_assignee"
    ON "kanban_cards" USING btree ("assignee_user_id")
    WHERE "assignee_user_id" IS NOT NULL;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 3. kanban_stage_history — audit trail append-only das transições de stage
--
-- Append-only por design: a camada de aplicação nunca faz UPDATE/DELETE aqui.
-- Ver kanbanStageHistory.ts para documentação da decisão de design.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "kanban_stage_history" (
    "id"               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Card que transitou
    "card_id"          uuid        NOT NULL,

    -- Stage de origem (NULL = criação inicial do card, sem stage anterior)
    "from_stage_id"    uuid,

    -- Stage de destino (nunca nulo)
    "to_stage_id"      uuid        NOT NULL,

    -- Quem realizou a transição (null = sistema/worker)
    "actor_user_id"    uuid,

    -- Timestamp imutável
    "transitioned_at"  timestamptz NOT NULL DEFAULT now(),

    -- Metadados extras (LGPD: sem PII bruta)
    "metadata"         jsonb       NOT NULL DEFAULT '{}'
);
--> statement-breakpoint

-- Foreign Keys: kanban_stage_history
DO $$ BEGIN
  ALTER TABLE "kanban_stage_history"
    ADD CONSTRAINT "fk_kanban_stage_history_card"
    FOREIGN KEY ("card_id") REFERENCES "public"."kanban_cards"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "kanban_stage_history"
    ADD CONSTRAINT "fk_kanban_stage_history_from_stage"
    FOREIGN KEY ("from_stage_id") REFERENCES "public"."kanban_stages"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "kanban_stage_history"
    ADD CONSTRAINT "fk_kanban_stage_history_to_stage"
    FOREIGN KEY ("to_stage_id") REFERENCES "public"."kanban_stages"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "kanban_stage_history"
    ADD CONSTRAINT "fk_kanban_stage_history_actor"
    FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Índice: timeline do card (mais recentes primeiro)
CREATE INDEX IF NOT EXISTS "idx_kanban_stage_history_card_time"
    ON "kanban_stage_history" USING btree ("card_id", "transitioned_at" DESC);
--> statement-breakpoint

-- Índice: análise de funil por stage de destino
CREATE INDEX IF NOT EXISTS "idx_kanban_stage_history_to_stage"
    ON "kanban_stage_history" USING btree ("to_stage_id");
