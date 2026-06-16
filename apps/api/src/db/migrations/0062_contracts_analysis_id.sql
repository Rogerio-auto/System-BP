-- =============================================================================
-- 0061_contracts_analysis_id.sql — Rastreio de análise de crédito em contracts
--
-- Contexto (F17-S12):
--   Adiciona `analysis_id` nullable à tabela `contracts` para vincular um contrato
--   à análise de crédito que o originou. Permite rastrear o ciclo completo
--   análise → aprovação → contrato e viabiliza sincronização automática de status.
--
-- Regra de negócio:
--   - nullable: contratos migrados do legado (0059_contracts.sql) não possuem
--     análise associada e não devem ser bloqueados retroativamente.
--   - ON DELETE SET NULL: a exclusão de uma análise não destrói o contrato.
--     O vínculo é informativo; o contrato permanece como registro contábil.
--   - Unique parcial (WHERE analysis_id IS NOT NULL): uma análise gera no máximo
--     um contrato por organização. Protege contra duplicidade silenciosa em
--     automações que ligam análise → contrato.
--
-- Idempotência:
--   - ADD COLUMN IF NOT EXISTS (Postgres 9.6+).
--   - FK protegida por DO $$ com verificação em pg_constraint.
--   - CREATE UNIQUE INDEX IF NOT EXISTS com WHERE clause (partial unique).
--
-- Multi-tenant: organization_id já presente desde 0059_contracts.sql.
-- LGPD: analysis_id é apenas FK de referência; PII está em credit_analyses,
--       já protegida. Sem novo tratamento de dados pessoais nesta migration.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Parte 1 — Adicionar coluna analysis_id (nullable UUID)
-- ---------------------------------------------------------------------------

-- ADD COLUMN IF NOT EXISTS é idempotente: re-execuções são seguras.
ALTER TABLE "contracts"
  ADD COLUMN IF NOT EXISTS "analysis_id" uuid;

-- ---------------------------------------------------------------------------
-- Parte 2 — FK: contracts.analysis_id → credit_analyses.id ON DELETE SET NULL
-- ---------------------------------------------------------------------------

-- Wrapped em DO $$ para idempotência — ADD CONSTRAINT não tem IF NOT EXISTS.
-- ON DELETE SET NULL: exclusão da análise não exclui o contrato (registro contábil).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_contracts_analysis'
      AND conrelid = 'contracts'::regclass
  ) THEN
    ALTER TABLE "contracts"
      ADD CONSTRAINT "fk_contracts_analysis"
        FOREIGN KEY ("analysis_id") REFERENCES "credit_analyses"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Parte 3 — Índice único parcial: 1 contrato por análise por organização
-- ---------------------------------------------------------------------------

-- Partial unique index: somente quando analysis_id IS NOT NULL.
-- Garante que a mesma análise não gere dois contratos na mesma organização,
-- sem bloquear os múltiplos contratos sem análise (legado migrado).
-- IF NOT EXISTS: idempotente em re-execuções.
CREATE UNIQUE INDEX IF NOT EXISTS "contracts_org_analysis_unique"
  ON "contracts" ("organization_id", "analysis_id")
  WHERE "analysis_id" IS NOT NULL;
