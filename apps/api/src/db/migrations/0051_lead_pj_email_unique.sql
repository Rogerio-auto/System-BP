-- no-transaction
-- =============================================================================
-- 0051_lead_pj_email_unique.sql — Colunas PJ (cnpj, legal_name) + índice único
--                                  parcial de email em leads (F14-S01).
--
-- Contexto: Épico A.2 do planejamento — Lead PJ.
-- Decisões travadas:
--   D1 — CNPJ em texto claro (não cifrado; diferente do CPF que usa bytea
--         + HMAC). Validação de formato CNPJ é feita na borda Zod, não no DB.
--   D2 — Email único por organização (ignora leads deletados/sem email).
--
-- Dependências:
--   - 0007_leads_core (tabela leads, coluna email citext, deleted_at)
--
-- Alterações:
--   1. ADD COLUMN cnpj text NULL
--      CNPJ da empresa em texto claro (D1). Formato: somente dígitos (14),
--      ou com pontuação — normalização e validação na camada de serviço (Zod).
--      NULL para leads PF ou leads sem CNPJ ainda preenchido.
--
--   2. ADD COLUMN legal_name text NULL
--      Razão social da empresa. NULL para leads PF.
--      PII leve (nome de empresa) — não há restrição LGPD específica para PJ,
--      mas logar com cuidado (pode revelar intenção de crédito empresarial).
--
--   3. CREATE UNIQUE INDEX CONCURRENTLY uq_leads_org_email_active
--      Índice único parcial em (organization_id, lower(email))
--      WHERE email IS NOT NULL AND deleted_at IS NULL.
--      - lower(email): garante case-insensitive mesmo que citext não o faça
--        de forma determinística em índices de expressão.
--      - Parcial: ignora leads sem email e leads soft-deletados.
--      - CONCURRENTLY: criação sem lock total de escrita.
--      Implementa D2: dois leads ativos na mesma org não podem ter o mesmo email.
--
-- LGPD (doc 17):
--   - cnpj: dado de empresa (pessoa jurídica), fora do escopo de §8 (dados
--     pessoais de pessoa física), mas tratado com cuidado em logs.
--   - legal_name: razão social (PJ); não expor em logs de produção sem context.
--   - email já era PII coberto pela política existente — nenhuma mudança na
--     política de redact; o índice novo não altera a semântica de armazenamento.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS; CREATE UNIQUE INDEX IF NOT EXISTS.
-- Rollback manual:
--   DROP INDEX IF EXISTS uq_leads_org_email_active;
--   ALTER TABLE leads DROP COLUMN IF EXISTS cnpj;
--   ALTER TABLE leads DROP COLUMN IF EXISTS legal_name;
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Coluna cnpj (texto claro — D1)
-- ---------------------------------------------------------------------------

ALTER TABLE leads ADD COLUMN IF NOT EXISTS cnpj text;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Coluna legal_name (razão social)
-- ---------------------------------------------------------------------------

ALTER TABLE leads ADD COLUMN IF NOT EXISTS legal_name text;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Índice único parcial de email por organização (D2)
--    CONCURRENTLY não pode rodar dentro de transação explícita.
--    O marker -- no-transaction no topo garante que o runner não envolva
--    os statements em BEGIN/COMMIT.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_leads_org_email_active
  ON leads (organization_id, lower(email::text))
  WHERE email IS NOT NULL AND deleted_at IS NULL;
