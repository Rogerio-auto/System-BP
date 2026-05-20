-- =============================================================================
-- Migration 0030 — Parametrização de modelo em prompt_versions (F9-S08).
--
-- Adiciona 3 colunas opcionais de parâmetros LLM à tabela prompt_versions:
--   temperature   NUMERIC(4,2)  — controla aleatoriedade [0, 2]
--   max_tokens    INTEGER       — limite de tokens na resposta [1, 32000]
--   top_p         NUMERIC(4,3)  — nucleus sampling [0, 1]
--
-- Regras:
--   - Todas as colunas são NULLable. NULL = usar default do gateway (sem forçar).
--   - CHECKs valem apenas para valores não-nulos (IS NULL OR dentro do range).
--   - Imutabilidade: prompt_versions é append-only. Os campos são definidos
--     apenas na criação — sem PATCH posterior.
-- =============================================================================

ALTER TABLE prompt_versions
  ADD COLUMN IF NOT EXISTS temperature  NUMERIC(4,2)  NULL,
  ADD COLUMN IF NOT EXISTS max_tokens   INTEGER       NULL,
  ADD COLUMN IF NOT EXISTS top_p        NUMERIC(4,3)  NULL;

-- ---------------------------------------------------------------------------
-- Constraints CHECK (somente quando não-null — NULLs são válidos)
-- ---------------------------------------------------------------------------

ALTER TABLE prompt_versions
  ADD CONSTRAINT chk_prompt_versions_temperature
    CHECK (temperature IS NULL OR (temperature >= 0 AND temperature <= 2));

ALTER TABLE prompt_versions
  ADD CONSTRAINT chk_prompt_versions_max_tokens
    CHECK (max_tokens IS NULL OR (max_tokens >= 1 AND max_tokens <= 32000));

ALTER TABLE prompt_versions
  ADD CONSTRAINT chk_prompt_versions_top_p
    CHECK (top_p IS NULL OR (top_p >= 0 AND top_p <= 1));
