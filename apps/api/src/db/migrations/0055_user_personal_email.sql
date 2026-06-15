-- =============================================================================
-- 0055_user_personal_email.sql
--
-- Adiciona a coluna `personal_email` (citext, nullable) na tabela `users`.
--
-- Objetivo (F14-S04 D3):
--   No primeiro login, o sistema cobra do agente o cadastro do email pessoal.
--   Esse email é adicionado à lista de bloqueio no cadastro de lead, evitando
--   que o agente use o próprio email no lugar do email do cliente.
--
-- Decisões de schema:
--   - citext: comparação case-insensitive sem normalização na aplicação.
--   - nullable: agentes existentes não têm o campo preenchido — o fluxo de
--     primeiro login detecta NULL e cobra o preenchimento (requires_personal_email).
--   - Sem unique global: o mesmo email pessoal pode existir em orgs diferentes.
--   - Unique parcial (org + personal_email) apenas para registros não deletados:
--     evita dois agentes da mesma org cadastrarem o mesmo email pessoal
--     (o que tornaria o bloqueio de lead ambíguo e dificulta o direito de
--     eliminação LGPD por titular).
--
-- LGPD (doc 17 §8.1):
--   personal_email é PII — coberto por pino.redact (app.ts) e nunca logado.
-- =============================================================================

ALTER TABLE users
  ADD COLUMN personal_email citext NULL;

-- Índice parcial unique: (org, personal_email) para registros não deletados.
-- WHERE personal_email IS NOT NULL: evita conflito para usuários sem o campo preenchido.
CREATE UNIQUE INDEX uq_users_org_personal_email_active
  ON users (organization_id, personal_email)
  WHERE deleted_at IS NULL AND personal_email IS NOT NULL;
