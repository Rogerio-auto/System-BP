-- =============================================================================
-- 0021_roles_scope_column.sql — Promove `scope` a coluna real em `roles`.
--
-- Contexto: F8-S07. Substitui derivação runtime (key→scope) por coluna
-- persistida com integridade garantida pelo enum `role_scope`.
--
-- Sequência segura para tabela com linhas existentes:
--   1. CREATE TYPE + ADD COLUMN scope nullable (não quebra tabela populada).
--   2. UPDATE backfill das 6 roles canônicas (doc 10 §3.1).
--   3. Guard: aborta se restarem rows com scope NULL (role desconhecida).
--   4. ALTER COLUMN scope SET NOT NULL.
--
-- Mapeamento key → scope (doc 10 §3.1):
--   admin           → global
--   gestor_geral    → global
--   gestor_regional → city
--   agente          → city
--   operador        → city
--   leitura         → city
--
-- Idempotência: CREATE TYPE ... IF NOT EXISTS; ADD COLUMN ... IF NOT EXISTS.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Criar enum e adicionar coluna nullable
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE role_scope AS ENUM ('global', 'city');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

ALTER TABLE "roles"
  ADD COLUMN IF NOT EXISTS "scope" role_scope;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Backfill: mapear roles canônicas conforme doc 10 §3.1
-- ---------------------------------------------------------------------------

UPDATE "roles"
SET "scope" = 'global'
WHERE "key" IN ('admin', 'gestor_geral')
  AND "scope" IS NULL;
--> statement-breakpoint

UPDATE "roles"
SET "scope" = 'city'
WHERE "key" IN ('gestor_regional', 'agente', 'operador', 'leitura')
  AND "scope" IS NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Guard: falha explícita se houver role com key desconhecida (scope ainda NULL)
--    Evita que SET NOT NULL passe silenciosamente com dados inválidos.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  unknown_count integer;
  unknown_keys  text;
BEGIN
  SELECT
    COUNT(*),
    string_agg(key, ', ' ORDER BY key)
  INTO unknown_count, unknown_keys
  FROM "roles"
  WHERE "scope" IS NULL;

  IF unknown_count > 0 THEN
    RAISE EXCEPTION
      'F8-S07 backfill incompleto: % role(s) com scope NULL após backfill. '
      'Keys desconhecidas: [%]. '
      'Adicione-as ao backfill com o scope correto antes de re-rodar esta migration.',
      unknown_count, unknown_keys;
  END IF;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Tornar coluna NOT NULL (garantido pelo guard acima)
-- ---------------------------------------------------------------------------

ALTER TABLE "roles"
  ALTER COLUMN "scope" SET NOT NULL;
