-- =============================================================================
-- 0025_totp_2fa.sql — Campos e tabela para 2FA/TOTP (F8-S11).
--
-- Alterações:
--   1. users.totp_confirmed_at  — quando o 2FA foi ativado (null = desativado).
--      users.totp_secret já existe (migration 0008) como bytea cifrado.
--
--   2. user_recovery_codes (tabela nova)
--      Armazena hashes bcrypt dos recovery codes gerados na ativação do 2FA.
--      Cada código é single-use: used_at marca o consumo (não deleta para auditoria).
--
-- Segurança (LGPD doc 17):
--   - totp_secret: cifrado em repouso via AES-256-GCM na service layer (já era).
--   - recovery codes: armazenados como hash bcrypt (nunca o plaintext).
--   - Nada de plaintext de TOTP persiste no banco.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Adicionar coluna totp_confirmed_at em users
-- ---------------------------------------------------------------------------

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS totp_confirmed_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- 2. Tabela user_recovery_codes
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_recovery_codes (
  id           UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID        NOT NULL,
  code_hash    TEXT        NOT NULL, -- bcrypt hash do código de 10 chars
  used_at      TIMESTAMPTZ,          -- null = disponível; não-null = consumido
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_recovery_codes_user
    FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE
);

-- Índice para busca rápida por usuário (listar + invalidar)
CREATE INDEX IF NOT EXISTS idx_recovery_codes_user_id
  ON user_recovery_codes(user_id);

-- ---------------------------------------------------------------------------
-- 3. Tabela totp_challenges (token de curta duração para o passo de 2FA)
--
--    O login com 2FA ativo NÃO emite access/refresh token direto.
--    Em vez disso, emite um challenge_token de curta duração (5 min) que
--    o frontend troca por uma sessão real via POST /api/auth/verify-2fa.
--    Isso evita sessão parcial e segue o mesmo padrão de "state machine"
--    presente em outros fluxos multi-passo.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS totp_challenges (
  id            UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID        NOT NULL,
  token_hash    TEXT        NOT NULL UNIQUE, -- HMAC-SHA256 hex do challenge token
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ,                 -- null = disponível; não-null = consumido
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_totp_challenge_user
    FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE
);

-- Índice para cleanup de challenges expirados
CREATE INDEX IF NOT EXISTS idx_totp_challenges_expires_at
  ON totp_challenges(expires_at);
