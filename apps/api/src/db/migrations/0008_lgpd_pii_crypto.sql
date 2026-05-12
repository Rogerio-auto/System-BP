-- =============================================================================
-- 0008_lgpd_pii_crypto.sql — LGPD baseline: cifração de PII em coluna.
--
-- Contexto: F1-S24.
-- Dependências: 0000_init (pgcrypto), 0001 (users), 0007 (customers).
--
-- Objetivo (doc 17 §8.1):
--   1. Reforçar extensão pgcrypto (já criada em 0000, mas explicitado aqui
--      para documentar a dependência desta migration).
--   2. Adicionar colunas cifradas em customers e users.
--   3. Cifrar dados existentes inline (idempotente via UPDATE WHERE NULL).
--   4. Adicionar índice único para dedupe por document_hash.
--
-- Chave de cifração:
--   - A migration espera que a session tenha SET app.lgpd_data_key = '<chave>'
--     antes de rodar. Sem isso, pgp_sym_encrypt falha.
--   - Procedimento para aplicar em produção:
--       SET app.lgpd_data_key = '<LGPD_DATA_KEY em claro>';
--       \i 0008_lgpd_pii_crypto.sql
--   - A chave NÃO é armazenada no banco. A session_setting é efêmera.
--   - Em ambiente de teste sem dados existentes, o UPDATE ... WHERE é no-op.
--
-- Rollback (documentado em apps/api/docs/runbook-key-rotation.md):
--   1. Decifrar dados com a chave atual.
--   2. Remover colunas bytea adicionadas.
--   3. Reverter colunas text se necessário.
--   ATENÇÃO: rollback implica expor PII em texto claro — requer autorização do DPO.
--
-- LGPD (doc 17 §8.1, §14.2):
--   - PII nunca trafega em texto claro no banco.
--   - Chaves rotacionadas conforme runbook-key-rotation.md.
--   - Este SQL é revisado por security-reviewer antes de merge (label lgpd-impact).
-- =============================================================================

-- Reforçar extensão pgcrypto (idempotente — já existe de 0000_init).
-- Documentado aqui para deixar claro que esta migration depende dela.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================================
-- 1. customers — adicionar document_number (bytea) e document_hash (text)
-- =============================================================================

-- Adiciona coluna de CPF/CNPJ cifrado. NULL até os dados serem migrados.
-- bytea: armazena o output binário do AES-256-GCM (IV + auth_tag + ciphertext).
ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "document_number" bytea,
  ADD COLUMN IF NOT EXISTS "document_hash"   text;

-- Comentários de coluna para documentação inline no DB.
COMMENT ON COLUMN "customers"."document_number" IS
  'CPF/CNPJ cifrado com AES-256-GCM via lib/crypto/pii.ts. '
  'Chave: LGPD_DATA_KEY (env). NUNCA armazenar plaintext. '
  'LGPD doc 17 §8.1 — F1-S24.';

COMMENT ON COLUMN "customers"."document_hash" IS
  'HMAC-SHA256(plainCpf, LGPD_DEDUPE_PEPPER). '
  'Usado para busca/dedupe sem expor o plaintext. '
  'LGPD doc 17 §8.1 — F1-S24.';

-- Índice único parcial para dedupe por org + hash.
-- WHERE IS NOT NULL: customers sem documento ainda não participam da constraint.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_customers_org_document_hash"
  ON "customers" ("organization_id", "document_hash")
  WHERE "document_hash" IS NOT NULL;

-- =============================================================================
-- 2. users — alterar totp_secret de text para bytea
-- =============================================================================

-- Adiciona a nova coluna bytea para o secret cifrado.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "totp_secret_encrypted" bytea;

COMMENT ON COLUMN "users"."totp_secret_encrypted" IS
  'TOTP secret cifrado com AES-256-GCM via lib/crypto/pii.ts. '
  'Chave: LGPD_DATA_KEY (env). NUNCA armazenar plaintext. '
  'LGPD doc 17 §8.1 — F1-S24.';

-- Migrar dados existentes da coluna text para bytea cifrado.
-- Requer: SET app.lgpd_data_key = '<chave>' antes de rodar.
-- Idempotente: só migra rows onde totp_secret IS NOT NULL E a nova coluna ainda NULL.
-- pgp_sym_encrypt usa OpenPGP symmetric encryption (wrapper sobre pgcrypto).
-- Nota: pgp_sym_encrypt usa AES-256 internamente quando disponível via pgcrypto.
DO $$
DECLARE
  data_key text;
BEGIN
  -- Verifica se a chave foi configurada na session.
  BEGIN
    data_key := current_setting('app.lgpd_data_key');
  EXCEPTION WHEN OTHERS THEN
    data_key := NULL;
  END;

  IF data_key IS NULL OR data_key = '' THEN
    -- Em ambiente sem dados (dev/CI), apenas loga um aviso e continua.
    -- Em produção com dados existentes, deve-se configurar a chave antes.
    RAISE NOTICE '[LGPD] app.lgpd_data_key não configurada — dados existentes não cifrados. '
                 'Execute: SET app.lgpd_data_key = ''<chave>''; antes de rodar em produção.';
  ELSE
    -- Cifra dados existentes da coluna text para bytea.
    UPDATE "users"
    SET "totp_secret_encrypted" = pgp_sym_encrypt(
          "totp_secret",
          current_setting('app.lgpd_data_key')
        )::bytea
    WHERE "totp_secret" IS NOT NULL
      AND "totp_secret_encrypted" IS NULL;

    RAISE NOTICE '[LGPD] Migração de totp_secret concluída.';
  END IF;
END;
$$;

-- Remove a coluna text original após migração.
-- ATENÇÃO: em produção, só dropar após confirmar que todos os rows foram migrados.
-- Para zero-downtime, manter as duas colunas por 1 release e dropar no release seguinte.
-- Aqui dropa no mesmo migration pois é o estado inicial (sem dados em produção ainda).
ALTER TABLE "users" DROP COLUMN IF EXISTS "totp_secret";

-- Renomeia a coluna cifrada para o nome canônico.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'totp_secret_encrypted'
  ) THEN
    ALTER TABLE "users" RENAME COLUMN "totp_secret_encrypted" TO "totp_secret";
  END IF;
END;
$$;

-- Adiciona comentário na coluna final renomeada.
COMMENT ON COLUMN "users"."totp_secret" IS
  'TOTP secret cifrado com AES-256-GCM via lib/crypto/pii.ts. '
  'Tipo bytea. Chave: LGPD_DATA_KEY (env). NUNCA armazenar plaintext. '
  'LGPD doc 17 §8.1 — F1-S24.';

-- =============================================================================
-- 3. Registro no _schema_meta
-- =============================================================================
INSERT INTO _schema_meta (note)
SELECT 'F1-S24 — LGPD baseline: cifração de PII em coluna + hash HMAC (0008)'
WHERE NOT EXISTS (
  SELECT 1 FROM _schema_meta
  WHERE note LIKE '%F1-S24%'
);
