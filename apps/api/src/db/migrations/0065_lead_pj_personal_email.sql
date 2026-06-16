-- no-transaction
-- =============================================================================
-- 0063_lead_pj_personal_email.sql — Consolidação F18-S08: campos PJ em leads
--                                    + personal_email em users.
--
-- Contexto:
--   Este slot foi planejado para adicionar os campos PJ (cnpj, legal_name) em
--   leads, o índice de unicidade de email por org e personal_email em users.
--   Contudo, esses objetos foram antecipados em migrations anteriores:
--     - 0051_lead_pj_email_unique.sql: cnpj, legal_name, uq_leads_org_email_active
--     - 0055_user_personal_email.sql: personal_email, uq_users_org_personal_email_active
--
--   Esta migration é idempotente (IF NOT EXISTS em todas as operações).
--   Em um DB limpo que nunca rodou 0051/0055, cria os objetos do zero.
--   Em um DB existente, é no-op completo (sem efeito colateral).
--
-- Objetos gerenciados:
--   leads.cnpj             TEXT NULL — CNPJ da empresa (lead PJ, D1 F14-S01)
--   leads.legal_name       TEXT NULL — Razão social (lead PJ)
--   uq_leads_org_email_active — Unique parcial (org, lower(email)) WHERE email IS NOT NULL
--                                AND deleted_at IS NULL (D2 F14-S01)
--   users.personal_email   CITEXT NULL — Email pessoal do agente (F14-S04 D3)
--   uq_users_org_personal_email_active — Unique parcial (org, personal_email)
--                                         WHERE deleted_at IS NULL AND personal_email IS NOT NULL
--
-- LGPD (doc 17):
--   - cnpj/legal_name: dados de PJ (LGPD art. 5 I — fora do escopo de dados
--     pessoais de PF), mas tratados com cuidado em logs de produção.
--   - personal_email: PII do agente — coberto por pino.redact (app.ts).
--     Nunca logar sem redact. Titular pode solicitar eliminação (direito LGPD art. 18 VI).
--
-- Idempotente: ADD COLUMN IF NOT EXISTS; CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS.
-- Rollback manual (apenas se necessário em ambiente de dev):
--   DROP INDEX IF EXISTS uq_leads_org_email_active;
--   DROP INDEX IF EXISTS uq_users_org_personal_email_active;
--   ALTER TABLE leads DROP COLUMN IF EXISTS cnpj;
--   ALTER TABLE leads DROP COLUMN IF EXISTS legal_name;
--   ALTER TABLE users DROP COLUMN IF EXISTS personal_email;
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. leads.cnpj — CNPJ em texto claro (D1: validação na borda Zod, não no DB)
-- ---------------------------------------------------------------------------

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS cnpj text;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. leads.legal_name — Razão social da empresa (lead PJ)
-- ---------------------------------------------------------------------------

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS legal_name text;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Índice único parcial de email por organização (D2)
--    lower(email::text) garante case-insensitive determinístico em expressão.
--    Parcial: ignora leads sem email e leads soft-deletados.
--    CONCURRENTLY: sem lock total de escrita em produção.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_leads_org_email_active
  ON leads (organization_id, lower(email::text))
  WHERE email IS NOT NULL AND deleted_at IS NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. users.personal_email — Email pessoal do agente (citext, nullable)
--    Cobrado no 1º login quando NULL. Adicionado à blocklist de lead-email.
--    LGPD: PII — pino.redact + nunca logar.
-- ---------------------------------------------------------------------------

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS personal_email citext;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. Índice único parcial (org, personal_email) para registros não deletados.
--    Evita dois agentes da mesma org com o mesmo email pessoal.
--    WHERE conditions garantem que NULLs e registros deletados sejam excluídos.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_users_org_personal_email_active
  ON users (organization_id, personal_email)
  WHERE deleted_at IS NULL AND personal_email IS NOT NULL;
