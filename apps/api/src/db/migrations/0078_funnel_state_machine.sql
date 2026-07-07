-- =============================================================================
-- 0078_funnel_state_machine.sql — Máquina de estados canônica do funil (F25-S01).
--
-- Alterações nesta migration:
--   1. Adiciona coluna `canonical_role` (text, nullable) em kanban_stages.
--      Define o papel semântico do stage no mapa de estados do agente de
--      crédito (doc 22 §3.3). Nullable para stages custom de orgs futuras.
--   2. Adiciona check constraint chk_kanban_stages_canonical_role para garantir
--      que valores presentes sejam do enum textual válido.
--   3. Cria índice idx_kanban_stages_org_canonical_role (organization_id, canonical_role)
--      para lookups de stage por papel canônico sem full-scan.
--   4. Backfill idempotente dos stages do Banco do Povo por orderIndex / flags
--      terminais (WHERE canonical_role IS NULL garante idempotência).
--   5. Adiciona coluna `actor_type` (text NOT NULL DEFAULT 'user') em audit_logs.
--      Necessário para rastreabilidade de decisões da IA (LGPD Art. 20, doc 22 §8.A).
--      Valores: 'user' | 'system' | 'ai'.
--   6. Adiciona check constraint chk_audit_logs_actor_type.
--
-- Dependências:
--   - 0000_init     (extensões pgcrypto, pg_trgm, unaccent, citext)
--   - 0009_kanban   (tabela kanban_stages)
--   - 0004_audit_logs (tabela audit_logs)
--
-- Idempotente:
--   ADD COLUMN IF NOT EXISTS; constraints via DO block (EXCEPTION duplicate_object);
--   CREATE INDEX IF NOT EXISTS; UPDATE ... WHERE canonical_role IS NULL.
--
-- Rollback manual (migrations mergeadas não devem ser revertidas — prefira
-- uma migration corretiva):
--   ALTER TABLE kanban_stages DROP COLUMN IF EXISTS canonical_role;
--   DROP INDEX IF EXISTS idx_kanban_stages_org_canonical_role;
--   ALTER TABLE audit_logs DROP COLUMN IF EXISTS actor_type;
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Coluna canonical_role em kanban_stages
--
-- Nullable: stages customizados de organizações futuras que não participam
-- do funil padrão do Banco do Povo ficam com NULL. A IA não age de forma
-- determinística sobre esses stages via mapa de estados canônico.
-- ---------------------------------------------------------------------------
ALTER TABLE kanban_stages
  ADD COLUMN IF NOT EXISTS canonical_role text;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Check constraint: valores válidos para canonical_role
--
-- Garante que qualquer app ou migration futura que escreva em canonical_role
-- use apenas os valores do enum textual canônico.
-- NULL é permitido (stages sem papel canônico definido).
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE kanban_stages
    ADD CONSTRAINT chk_kanban_stages_canonical_role
    CHECK (
      canonical_role IS NULL OR canonical_role IN (
        'pre_atendimento',
        'simulacao',
        'documentacao',
        'analise_credito',
        'concluido_ganho',
        'concluido_perdido'
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Índice (organization_id, canonical_role)
--
-- Workers de F25-S03 (e o agente) consultam: "qual é o stage_id de
-- 'simulacao' nesta organização?" — sem este índice seria um full-scan de
-- kanban_stages. Inclui NULLs, mas buscas sempre filtrarão por valor específico.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "idx_kanban_stages_org_canonical_role"
  ON kanban_stages USING btree (organization_id, canonical_role);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Backfill idempotente dos stages do Banco do Povo
--
-- Estratégia:
--   a. Stages terminais (is_terminal_won / is_terminal_lost) têm prioridade
--      sobre orderIndex — o paper semântico é inequívoco.
--   b. Stages não-terminais são mapeados por orderIndex (0-3).
--   c. WHERE canonical_role IS NULL garante idempotência: re-execução é no-op.
--
-- Nota: stages de outras orgs com orderIndex 0-3 também recebem o backfill.
-- Isso é correto: o pipeline padrão do sistema usa a mesma estrutura de
-- orderIndex. Orgs com pipelines radicalmente diferentes devem criar stages
-- com canonical_role = NULL ou ajustar manualmente após o deploy.
-- ---------------------------------------------------------------------------

-- 4a. Stages de desfecho positivo (won) → concluido_ganho
UPDATE kanban_stages
SET canonical_role = 'concluido_ganho'
WHERE is_terminal_won = true
  AND canonical_role IS NULL;
--> statement-breakpoint

-- 4b. Stages de desfecho negativo (lost) → concluido_perdido
UPDATE kanban_stages
SET canonical_role = 'concluido_perdido'
WHERE is_terminal_lost = true
  AND canonical_role IS NULL;
--> statement-breakpoint

-- 4c. Pré-atendimento (orderIndex 0, não-terminal)
UPDATE kanban_stages
SET canonical_role = 'pre_atendimento'
WHERE order_index = 0
  AND is_terminal_won  = false
  AND is_terminal_lost = false
  AND canonical_role IS NULL;
--> statement-breakpoint

-- 4d. Simulação (orderIndex 1, não-terminal)
UPDATE kanban_stages
SET canonical_role = 'simulacao'
WHERE order_index = 1
  AND is_terminal_won  = false
  AND is_terminal_lost = false
  AND canonical_role IS NULL;
--> statement-breakpoint

-- 4e. Documentação (orderIndex 2, não-terminal)
UPDATE kanban_stages
SET canonical_role = 'documentacao'
WHERE order_index = 2
  AND is_terminal_won  = false
  AND is_terminal_lost = false
  AND canonical_role IS NULL;
--> statement-breakpoint

-- 4f. Análise de crédito (orderIndex 3, não-terminal)
UPDATE kanban_stages
SET canonical_role = 'analise_credito'
WHERE order_index = 3
  AND is_terminal_won  = false
  AND is_terminal_lost = false
  AND canonical_role IS NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. Coluna actor_type em audit_logs
--
-- DEFAULT 'user' é conservador: todas as linhas existentes eram criadas
-- via requisições HTTP autenticadas (ações humanas). Linhas de workers/sistema
-- deveriam ser 'system', mas a distinção retroativa não é possível e não afeta
-- o compliance LGPD Art. 20 — o relevante é que novas entradas de IA usem 'ai'.
--
-- NOT NULL: toda entrada nova deve classificar explicitamente o ator.
-- O helper auditLog() em src/lib/audit.ts deve ser atualizado para aceitar
-- actor_type como parâmetro (F25-S03 ou slot subsequente).
-- ---------------------------------------------------------------------------
ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS actor_type text NOT NULL DEFAULT 'user';
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 6. Check constraint: valores válidos para actor_type
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE audit_logs
    ADD CONSTRAINT chk_audit_logs_actor_type
    CHECK (actor_type IN ('user', 'system', 'ai'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
