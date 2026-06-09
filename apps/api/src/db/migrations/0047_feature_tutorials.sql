-- =============================================================================
-- 0047_feature_tutorials.sql — Tabela feature_tutorials + permissão
--                              tutorials:manage (F12-S01).
--
-- Contexto: fase F12 — Tutoriais em Vídeo (norma docs/21-tutoriais-em-video.md §4).
--
-- Dependências:
--   - 0000_init.sql          (extensões pgcrypto, pg_trgm, citext)
--   - 0001_bent_mac_gargan   (tabelas organizations, users, permissions,
--                             roles, role_permissions)
--
-- O que esta migration faz:
--   1. Cria a tabela feature_tutorials com colunas conforme §4.
--   2. Cria índice único parcial em feature_key WHERE deleted_at IS NULL.
--   3. Cria índice B-tree em is_active.
--   4. Semeia a permissão tutorials:manage.
--   5. Concede tutorials:manage ao papel admin (idempotente).
--
-- Soft-delete: deleted_at timestamptz NULL. NULL = ativo.
-- Multi-tenant: organization_id NULL = tutorial global do produto.
-- FKs: organization_id CASCADE; created_by SET NULL.
--
-- Idempotente: CREATE TABLE IF NOT EXISTS; INSERT ... ON CONFLICT DO NOTHING.
-- Rollback manual: DROP TABLE IF EXISTS feature_tutorials;
--   DELETE FROM permissions WHERE key = 'tutorials:manage';
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tabela feature_tutorials
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "feature_tutorials" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

  -- Multi-tenant: NULL = global; UUID = override de org específica.
  -- FK ON DELETE CASCADE: remoção de org apaga seus overrides.
  "organization_id" uuid
    REFERENCES "organizations"("id")
    ON DELETE CASCADE,

  -- Chave de funcionalidade do catálogo fechado (packages/shared-types/featureKeys.ts).
  -- Convenção: <modulo>.<entidade>.<acao>.
  -- Unicidade garantida pelo índice parcial abaixo (WHERE deleted_at IS NULL).
  "feature_key"     text NOT NULL,

  -- Título exibido no drawer de ajuda contextual (≤ 80 chars recomendado).
  "title"           text NOT NULL,

  -- Resumo de 2-3 linhas exibido no corpo do drawer.
  "description"     text NOT NULL,

  -- Provedor do vídeo: youtube | vimeo | mp4.
  "provider"        text NOT NULL
    CHECK ("provider" IN ('youtube', 'vimeo', 'mp4')),

  -- Referência do vídeo (video ID ou URL), interpretada conforme provider.
  "video_ref"       text NOT NULL,

  -- Hash de privacidade do Vimeo (parâmetro h=). NULL para youtube/mp4.
  "video_hash"      text,

  -- Slug do artigo na Central de Ajuda. NULL = sem artigo associado.
  "article_slug"    text,

  -- Controla visibilidade no ⓘ. false = rascunho/inativo.
  "is_active"       boolean NOT NULL DEFAULT true,

  -- Autor do registro. NULL = seed/migration sem ator humano.
  -- FK ON DELETE SET NULL: deletar user não apaga o tutorial.
  "created_by"      uuid
    REFERENCES "users"("id")
    ON DELETE SET NULL,

  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now(),

  -- Soft-delete. NULL = ativo. Preenchido pelo app no DELETE lógico.
  "deleted_at"      timestamptz
);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Índice único parcial: feature_key ativo (sem org override)
--    Garante que exista no máximo 1 tutorial ativo por feature_key global.
--    Permite reusar a key após soft-delete do registro anterior.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS "uq_feature_tutorials_key_active"
  ON "feature_tutorials" ("feature_key")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Índice em is_active — listagem pública (GET /api/help/tutorials)
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS "idx_feature_tutorials_is_active"
  ON "feature_tutorials" ("is_active");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Índice em organization_id — filtro de tenant (overrides futuros)
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS "idx_feature_tutorials_organization"
  ON "feature_tutorials" ("organization_id");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. Permissão tutorials:manage
--    Concede ao admin acesso total ao CRUD de tutoriais.
-- ---------------------------------------------------------------------------

INSERT INTO "permissions" ("key", "description")
VALUES (
  'tutorials:manage',
  'CRUD de tutoriais em vídeo (criar, editar, ativar/desativar, remover)'
)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 6. Conceder tutorials:manage ao papel admin
-- ---------------------------------------------------------------------------

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT
  r.id AS role_id,
  p.id AS permission_id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.key = 'admin'
  AND p.key = 'tutorials:manage'
ON CONFLICT DO NOTHING;
