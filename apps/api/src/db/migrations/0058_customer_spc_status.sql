-- =============================================================================
-- 0058_customer_spc_status.sql — Ciclo de vida SPC na tabela `customers` (F15-S02).
--
-- Objetivo:
--   Adicionar status dedicado de SPC ao cliente (decisão D13), substituindo
--   o uso de metadata.spc_* como escape hatch. Status e data de mudança passam
--   a ser colunas tipadas, indexadas e auditáveis.
--
-- Ciclo de vida (spc_status):
--   none → pending_inclusion → included → removed
--   - none:              default. Cliente nunca negativado. spc_changed_at = NULL.
--   - pending_inclusion: operador solicitou inclusão; aguardando processamento.
--   - included:          consta negativado no SPC.
--   - removed:           retirado do SPC (pagamento, acordo ou erro cadastral).
--   Transições regressivas (ex: included → none) são bloqueadas na aplicação.
--
-- Colunas adicionadas:
--   spc_status    text NOT NULL DEFAULT 'none' com CHECK de domínio fechado.
--   spc_changed_at timestamptz nullable — data/hora da última transição de status.
--
-- Índices adicionados:
--   idx_customers_spc_none    — parcial WHERE spc_status = 'none'
--                               Suporta: relatório "nunca incluídos no SPC".
--   idx_customers_spc_pending — parcial WHERE spc_status = 'pending_inclusion'
--                               Suporta: fila de worker de inclusão SPC + alertas.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- Rollback manual:
--   ALTER TABLE customers DROP COLUMN IF EXISTS spc_changed_at;
--   ALTER TABLE customers DROP COLUMN IF EXISTS spc_status;
--   DROP INDEX IF EXISTS idx_customers_spc_pending;
--   DROP INDEX IF EXISTS idx_customers_spc_none;
-- =============================================================================

ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "spc_status" text NOT NULL DEFAULT 'none'
    CONSTRAINT chk_customers_spc_status CHECK (
      "spc_status" IN ('none', 'pending_inclusion', 'included', 'removed')
    );
--> statement-breakpoint

ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "spc_changed_at" timestamptz;
--> statement-breakpoint

-- Índice parcial: clientes sem histórico SPC.
-- NOTA: Drizzle não gera WHERE com valor literal — criado manualmente.
-- Parcial por seletividade: maioria dos clientes começa em 'none'; excluí-los
-- do índice principal mantém o índice menor e mais eficiente para buscas de
-- pending/included.
CREATE INDEX IF NOT EXISTS "idx_customers_spc_none"
  ON "customers" ("organization_id")
  WHERE "spc_status" = 'none';
--> statement-breakpoint

-- Índice parcial: fila de inclusão SPC pendente.
-- NOTA: Drizzle não gera WHERE com valor literal — criado manualmente.
-- Worker de SPC lê apenas estes registros; índice parcial reduz I/O.
CREATE INDEX IF NOT EXISTS "idx_customers_spc_pending"
  ON "customers" ("organization_id")
  WHERE "spc_status" = 'pending_inclusion';
