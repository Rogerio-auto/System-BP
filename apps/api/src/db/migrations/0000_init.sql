-- =============================================================================
-- 0000_init.sql — marco zero do schema.
-- Garante extensions e cria tabela técnica para validar pipeline de migration.
-- Toda migration subsequente assume que essas extensions existem.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS citext;

-- Tabela técnica que confirma que o pipeline de migration foi executado.
-- Não é tabela de domínio — não tem organization_id.
-- Um único registro garante idempotência via o INSERT condicional abaixo.
CREATE TABLE IF NOT EXISTS _schema_meta (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  applied_at  timestamptz NOT NULL DEFAULT now(),
  note        text        NOT NULL
);

-- Insere o registro marco-zero apenas se a tabela estiver vazia.
-- Re-rodar a migration não duplica a linha.
INSERT INTO _schema_meta (note)
SELECT 'F0-S04 — marco zero do schema'
WHERE NOT EXISTS (SELECT 1 FROM _schema_meta);
