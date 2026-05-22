-- =============================================================================
-- Migration 0038 — Seed de preço do Kimi K2 em model_pricing (F7-S01).
--
-- Contexto:
--   Kimi K2 (moonshot/kimi-k2) passa a ser o modelo default do reasoner
--   LangGraph a partir deste slot. Sem entry em model_pricing, o Console de
--   Decisões IA (F9-S06) não consegue calcular custo em USD/BRL das chamadas
--   que usam este modelo.
--
-- Fonte dos preços:
--   OpenRouter pricing page — snapshot 2026-05-22
--   URL: https://openrouter.ai/moonshot/kimi-k2
--   Input:  $0.14 / 1M tokens
--   Output: $0.56 / 1M tokens
--
-- Modelos Claude existentes não são desativados — fallback usa Claude Sonnet 4.
--
-- Idempotência:
--   ON CONFLICT DO NOTHING via unique partial index uq_model_pricing_active
--   (WHERE effective_to IS NULL). Reruns de migration não duplicam.
--
-- Sem PII:
--   Tabela de preços operacional pura. LGPD checklist não se aplica.
--
-- Dependências:
--   0026_model_pricing (tabela model_pricing + índice uq_model_pricing_active)
--   F9-S00 (schema da tabela já existe)
--
-- Gap 0032-0037: slots paralelos ativos em outras branches. O check-migrations
-- emite warning de gap mas não falha — comportamento documentado e esperado.
-- =============================================================================

INSERT INTO "model_pricing" (
  "id",
  "provider",
  "model_id",
  "input_cost_per_million_usd",
  "output_cost_per_million_usd",
  "effective_from",
  "effective_to",
  "notes",
  "created_by"
)
VALUES (
  gen_random_uuid(),
  'openrouter',
  'moonshot/kimi-k2',
  0.1400,   -- USD por 1M tokens de INPUT  (snapshot OpenRouter 2026-05-22)
  0.5600,   -- USD por 1M tokens de OUTPUT (snapshot OpenRouter 2026-05-22)
  now(),
  NULL,     -- ativo (sem data de encerramento)
  'Snapshot OpenRouter pricing page 2026-05-22 — moonshot/kimi-k2 default reasoner (F7-S01)',
  NULL      -- seed de sistema, sem usuário criador
)
ON CONFLICT DO NOTHING;
