-- =============================================================================
-- 0066_law_firms.sql — Tabelas de advocacia: escritórios + encaminhamentos (F19-S01).
--
-- Contexto:
--   Foundation do épico de Advocacia (Onda 4). Cria as entidades de primeira
--   classe para gerenciamento de escritórios parceiros e rastreamento de
--   encaminhamentos de clientes inadimplentes para cobrança judicial.
--
-- Tabelas criadas:
--   law_firms                   — escritórios cadastrados pela org (soft-delete)
--   customer_law_firm_referrals — encaminhamentos com cooldown de 7 dias
--
-- Permissões seedadas:
--   law_firms:manage  → admin, gestor_geral (CRUD de escritórios)
--   law_firms:referral → admin, gestor_geral, gestor_regional, agente (encaminhar cliente)
--
-- Multi-tenant: organization_id em ambas as tabelas.
-- LGPD (doc 17): contact_phone é dado público de PJ. notes não deve conter CPF.
--   customer_id FK garante rastreabilidade para direito de exclusão.
--
-- Idempotente: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
--   INSERT ... ON CONFLICT DO NOTHING.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Parte 1 — Tabela law_firms
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "law_firms" (
  "id"                uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,

  /**
   * Multi-tenant root. Escritório pertence a exatamente uma organização.
   * FK ON DELETE RESTRICT: org com escritórios não pode ser excluída.
   */
  "organization_id"   uuid        NOT NULL,

  /**
   * Nome do escritório de advocacia.
   * Ex: "Oliveira & Associados Advogados", "Escritório Jurídico Rondônia".
   */
  "name"              text        NOT NULL,

  /**
   * Telefone público de contato do escritório (dado de PJ — não é PII pessoal).
   * Formato livre: app normaliza antes de exibir.
   * nullable: escritório pode ser cadastrado sem telefone inicialmente.
   */
  "contact_phone"     text,

  /**
   * Array de UUIDs das cidades de atuação (IDs da tabela cities).
   * GIN index permite `WHERE coverage_city_ids @> ARRAY[city_id]::uuid[]`.
   * Denormalizado para evitar tabela pivô — lista pequena por escritório.
   */
  "coverage_city_ids" uuid[]      NOT NULL DEFAULT '{}',

  /**
   * Quando true, este escritório é o padrão selecionado automaticamente
   * pela IA ao encaminhar clientes de cidades em coverage_city_ids.
   * Constraint de unicidade por cidade é aplicada na camada de aplicação.
   */
  "is_default_for_city" boolean   NOT NULL DEFAULT false,

  /**
   * Notas internas (especialidades, contatos secundários, histórico).
   * Campo livre para gestores — não incluir CPF ou PII de clientes.
   */
  "notes"             text,

  /**
   * Usuário que cadastrou o escritório.
   * FK ON DELETE SET NULL: exclusão de usuário não destrói o escritório.
   * null se cadastrado via migração de dados ou sistema.
   */
  "created_by"        uuid,

  "created_at"        timestamptz NOT NULL DEFAULT now(),
  "updated_at"        timestamptz NOT NULL DEFAULT now(),

  /**
   * Soft-delete: escritório desativado mantém FK de encaminhamentos históricos.
   * null = ativo. not-null = desativado.
   */
  "deleted_at"        timestamptz
);
--> statement-breakpoint

-- FK: law_firms → organizations (ON DELETE RESTRICT)
ALTER TABLE "law_firms"
  ADD CONSTRAINT "fk_law_firms_organization"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;
--> statement-breakpoint

-- FK: law_firms → users (ON DELETE SET NULL)
ALTER TABLE "law_firms"
  ADD CONSTRAINT "fk_law_firms_created_by"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint

-- Índice: listagem de escritórios por org filtrado por deleted_at.
-- Suporta: tela de gestão, dropdown de seleção, filtragem de ativos.
CREATE INDEX IF NOT EXISTS "idx_law_firms_org"
  ON "law_firms" ("organization_id", "deleted_at");
--> statement-breakpoint

-- Índice GIN em coverage_city_ids (uuid[]) para busca por cidade de atuação.
-- Suporta: `WHERE coverage_city_ids @> ARRAY[city_id]::uuid[]`
-- Necessário para identificar escritório padrão ao encaminhar cliente.
CREATE INDEX IF NOT EXISTS "idx_law_firms_cities"
  ON "law_firms" USING GIN ("coverage_city_ids");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Parte 2 — Tabela customer_law_firm_referrals
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "customer_law_firm_referrals" (
  "id"              uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,

  /**
   * Multi-tenant root. Encaminhamento pertence a exatamente uma organização.
   * FK ON DELETE RESTRICT: org com encaminhamentos não pode ser excluída.
   */
  "organization_id" uuid        NOT NULL,

  /**
   * Cliente encaminhado ao escritório.
   * FK ON DELETE RESTRICT: customer com encaminhamentos não pode ser excluído.
   * Preserva auditoria jurídica — dado de cobrança judicial.
   */
  "customer_id"     uuid        NOT NULL,

  /**
   * Escritório que recebeu o encaminhamento.
   * FK ON DELETE RESTRICT: escritório com encaminhamentos não pode ser excluído.
   * Mantém rastreabilidade do destino do processo mesmo após soft-delete.
   */
  "law_firm_id"     uuid        NOT NULL,

  /**
   * Usuário que realizou o encaminhamento.
   * null quando channel = 'ai' (encaminhamento automático pelo agente de IA).
   * FK ON DELETE SET NULL: histórico de auditoria sobrevive à exclusão do usuário.
   */
  "linked_by"       uuid,

  /**
   * Timestamp do encaminhamento (quando o vínculo foi criado).
   * Distinto de sent_at: o encaminhamento pode ser criado antes do disparo WhatsApp.
   * Imutável após criação — registra o momento da decisão de encaminhar.
   */
  "linked_at"       timestamptz NOT NULL DEFAULT now(),

  /**
   * Timestamp do disparo do WhatsApp notificando o escritório.
   * null até o worker disparar a mensagem.
   * Separado de linked_at para rastrear falhas de envio.
   */
  "sent_at"         timestamptz,

  /**
   * Canal que originou o encaminhamento.
   * 'human' → operador/gestor realizou manualmente via UI.
   * 'ai'    → agente LangGraph identificou inadimplência e encaminhou automaticamente.
   */
  "channel"         text        NOT NULL,

  /**
   * Data/hora até quando novo encaminhamento deste cliente é bloqueado.
   * Calculado como: linked_at + 7 days. Persistido para queries diretas eficientes.
   * null = sem cooldown ativo.
   * Worker e UI consultam: WHERE cooldown_until > now() para bloquear novo envio.
   */
  "cooldown_until"  timestamptz,

  /**
   * Notas sobre o encaminhamento (motivo, acordo proposto, retorno do escritório).
   * Campo de auditoria — não incluir CPF ou dados biométricos.
   */
  "notes"           text,

  "created_at"      timestamptz NOT NULL DEFAULT now(),

  -- Canal deve ser 'human' ou 'ai' — domínio fechado.
  CONSTRAINT "chk_referrals_channel" CHECK (channel IN ('human', 'ai'))
);
--> statement-breakpoint

-- FK: customer_law_firm_referrals → organizations (ON DELETE RESTRICT)
ALTER TABLE "customer_law_firm_referrals"
  ADD CONSTRAINT "fk_referrals_organization"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;
--> statement-breakpoint

-- FK: customer_law_firm_referrals → customers (ON DELETE RESTRICT)
ALTER TABLE "customer_law_firm_referrals"
  ADD CONSTRAINT "fk_referrals_customer"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT;
--> statement-breakpoint

-- FK: customer_law_firm_referrals → law_firms (ON DELETE RESTRICT)
ALTER TABLE "customer_law_firm_referrals"
  ADD CONSTRAINT "fk_referrals_law_firm"
    FOREIGN KEY ("law_firm_id") REFERENCES "law_firms"("id") ON DELETE RESTRICT;
--> statement-breakpoint

-- FK: customer_law_firm_referrals → users (ON DELETE SET NULL)
ALTER TABLE "customer_law_firm_referrals"
  ADD CONSTRAINT "fk_referrals_linked_by"
    FOREIGN KEY ("linked_by") REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint

-- Índice: verificação de cooldown por cliente.
-- Suporta: `WHERE customer_id = $1 AND cooldown_until > now()` antes de novo encaminhamento.
CREATE INDEX IF NOT EXISTS "idx_law_firm_referrals_customer"
  ON "customer_law_firm_referrals" ("customer_id", "cooldown_until");
--> statement-breakpoint

-- Índice: histórico de encaminhamentos por organização e cliente.
-- Suporta: ficha do cliente na UI, relatórios de encaminhamentos por org.
CREATE INDEX IF NOT EXISTS "idx_law_firm_referrals_org_customer"
  ON "customer_law_firm_referrals" ("organization_id", "customer_id");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Parte 3 — Seed de permissões do módulo de advocacia
-- ---------------------------------------------------------------------------

-- Inserir permissões (idempotente via ON CONFLICT DO NOTHING)
INSERT INTO "permissions" ("key", "description")
VALUES
  ('law_firms:manage',   'Gerenciar escritórios de advocacia — criar, editar e desativar'),
  ('law_firms:referral', 'Encaminhar cliente a escritório de advocacia — criar registro de encaminhamento')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

-- Vincular law_firms:manage ao admin (CRUD completo de escritórios)
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r CROSS JOIN "permissions" p
WHERE r.key = 'admin'
  AND p.key = 'law_firms:manage'
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Vincular law_firms:manage ao gestor_geral (gestão operacional de escritórios)
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r CROSS JOIN "permissions" p
WHERE r.key = 'gestor_geral'
  AND p.key = 'law_firms:manage'
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Vincular law_firms:referral ao admin
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r CROSS JOIN "permissions" p
WHERE r.key = 'admin'
  AND p.key = 'law_firms:referral'
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Vincular law_firms:referral ao gestor_geral
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r CROSS JOIN "permissions" p
WHERE r.key = 'gestor_geral'
  AND p.key = 'law_firms:referral'
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Vincular law_firms:referral ao gestor_regional (encaminha na sua cidade)
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r CROSS JOIN "permissions" p
WHERE r.key = 'gestor_regional'
  AND p.key = 'law_firms:referral'
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Vincular law_firms:referral ao agente (pode encaminhar manualmente)
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r CROSS JOIN "permissions" p
WHERE r.key = 'agente'
  AND p.key = 'law_firms:referral'
ON CONFLICT DO NOTHING;
