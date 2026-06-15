-- =============================================================================
-- 0059_contracts.sql — Tabela contracts + FK em payment_dues + backfill
--
-- Contexto:
--   Antes deste slot, o vínculo entre parcelas e contratos era puramente textual
--   (payment_dues.contract_reference). Este slot cria a entidade contracts como
--   primeira classe e adiciona contract_id FK nullable em payment_dues para
--   ligar as parcelas ao contrato estruturado.
--
-- Estratégia de backfill:
--   Para cada (organization_id, contract_reference) distinto em payment_dues,
--   cria 1 contrato inferindo: soma das parcelas como principal_amount,
--   contagem como term_months, datas de vencimento min/max, e status derivado
--   do estado das parcelas. Idempotente via ON CONFLICT DO NOTHING.
--
-- Idempotência:
--   - CREATE TABLE IF NOT EXISTS
--   - ADD COLUMN IF NOT EXISTS
--   - Constraints de FK protegidas por DO $$ BEGIN ... EXCEPTION ... END $$
--   - INSERT ... ON CONFLICT DO NOTHING
--   - UPDATE ... WHERE contract_id IS NULL
--
-- Multi-tenant: organization_id presente desde o dia 1.
-- LGPD: nenhuma PII nesta tabela (contract_reference não contém CPF).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Parte 1 — Tabela contracts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "contracts" (
  "id"                    uuid          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,

  /**
   * Multi-tenant root. Toda tabela de domínio carrega organization_id.
   * FK ON DELETE RESTRICT: organização com contratos não pode ser excluída.
   */
  "organization_id"       uuid          NOT NULL,

  /**
   * Cliente titular do contrato. FK ON DELETE RESTRICT:
   * customer com contrato não pode ser excluído (registro contábil).
   */
  "customer_id"           uuid          NOT NULL,

  /**
   * Referência textual do contrato (ex: "BP-2026-00123", "2026/0045").
   * Chave de negócio importada do sistema legado do Banco do Povo.
   * UNIQUE per org: (organization_id, contract_reference).
   * Não é PII: não contém CPF nem dados biométricos.
   */
  "contract_reference"    text          NOT NULL,

  /**
   * Produto de crédito vinculado (nullable: contratos migrados do legado
   * podem não ter product_id até enriquecimento manual).
   * FK omitida nesta migration — credit_products existe mas o contrato
   * pode preexistir ao produto cadastrado (dados migrados).
   */
  "product_id"            uuid,

  /**
   * Versão de regra de crédito snapshot no momento da assinatura.
   * nullable: contratos do legado não têm rule_version associada.
   */
  "rule_version_id"       uuid,

  /**
   * Valor principal do contrato (capital emprestado) em reais.
   * numeric(14,2): precisão exata — nunca float para valores monetários.
   * Check: deve ser positivo.
   */
  "principal_amount"      numeric(14,2) NOT NULL,

  /**
   * Prazo do contrato em meses (número de parcelas previstas).
   * Check: deve ser positivo.
   */
  "term_months"           integer       NOT NULL,

  /**
   * Taxa mensal acordada no momento da assinatura (snapshot imutável).
   * numeric(8,6): precisão para taxas como 0,024500 = 2,45% a.m.
   * nullable: contratos migrados do legado podem não ter a taxa registrada.
   */
  "monthly_rate_snapshot" numeric(8,6),

  /**
   * Estado do contrato no ciclo de vida.
   * draft       → criado mas não assinado (rascunho).
   * signed      → assinado, aguardando liberação/desembolso.
   * active      → em andamento (parcelas abertas).
   * settled     → liquidado (todas as parcelas pagas).
   * defaulted   → inadimplente (cobrança judicial ou SPC).
   * cancelled   → cancelado antes do desembolso.
   * Check constraint garante apenas esses 6 valores.
   */
  "status"                text          NOT NULL DEFAULT 'draft',

  /**
   * Momento da assinatura do contrato pelo cliente.
   * null enquanto status = 'draft'. Imutável após preenchido (auditoria).
   */
  "signed_at"             timestamptz,

  /**
   * Data de vencimento da primeira parcela (dado desnormalizado do legado).
   * Armazenado para exibição rápida sem necessitar JOIN com payment_dues.
   */
  "first_due_date"        date,

  /**
   * Data de vencimento da última parcela (dado desnormalizado do legado).
   * Combinado com first_due_date permite calcular duração total visualmente.
   */
  "last_due_date"         date,

  "created_at"            timestamptz   NOT NULL DEFAULT now(),
  "updated_at"            timestamptz   NOT NULL DEFAULT now(),

  -- Status válido para o ciclo de vida do contrato.
  CONSTRAINT "chk_contracts_status" CHECK (
    status IN ('draft', 'signed', 'active', 'settled', 'defaulted', 'cancelled')
  ),

  -- Capital emprestado deve ser positivo.
  CONSTRAINT "chk_contracts_principal_positive" CHECK (principal_amount > 0),

  -- Prazo deve ser positivo (contrato de 0 meses não faz sentido).
  CONSTRAINT "chk_contracts_term_positive" CHECK (term_months > 0),

  -- Chave de negócio única por organização.
  CONSTRAINT "uq_contracts_org_reference" UNIQUE (organization_id, contract_reference)
);

-- FK: contracts → organizations (ON DELETE RESTRICT)
-- Organização com contratos não pode ser excluída — protege dados contábeis.
ALTER TABLE "contracts"
  ADD CONSTRAINT "fk_contracts_organization"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;

-- FK: contracts → customers (ON DELETE RESTRICT)
-- Customer com contratos não pode ser excluído — preserva histórico financeiro.
ALTER TABLE "contracts"
  ADD CONSTRAINT "fk_contracts_customer"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT;

-- Índice: listagem de contratos por cliente, mais recentes primeiro.
-- Suporta: ficha do cliente, histórico de contratos por pessoa.
CREATE INDEX IF NOT EXISTS "idx_contracts_customer"
  ON "contracts" ("customer_id", "created_at" DESC);

-- Índice: contratos por organização filtrados por status.
-- Suporta: dashboard de carteira, filtros de inadimplência, relatórios.
CREATE INDEX IF NOT EXISTS "idx_contracts_org_status"
  ON "contracts" ("organization_id", "status");

-- ---------------------------------------------------------------------------
-- Parte 2 — Coluna contract_id em payment_dues
-- ---------------------------------------------------------------------------

-- ADD COLUMN IF NOT EXISTS é idempotente (Postgres 9.6+).
ALTER TABLE "payment_dues"
  ADD COLUMN IF NOT EXISTS "contract_id" uuid;

-- FK: payment_dues.contract_id → contracts.id (ON DELETE SET NULL)
-- Parcela sobrevive à exclusão do contrato (auditoria fiscal).
-- Wrapped em DO $$ para idempotência — ADD CONSTRAINT não tem IF NOT EXISTS.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_payment_dues_contract'
      AND conrelid = 'payment_dues'::regclass
  ) THEN
    ALTER TABLE "payment_dues"
      ADD CONSTRAINT "fk_payment_dues_contract"
        FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Parte 3 — Backfill: criar 1 contrato por (organization_id, contract_reference)
--            e religar as parcelas ao contrato criado.
-- ---------------------------------------------------------------------------

-- Cria um contrato por (organization_id, contract_reference) distinto inferindo:
--   principal_amount = soma das parcelas do grupo
--   term_months      = contagem de parcelas do grupo
--   status           = 'settled' se todas pagas, 'active' caso contrário
--   signed_at        = created_at da parcela mais antiga do grupo (proxy)
--   first_due_date   = menor due_date do grupo
--   last_due_date    = maior due_date do grupo
--
-- DISTINCT ON + ORDER garante que a janela de agregação reflete o grupo inteiro.
-- ON CONFLICT DO NOTHING: re-execuções são seguras.
-- Em DB vazio (sem payment_dues): SELECT retorna zero linhas → INSERT é no-op.
INSERT INTO "contracts" (
  "organization_id",
  "customer_id",
  "contract_reference",
  "principal_amount",
  "term_months",
  "status",
  "signed_at",
  "first_due_date",
  "last_due_date"
)
SELECT DISTINCT ON (pd.organization_id, pd.contract_reference)
  pd.organization_id,
  pd.customer_id,
  pd.contract_reference,
  SUM(pd.amount) OVER (
    PARTITION BY pd.organization_id, pd.contract_reference
  ) AS principal_amount,
  COUNT(*) OVER (
    PARTITION BY pd.organization_id, pd.contract_reference
  )::integer AS term_months,
  CASE
    WHEN bool_or(pd.status IN ('pending', 'overdue')) OVER (
      PARTITION BY pd.organization_id, pd.contract_reference
    ) THEN 'active'
    WHEN bool_and(pd.status = 'paid') OVER (
      PARTITION BY pd.organization_id, pd.contract_reference
    ) THEN 'settled'
    ELSE 'active'
  END AS status,
  MIN(pd.created_at) OVER (
    PARTITION BY pd.organization_id, pd.contract_reference
  ) AS signed_at,
  MIN(pd.due_date) OVER (
    PARTITION BY pd.organization_id, pd.contract_reference
  ) AS first_due_date,
  MAX(pd.due_date) OVER (
    PARTITION BY pd.organization_id, pd.contract_reference
  ) AS last_due_date
FROM "payment_dues" pd
WHERE pd.contract_reference IS NOT NULL
ORDER BY pd.organization_id, pd.contract_reference, pd.created_at
ON CONFLICT (organization_id, contract_reference) DO NOTHING;

-- Religar as parcelas ao contrato recém-criado (ou já existente se re-executado).
-- WHERE contract_id IS NULL: idempotente — não sobrescreve vínculos já existentes.
UPDATE "payment_dues" pd
SET    "contract_id" = c.id
FROM   "contracts" c
WHERE  c.organization_id   = pd.organization_id
  AND  c.contract_reference = pd.contract_reference
  AND  pd.contract_id IS NULL;
