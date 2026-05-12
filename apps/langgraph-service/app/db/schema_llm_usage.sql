-- =============================================================================
-- Schema: LLM Usage Tracking
-- Slot: F3-S00 — LLM Gateway OpenRouter
-- =============================================================================
-- ATENÇÃO: Este arquivo é apenas o DDL de referência.
-- A migration real é executada pelo backend Node (apps/api) via Drizzle.
-- O serviço LangGraph NUNCA conecta diretamente ao Postgres.
-- =============================================================================

-- Registro granular de cada chamada ao LLM (auditoria + custo)
CREATE TABLE IF NOT EXISTS llm_usage_log (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID            NOT NULL,                   -- multi-tenant
    conversation_id UUID            NULL,                       -- FK lógica para conversations
    node            TEXT            NOT NULL,                   -- nome do nó LangGraph
    provider        TEXT            NOT NULL,                   -- 'openrouter' | 'anthropic'
    model           TEXT            NOT NULL,                   -- ex.: 'anthropic/claude-3.5-haiku'
    role            TEXT            NOT NULL,                   -- 'classifier' | 'reasoner' | 'fallback'
    prompt_tokens   INTEGER         NOT NULL DEFAULT 0,
    completion_tokens INTEGER       NOT NULL DEFAULT 0,
    total_tokens    INTEGER         NOT NULL DEFAULT 0,
    -- Custo estimado em micro-dólares (int evita ponto flutuante em SUM)
    -- 1 micro-dólar = 0.000001 USD
    cost_micro_usd  BIGINT          NOT NULL DEFAULT 0,
    latency_ms      INTEGER         NOT NULL DEFAULT 0,
    finish_reason   TEXT            NULL,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- Índices para relatórios de custo e auditoria
CREATE INDEX IF NOT EXISTS idx_llm_usage_log_org_created
    ON llm_usage_log (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_llm_usage_log_conversation
    ON llm_usage_log (conversation_id)
    WHERE conversation_id IS NOT NULL;

-- =============================================================================
-- Agregação diária por organização (usada por check_budget)
-- Atualizada por trigger ou job de consolidação (implementado no slot de billing)
-- =============================================================================
CREATE TABLE IF NOT EXISTS llm_usage_daily (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID            NOT NULL,
    usage_date      DATE            NOT NULL,                   -- data UTC
    total_tokens    BIGINT          NOT NULL DEFAULT 0,
    total_cost_micro_usd BIGINT     NOT NULL DEFAULT 0,
    call_count      INTEGER         NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT uq_llm_usage_daily_org_date
        UNIQUE (organization_id, usage_date)
);

CREATE INDEX IF NOT EXISTS idx_llm_usage_daily_org_date
    ON llm_usage_daily (organization_id, usage_date DESC);

-- =============================================================================
-- Limites de orçamento por organização
-- Lido por check_budget (slot de billing implementará a consulta real)
-- =============================================================================
CREATE TABLE IF NOT EXISTS llm_budget_config (
    organization_id     UUID        PRIMARY KEY,
    daily_budget_usd    NUMERIC(10,4) NOT NULL DEFAULT 20.0,   -- limite diário em USD
    alert_threshold     NUMERIC(5,4)  NOT NULL DEFAULT 0.8,    -- alerta em 80%
    hard_limit          BOOLEAN       NOT NULL DEFAULT TRUE,    -- bloquear ao atingir limite
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- =============================================================================
-- LGPD: nenhuma PII armazenada nestas tabelas.
-- Dados de conversa são referenciados por UUID opaco (conversation_id).
-- Conteúdo de mensagens NÃO é persistido aqui — apenas métricas de uso.
-- Retenção: conforme política da organização (ver docs/17-lgpd-protecao-dados.md).
-- =============================================================================
