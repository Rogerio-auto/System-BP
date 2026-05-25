-- =============================================================================
-- 0040_used_totp_codes.sql — Tabela de controle de replay TOTP (F8-S11).
--
-- Contexto:
--   RFC 6238 permite que o mesmo código TOTP de 6 dígitos seja usado dentro
--   da janela de tolerância (±1 step = ±30s). Sem controle de replay, um
--   atacante que intercepta um código pode reutilizá-lo dentro da janela.
--
-- Solução:
--   Tabela `used_totp_codes` registra cada código TOTP consumido com sucesso.
--   Antes de aceitar um código, o serviço verifica se ele já foi usado nesta
--   janela. TTL de 90s (3 steps TOTP) cobre a janela de tolerância com margem.
--
-- Fluxo (auth/service.ts → lib/totp.ts):
--   1. Verificar código TOTP via verifyTotpCode() — válido criptograficamente.
--   2. Verificar ausência em used_totp_codes (anti-replay).
--   3. Inserir em used_totp_codes dentro da transação de autenticação.
--   4. Job de limpeza: DELETE WHERE used_at < now() - interval '90 seconds'.
--
-- LGPD (doc 17 §3.4, §8.12):
--   - code_hash: SHA-256 do código TOTP — não permite reconstrução (pseudônimo).
--   - user_id: referência ao usuário — dado de autenticação, não PII sensível.
--   - Retenção: 90s TTL — dados expiram quase imediatamente após uso.
--   - Não armazena o código em claro — apenas o hash (minimização de dados).
--
-- LGPD Checklist (§14.2):
--   [x] Finalidade: prevenção de ataques de replay em 2FA (segurança técnica).
--   [x] Base legal: segurança do tratamento (Art. 46 LGPD).
--   [x] Necessidade: colunas mínimas para o controle de replay.
--   [x] PII: code_hash é hash não-reversível; user_id é referência opaca.
--   [x] Retenção: 90s — eliminação automática por job ou TTL.
--
-- Rollback:
--   DROP TABLE IF EXISTS "used_totp_codes";
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Tabela: used_totp_codes — Registro de códigos TOTP já consumidos (anti-replay)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "used_totp_codes" (
    "id"          uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

    -- Usuário que utilizou o código. ON DELETE CASCADE: usuário deletado →
    -- registros de replay irrelevantes (conta inexistente não pode ser atacada).
    "user_id"     uuid        NOT NULL,

    -- SHA-256 do código TOTP de 6 dígitos.
    -- Não armazena o código em claro — apenas o hash para comparação.
    -- SHA-256 é suficiente para este caso: o input é de baixa entropia mas
    -- a janela de tempo é o fator dominante de segurança.
    "code_hash"   text        NOT NULL,

    -- Momento em que o código foi consumido. Usado pelo job de limpeza
    -- e pela verificação de validade dentro da janela TTL de 90s.
    "used_at"     timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- FK: used_totp_codes → users (CASCADE: usuário deletado limpa replay history)
DO $$ BEGIN
  ALTER TABLE "used_totp_codes"
    ADD CONSTRAINT "fk_used_totp_codes_user"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- UNIQUE: (user_id, code_hash) — previne inserção duplicada do mesmo código
-- na mesma janela (condição de corrida entre requisições paralelas).
-- O ON CONFLICT (user_id, code_hash) em código de produção usa esta constraint.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_used_totp_codes_user_code"
    ON "used_totp_codes" ("user_id", "code_hash");
--> statement-breakpoint

-- Índice de limpeza: job de expiração por used_at (TTL 90s).
-- Permite DELETE ... WHERE used_at < now() - interval '90 seconds' eficiente.
CREATE INDEX IF NOT EXISTS "idx_used_totp_codes_used_at"
    ON "used_totp_codes" ("used_at");
