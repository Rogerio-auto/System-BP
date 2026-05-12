-- =============================================================================
-- 0010_data_subject.sql — LGPD direitos do titular + retenção.
--
-- Contexto: F1-S25.
-- Dependências: 0000_init, 0001_bent_mac_gargan (users), 0007_leads_core,
--               0008_lgpd_pii_crypto (customers), 0009_kanban.
--
-- Objetivo (doc 17 §5, §6):
--   1. Criar tabela data_subject_requests para registrar solicitações de
--      direitos do titular (Art. 18 LGPD).
--   2. Criar tabela retention_runs para auditoria das rodadas do cron de retenção.
--   3. Adicionar colunas consent_revoked_at e anonymized_at em customers.
--   4. Adicionar coluna anonymized_at em leads.
--
-- Sem rollback automático: dados de solicitações LGPD não devem ser descartados.
-- Para rollback, executar manualmente com autorização do DPO.
--
-- LGPD (doc 17 §5, §6, §14.2):
--   - data_subject_requests: payload_meta sem PII bruta — apenas metadata.
--   - Índice em document_hash apenas WHERE NOT NULL (casos órfãos).
--   - request_id: idempotência por requisição do cliente.
-- =============================================================================

-- =============================================================================
-- 1. data_subject_requests
-- =============================================================================

CREATE TABLE IF NOT EXISTS "data_subject_requests" (
  "id"               uuid         NOT NULL DEFAULT gen_random_uuid(),
  "organization_id"  uuid         NOT NULL,
  "customer_id"      uuid,
  "document_hash"    text,
  "request_id"       text         NOT NULL,
  "type"             text         NOT NULL,
  "status"           text         NOT NULL DEFAULT 'received',
  "requested_at"     timestamptz  NOT NULL DEFAULT now(),
  "fulfilled_at"     timestamptz,
  "fulfilled_by"     uuid,
  "channel"          text         NOT NULL,
  "payload_meta"     jsonb        NOT NULL DEFAULT '{}',
  "analysis_id"      uuid,
  "created_at"       timestamptz  NOT NULL DEFAULT now(),
  "updated_at"       timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT "data_subject_requests_pkey" PRIMARY KEY ("id"),

  CONSTRAINT "data_subject_requests_type_check" CHECK (
    "type" IN (
      'confirmation',
      'access',
      'portability',
      'consent_revoke',
      'anonymize',
      'deletion',
      'review_decision'
    )
  ),

  CONSTRAINT "data_subject_requests_status_check" CHECK (
    "status" IN (
      'received',
      'in_progress',
      'fulfilled',
      'rejected',
      'pending_dpo_review'
    )
  ),

  CONSTRAINT "data_subject_requests_channel_check" CHECK (
    "channel" IN ('whatsapp', 'email')
  ),

  CONSTRAINT "uq_data_subject_requests_request_id" UNIQUE ("request_id"),

  CONSTRAINT "fk_data_subject_requests_org"
    FOREIGN KEY ("organization_id")
    REFERENCES "organizations" ("id")
    ON DELETE RESTRICT,

  CONSTRAINT "fk_data_subject_requests_customer"
    FOREIGN KEY ("customer_id")
    REFERENCES "customers" ("id")
    ON DELETE SET NULL,

  CONSTRAINT "fk_data_subject_requests_fulfilled_by"
    FOREIGN KEY ("fulfilled_by")
    REFERENCES "users" ("id")
    ON DELETE SET NULL
);

COMMENT ON TABLE "data_subject_requests" IS
  'Solicitações de direitos do titular (Art. 18 LGPD). F1-S25. '
  'Append-on-update: status transitions auditadas via audit_logs. '
  'payload_meta: apenas metadata sem PII bruta (doc 17 §8.5).';

COMMENT ON COLUMN "data_subject_requests"."document_hash" IS
  'HMAC-SHA256 do documento do titular — para casos órfãos (sem customer_id). '
  'NUNCA armazenar CPF em claro. Doc 17 §8.1.';

COMMENT ON COLUMN "data_subject_requests"."payload_meta" IS
  'Metadata da solicitação sem PII bruta. '
  'Exemplos: { channel_verified, otp_verified_at, request_source }. '
  'LGPD doc 17 §8.5 — nunca incluir CPF, email, telefone em claro.';

-- Índices para data_subject_requests
CREATE INDEX IF NOT EXISTS "idx_dsr_customer_created"
  ON "data_subject_requests" ("customer_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_dsr_org_status_created"
  ON "data_subject_requests" ("organization_id", "status", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_dsr_document_hash"
  ON "data_subject_requests" ("document_hash")
  WHERE "document_hash" IS NOT NULL;

-- =============================================================================
-- 2. retention_runs — log de execuções do cron de retenção (doc 17 §6.1)
-- =============================================================================

CREATE TABLE IF NOT EXISTS "retention_runs" (
  "id"              uuid        NOT NULL DEFAULT gen_random_uuid(),
  "started_at"      timestamptz NOT NULL DEFAULT now(),
  "ended_at"        timestamptz,
  "affected_counts" jsonb       NOT NULL DEFAULT '{}',
  "errors"          jsonb       NOT NULL DEFAULT '[]',

  CONSTRAINT "retention_runs_pkey" PRIMARY KEY ("id")
);

COMMENT ON TABLE "retention_runs" IS
  'Auditoria das rodadas do job de retenção LGPD (cron-retention). '
  'affected_counts: { leads_anonymized, customers_anonymized, interactions_deleted, sessions_deleted }. '
  'errors: array de { entity_id, error_message } para falhas parciais. '
  'Doc 17 §6.1 — F1-S25.';

-- =============================================================================
-- 3. customers — adicionar consent_revoked_at e anonymized_at
-- =============================================================================

ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "consent_revoked_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "anonymized_at"      timestamptz;

COMMENT ON COLUMN "customers"."consent_revoked_at" IS
  'Timestamp da revogação de consentimento pelo titular (Art. 8 §5 LGPD). '
  'NULL = consentimento ativo. '
  'Após revogação: base legal para tratamento é eliminada para dados de consentimento. '
  'Doc 17 §5.2 — F1-S25.';

COMMENT ON COLUMN "customers"."anonymized_at" IS
  'Timestamp em que os dados PII foram anonimizados (Art. 5 XI LGPD). '
  'NULL = dados ativos. '
  'Após anonimização: PK e FKs intactas, mas nome/doc/contato substituídos por tokens. '
  'Doc 17 §6.2 — F1-S25.';

-- =============================================================================
-- 4. leads — adicionar anonymized_at
-- =============================================================================

ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "anonymized_at" timestamptz;

COMMENT ON COLUMN "leads"."anonymized_at" IS
  'Timestamp em que os dados PII do lead foram anonimizados. '
  'NULL = dados ativos. '
  'Doc 17 §6.1 — F1-S25.';

-- =============================================================================
-- 5. Registro no _schema_meta
-- =============================================================================
INSERT INTO _schema_meta (note)
SELECT 'F1-S25 — LGPD direitos do titular + jobs de retenção (0010)'
WHERE NOT EXISTS (
  SELECT 1 FROM _schema_meta
  WHERE note LIKE '%F1-S25%'
);
