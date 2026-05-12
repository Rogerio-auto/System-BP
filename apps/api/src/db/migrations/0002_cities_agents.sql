-- =============================================================================
-- 0002_cities_agents.sql — Tabelas: cities, agents, agent_cities
--
-- Contexto: F1-S05. Destrava F1-S06 (CRUD cities), F1-S07 (CRUD agents),
-- F1-S09 (fuzzy match de cidades).
--
-- Novidades nesta migration:
--   1. Tabela cities (municípios multi-tenant com fuzzy match via pg_trgm).
--   2. Tabela agents (operadores humanos com soft-delete).
--   3. Tabela agent_cities (atribuições N:N agente ↔ cidade com is_primary).
--   4. FK fk_user_city_scopes_city adicionada (foi adiada no slot F1-S01 para
--      evitar dependência circular; user_city_scopes.city_id referencia cities).
--
-- Extensões exigidas (já criadas em 0000_init.sql):
--   pg_trgm, unaccent, citext
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. cities
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "cities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" "citext" NOT NULL,
	-- name sem acentos, lowercase (gerado pela app via unaccent + lower).
	-- Alimenta o índice GIN gin_trgm_ops para fuzzy match em identify_city (F3).
	"name_normalized" text NOT NULL,
	-- Variações de grafia aceitas para matching de entrada do usuário.
	-- Ex: '{PVH, porto velho, p. velho}'::text[]
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	-- URL-safe gerado pela app (lower + slugify(name)). Ex: 'porto-velho'.
	"slug" text NOT NULL,
	-- Código IBGE de 7 dígitos. Ex: '1100205' (Porto Velho).
	-- Null em edge cases de importação manual.
	"ibge_code" text,
	-- UF de 2 letras. Default 'RO' para esta implantação.
	"state_uf" varchar(2) DEFAULT 'RO' NOT NULL,
	-- false = cidade desligada. Leads existentes são preservados.
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	-- Soft-delete: mantém histórico de leads de cidades desativadas.
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. agents
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	-- FK opcional: null = agente sem login ativo (importado/legado).
	"user_id" uuid,
	-- Nome de exibição na UI (pode diferir de users.full_name).
	"display_name" text NOT NULL,
	-- Telefone interno do agente (E.164). Dado pessoal de colaborador —
	-- tratamento com base LGPD art. 7°, IX (legítimo interesse).
	"phone" text,
	-- false = agente inativo. Não recebe novos leads.
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	-- Soft-delete: preserva histórico de leads atribuídos a agentes desligados.
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. agent_cities (N:N com metadado is_primary)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "agent_cities" (
	"agent_id" uuid NOT NULL,
	"city_id" uuid NOT NULL,
	-- true = cidade principal do agente. Máximo 1 por agente (validado em serviço).
	"is_primary" boolean DEFAULT false NOT NULL,
	CONSTRAINT "agent_cities_agent_id_city_id_pk" PRIMARY KEY("agent_id","city_id")
);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Foreign Keys — cities
-- ---------------------------------------------------------------------------
DO $$ BEGIN
 ALTER TABLE "cities" ADD CONSTRAINT "fk_cities_organization"
   FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
   ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. Foreign Keys — agents
-- ---------------------------------------------------------------------------
DO $$ BEGIN
 ALTER TABLE "agents" ADD CONSTRAINT "fk_agents_organization"
   FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
   ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agents" ADD CONSTRAINT "fk_agents_user"
   FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
   ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 6. Foreign Keys — agent_cities
-- ---------------------------------------------------------------------------
DO $$ BEGIN
 ALTER TABLE "agent_cities" ADD CONSTRAINT "fk_agent_cities_agent"
   FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id")
   ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_cities" ADD CONSTRAINT "fk_agent_cities_city"
   FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id")
   ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 7. FK deferred do F1-S01: user_city_scopes.city_id → cities.id
-- ---------------------------------------------------------------------------
DO $$ BEGIN
 ALTER TABLE "user_city_scopes" ADD CONSTRAINT "fk_user_city_scopes_city"
   FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id")
   ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 8. Índices — cities
-- ---------------------------------------------------------------------------

-- B-tree em FK para joins org → cities
CREATE INDEX IF NOT EXISTS "idx_cities_org"
  ON "cities" USING btree ("organization_id");
--> statement-breakpoint

-- GIN trigram em name_normalized para fuzzy search (identify_city, F3).
-- Requer: CREATE EXTENSION IF NOT EXISTS pg_trgm (0000_init.sql).
-- CONCURRENTLY não pode ser usada em transação — drizzle-kit gera sem ela em migrations.
CREATE INDEX IF NOT EXISTS "idx_cities_name_normalized_trgm"
  ON "cities" USING gin ("name_normalized" gin_trgm_ops);
--> statement-breakpoint

-- GIN em aliases[] para lookup por variação de nome: WHERE aliases @> '{pvh}'
CREATE INDEX IF NOT EXISTS "idx_cities_aliases_gin"
  ON "cities" USING gin ("aliases");
--> statement-breakpoint

-- Unique parcial: (org, ibge_code) excluindo soft-deleted e nulos
CREATE UNIQUE INDEX IF NOT EXISTS "uq_cities_org_ibge_active"
  ON "cities" ("organization_id", "ibge_code")
  WHERE "deleted_at" IS NULL AND "ibge_code" IS NOT NULL;
--> statement-breakpoint

-- Unique parcial: (org, slug) excluindo soft-deleted
CREATE UNIQUE INDEX IF NOT EXISTS "uq_cities_org_slug_active"
  ON "cities" ("organization_id", "slug")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 9. Índices — agents
-- ---------------------------------------------------------------------------

-- B-tree em FK para joins org → agents
CREATE INDEX IF NOT EXISTS "idx_agents_org"
  ON "agents" USING btree ("organization_id");
--> statement-breakpoint

-- B-tree em user_id para lookup "qual agente tem este user?"
CREATE INDEX IF NOT EXISTS "idx_agents_user_id"
  ON "agents" USING btree ("user_id");
--> statement-breakpoint

-- Unique parcial: um user só tem 1 agente ativo por org.
-- Permite re-cadastro após soft-delete.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_agents_org_user_active"
  ON "agents" ("organization_id", "user_id")
  WHERE "deleted_at" IS NULL AND "user_id" IS NOT NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 10. Índices — agent_cities
-- ---------------------------------------------------------------------------

-- B-tree em city_id para "quais agentes cobrem esta cidade?"
CREATE INDEX IF NOT EXISTS "idx_agent_cities_city"
  ON "agent_cities" USING btree ("city_id");
