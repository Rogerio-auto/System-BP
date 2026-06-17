-- =============================================================================
-- 0067_channel_id_jobs_rules.sql
--
-- Adiciona coluna channel_id (FK → channels, nullable, ON DELETE SET NULL) às
-- tabelas que disparam mensagens WhatsApp fora do livechat:
--   - followup_rules
--   - followup_jobs
--   - collection_rules
--   - collection_jobs
--   - credit_simulations
--
-- Requisito F20: permite vincular filas de envio a um canal/número específico.
-- Nullable = zero-downtime: todas as linhas existentes ficam com NULL (comportamento
-- legado mantido — worker usa canal default da org quando channel_id é NULL).
--
-- Índices parciais em followup_jobs e collection_jobs para queries por canal:
--   WHERE status = 'scheduled' — exclui estados terminais que crescem indefinidamente.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- followup_rules
-- ---------------------------------------------------------------------------
ALTER TABLE followup_rules
  ADD COLUMN channel_id uuid REFERENCES channels(id) ON DELETE SET NULL;

COMMENT ON COLUMN followup_rules.channel_id IS
  'Canal WhatsApp pelo qual os follow-ups desta regra devem ser enviados. '
  'NULL = sem canal fixo (usa canal default da org). '
  'ON DELETE SET NULL: canal excluído não quebra a regra.';

-- ---------------------------------------------------------------------------
-- followup_jobs
-- ---------------------------------------------------------------------------
ALTER TABLE followup_jobs
  ADD COLUMN channel_id uuid REFERENCES channels(id) ON DELETE SET NULL;

COMMENT ON COLUMN followup_jobs.channel_id IS
  'Canal WhatsApp pelo qual este job deve ser enviado. '
  'Herdado de followup_rules.channel_id no momento da criação. '
  'NULL = usa canal default da org no momento do envio. '
  'ON DELETE SET NULL: canal excluído não cancela o job.';

-- Índice parcial: jobs pendentes por canal (exclui estados terminais).
-- Drizzle não suporta WHERE parcial — definido manualmente aqui.
CREATE INDEX idx_followup_jobs_channel_scheduled
  ON followup_jobs (channel_id, scheduled_at)
  WHERE status = 'scheduled';

-- ---------------------------------------------------------------------------
-- collection_rules
-- ---------------------------------------------------------------------------
ALTER TABLE collection_rules
  ADD COLUMN channel_id uuid REFERENCES channels(id) ON DELETE SET NULL;

COMMENT ON COLUMN collection_rules.channel_id IS
  'Canal WhatsApp pelo qual as cobranças desta regra devem ser enviadas. '
  'NULL = sem canal fixo (usa canal default da org). '
  'ON DELETE SET NULL: canal excluído não quebra a regra.';

-- ---------------------------------------------------------------------------
-- collection_jobs
-- ---------------------------------------------------------------------------
ALTER TABLE collection_jobs
  ADD COLUMN channel_id uuid REFERENCES channels(id) ON DELETE SET NULL;

COMMENT ON COLUMN collection_jobs.channel_id IS
  'Canal WhatsApp pelo qual este job de cobrança deve ser enviado. '
  'Herdado de collection_rules.channel_id no momento da criação. '
  'NULL = usa canal default da org no momento do envio. '
  'ON DELETE SET NULL: canal excluído não cancela o job.';

-- Índice parcial: jobs de cobrança pendentes por canal (exclui estados terminais).
-- Drizzle não suporta WHERE parcial — definido manualmente aqui.
CREATE INDEX idx_collection_jobs_channel_scheduled
  ON collection_jobs (channel_id, scheduled_at)
  WHERE status = 'scheduled';

-- ---------------------------------------------------------------------------
-- credit_simulations
-- ---------------------------------------------------------------------------
ALTER TABLE credit_simulations
  ADD COLUMN channel_id uuid REFERENCES channels(id) ON DELETE SET NULL;

COMMENT ON COLUMN credit_simulations.channel_id IS
  'Canal WhatsApp pelo qual a simulação foi (ou será) enviada ao lead. '
  'NULL = enviada por canal legado (antes de F20) ou sem canal fixo. '
  'ON DELETE SET NULL: canal excluído não invalida o histórico de simulações.';
