-- =============================================================================
-- 0026_model_pricing.sql — Tabela de preços por modelo LLM (USD) + suporte FX
--
-- Contexto: F9-S00 — Pricing layer para o Console de decisões IA (F9-S06).
-- Sem esta tabela o Console exibe apenas tokens crus, sem custo.
--
-- Modelo de dados:
--   Cada linha representa o preço vigente de um (provider, model_id).
--   Apenas 1 linha ativa por (provider, model_id) em um dado instante:
--   garantido pelo unique partial index uq_model_pricing_active.
--
--   Histórico de preços: ao mudar o preço, fechar o registro antigo
--   (effective_to = now()) e inserir novo com effective_from = now().
--
-- Conversão BRL:
--   NÃO persiste BRL na tabela — FX oscila diariamente.
--   A taxa FX_BRL_PER_USD é lida do env no momento do cálculo (F9-S02).
--   Preço em USD é a verdade canônica.
--
-- Sem PII:
--   Tabela operacional pura. Nenhuma coluna contém dado pessoal.
--   LGPD checklist não se aplica — cf. doc 17 §2 (finalidade analítica).
--
-- Dependências:
--   0000_init  (gen_random_uuid, pgcrypto)
--   0001_bent_mac_gargan (users — FK created_by)
--
-- PROTOCOL.md §3: journal sincronizado no mesmo commit.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tabela model_pricing
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "model_pricing" (
  "id"                          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Provider do modelo LLM (ex: 'openrouter', 'anthropic', 'openai').
  -- Corresponde ao roteamento do gateway em langgraph-service/app/llm/factory.py.
  "provider"                    TEXT        NOT NULL,

  -- Identificador canônico do modelo no formato provider/model.
  -- Deve corresponder EXATAMENTE ao valor gravado em ai_decision_logs.model.
  -- Exemplos: 'anthropic/claude-3.5-haiku', 'openai/gpt-4o-mini', 'anthropic/claude-sonnet-4'.
  "model_id"                    TEXT        NOT NULL,

  -- Custo por 1.000.000 tokens de INPUT em USD.
  -- Fonte: pricing page do provider (snapshot datado em notes).
  -- Precisão numeric(12,4): máximo USD 99.999.999,9999 — suficiente para qualquer modelo atual.
  "input_cost_per_million_usd"  NUMERIC(12,4) NOT NULL,

  -- Custo por 1.000.000 tokens de OUTPUT em USD.
  -- Output tokens geralmente custam 3–5x mais que input.
  "output_cost_per_million_usd" NUMERIC(12,4) NOT NULL,

  -- Início da vigência deste preço. default now() = inserção = imediato.
  -- Permite pré-agendar trocas de preço (effective_from no futuro).
  "effective_from"              TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Fim da vigência. NULL = preço atualmente em vigor.
  -- Ao mudar o preço: UPDATE effective_to = now() + INSERT novo registro.
  -- Constraint abaixo garante effective_to > effective_from.
  "effective_to"                TIMESTAMPTZ,

  -- Changelog livre: fonte do preço, data do snapshot, notas de mudança.
  -- Exemplos: 'snapshot OpenRouter pricing page 2026-05-19', 'revisao anual'.
  "notes"                       TEXT,

  -- Usuário que cadastrou ou atualizou o preço.
  -- ON DELETE SET NULL: usuário deletado não perde o histórico de preços.
  "created_by"                  UUID,

  "created_at"                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"                  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- -------------------------------------------------------------------------
  -- CHECK constraints
  -- -------------------------------------------------------------------------

  -- Garante que effective_to, quando definido, é posterior a effective_from.
  -- Impede registros com janela de vigência invertida.
  CONSTRAINT chk_model_pricing_effective_range
    CHECK (effective_to IS NULL OR effective_to > effective_from),

  -- Custos nunca negativos. Modelos gratuitos entram como 0.
  CONSTRAINT chk_model_pricing_costs_non_negative
    CHECK (
      input_cost_per_million_usd  >= 0
      AND output_cost_per_million_usd >= 0
    )
);

-- ---------------------------------------------------------------------------
-- 2. Foreign key: created_by → users
-- ---------------------------------------------------------------------------
ALTER TABLE "model_pricing"
  ADD CONSTRAINT "fk_model_pricing_created_by"
    FOREIGN KEY ("created_by")
    REFERENCES "users" ("id")
    ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 3. Unique partial index: 1 preço ativo por (provider, model_id)
--
--    WHERE effective_to IS NULL garante que registros históricos (fechados)
--    não participam da constraint — permite múltiplos registros fechados
--    para o mesmo (provider, model_id) sem conflito.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "uq_model_pricing_active"
  ON "model_pricing" ("provider", "model_id")
  WHERE "effective_to" IS NULL;

-- ---------------------------------------------------------------------------
-- 4. Índices de suporte
-- ---------------------------------------------------------------------------

-- Busca por modelo específico (F9-S02 consulta o preço ativo por model_id).
CREATE INDEX "idx_model_pricing_model_id"
  ON "model_pricing" ("model_id");

-- Histórico de preços de um provider (admin view).
CREATE INDEX "idx_model_pricing_provider_from"
  ON "model_pricing" ("provider", "effective_from" DESC);

-- ---------------------------------------------------------------------------
-- 5. Trigger updated_at (padrão do projeto)
-- ---------------------------------------------------------------------------
-- Reutiliza a função set_updated_at() criada em 0000_init.
-- Se a função ainda não existir no schema (ambiente de teste isolado),
-- criamos aqui de forma idempotente.
CREATE OR REPLACE FUNCTION set_updated_at()
  RETURNS TRIGGER LANGUAGE plpgsql AS
$$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_model_pricing_updated_at"
  BEFORE UPDATE ON "model_pricing"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
