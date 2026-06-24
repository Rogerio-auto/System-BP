-- =============================================================================
-- 0071_reports_materialized_views.sql (F23-S01)
-- Views Materializadas para /relatorios.
-- LGPD doc 17 par 3.3 finalidade 8: Zero PII, apenas agregados.
-- REFRESH CONCURRENTLY: cada MV tem CREATE UNIQUE INDEX obrigatorio.
-- Multi-tenant: organization_id em toda MV (CLAUDE.md par 8).
-- =============================================================================

-- MV 1 -- mv_reports_overview: KPIs de leads/conversas/simulacoes/contratos por org/city/dia
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_reports_overview AS
SELECT
    l.organization_id,
    l.city_id,
    date_trunc('day', l.created_at AT TIME ZONE 'UTC')::date AS day,
    COUNT(l.id) AS total_leads,
    COUNT(l.id) FILTER (WHERE l.status = 'new') AS leads_new,
    COUNT(l.id) FILTER (WHERE l.status = 'qualifying') AS leads_qualifying,
    COUNT(l.id) FILTER (WHERE l.status = 'simulation') AS leads_simulation,
    COUNT(l.id) FILTER (WHERE l.status = 'closed_won') AS leads_closed_won,
    COUNT(l.id) FILTER (WHERE l.status = 'closed_lost') AS leads_closed_lost,
    COUNT(l.id) FILTER (WHERE l.status = 'archived') AS leads_archived,
    COUNT(DISTINCT c.id) AS total_conversations,
    COUNT(DISTINCT c.id) FILTER (WHERE c.status = 'open') AS conversations_open,
    COUNT(DISTINCT c.id) FILTER (WHERE c.status = 'resolved') AS conversations_resolved,
    COUNT(DISTINCT cs.id) AS total_simulations,
    COALESCE(SUM(cs.amount_requested), 0) AS simulations_amount_sum,
    COALESCE(AVG(cs.amount_requested), 0) AS simulations_amount_avg,
    COUNT(DISTINCT ct.id) AS total_contracts,
    COUNT(DISTINCT ct.id) FILTER (WHERE ct.status = 'active') AS contracts_active,
    COUNT(DISTINCT ct.id) FILTER (WHERE ct.status = 'settled') AS contracts_settled,
    COUNT(DISTINCT ct.id) FILTER (WHERE ct.status = 'defaulted') AS contracts_defaulted,
    COALESCE(SUM(ct.principal_amount), 0) AS contracts_amount_sum
FROM leads l
LEFT JOIN conversations c ON c.organization_id = l.organization_id AND c.lead_id = l.id AND c.deleted_at IS NULL
LEFT JOIN credit_simulations cs ON cs.organization_id = l.organization_id AND cs.lead_id = l.id
LEFT JOIN customers cu ON cu.organization_id = l.organization_id AND cu.primary_lead_id = l.id
LEFT JOIN contracts ct ON ct.organization_id = l.organization_id AND ct.customer_id = cu.id
WHERE l.deleted_at IS NULL
GROUP BY l.organization_id, l.city_id, date_trunc('day', l.created_at AT TIME ZONE 'UTC')::date
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_reports_overview ON mv_reports_overview (organization_id, day, (COALESCE(city_id::text, '__null__')));

-- MV 2 -- mv_reports_funnel: snapshot de leads por estagio do kanban por org/city
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_reports_funnel AS
SELECT kc.organization_id, l.city_id, ks.id AS stage_id, ks.name AS stage_name, ks.order_index AS stage_order,
    COUNT(kc.id) AS card_count,
    COUNT(kc.id) FILTER (WHERE kc.entered_stage_at < (now() - INTERVAL '7 days')) AS stale_card_count
FROM kanban_cards kc
JOIN kanban_stages ks ON ks.id = kc.stage_id
JOIN leads l ON l.id = kc.lead_id AND l.deleted_at IS NULL
GROUP BY kc.organization_id, l.city_id, ks.id, ks.name, ks.order_index
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_reports_funnel ON mv_reports_funnel (organization_id, stage_id, (COALESCE(city_id::text, '__null__')));

-- MV 3 -- mv_reports_stage_dwell: tempo medio por estagio (LAG window function)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_reports_stage_dwell AS
WITH transitions_with_prev AS (
    SELECT ksh.card_id, ksh.to_stage_id AS stage_id, ksh.transitioned_at,
        LAG(ksh.transitioned_at) OVER (PARTITION BY ksh.card_id ORDER BY ksh.transitioned_at) AS prev_transitioned_at,
        kc.organization_id, l.city_id
    FROM kanban_stage_history ksh
    JOIN kanban_cards kc ON kc.id = ksh.card_id
    JOIN leads l ON l.id = kc.lead_id AND l.deleted_at IS NULL
),
dwell_times AS (
    SELECT organization_id, city_id, stage_id,
        EXTRACT(EPOCH FROM (transitioned_at - prev_transitioned_at)) / 3600.0 AS dwell_hours
    FROM transitions_with_prev WHERE prev_transitioned_at IS NOT NULL AND transitioned_at > prev_transitioned_at
)
SELECT dt.organization_id, dt.city_id, dt.stage_id, ks.name AS stage_name, ks.order_index AS stage_order,
    COUNT(*) AS transition_count, AVG(dt.dwell_hours) AS avg_dwell_hours,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY dt.dwell_hours) AS median_dwell_hours,
    MIN(dt.dwell_hours) AS min_dwell_hours, MAX(dt.dwell_hours) AS max_dwell_hours
FROM dwell_times dt JOIN kanban_stages ks ON ks.id = dt.stage_id
GROUP BY dt.organization_id, dt.city_id, dt.stage_id, ks.name, ks.order_index
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_reports_stage_dwell ON mv_reports_stage_dwell (organization_id, stage_id, (COALESCE(city_id::text, '__null__')));

-- MV 4 -- mv_reports_credit: simulacoes/analises/contratos por org/city/produto (UNION ALL)
-- city_id contratos: contracts -> customers.primary_lead_id -> leads.city_id
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_reports_credit AS
SELECT organization_id, city_id, product_id,
    COUNT(DISTINCT sim_id) AS simulations_count,
    COALESCE(SUM(amount_requested), 0) AS simulations_amount_sum,
    COALESCE(AVG(amount_requested), 0) AS simulations_amount_avg,
    COALESCE(AVG(term_months_val::numeric), 0) AS simulations_term_avg,
    COUNT(DISTINCT analysis_id) AS analyses_count,
    COUNT(DISTINCT analysis_id) FILTER (WHERE analysis_status = 'aprovado') AS analyses_approved,
    COUNT(DISTINCT analysis_id) FILTER (WHERE analysis_status = 'recusado') AS analyses_refused,
    COUNT(DISTINCT analysis_id) FILTER (WHERE analysis_status = 'em_analise') AS analyses_in_progress,
    COALESCE(AVG(approved_amount) FILTER (WHERE approved_amount IS NOT NULL), 0) AS analyses_approved_amount_avg,
    COUNT(DISTINCT contract_id) AS contracts_count,
    COUNT(DISTINCT contract_id) FILTER (WHERE contract_status = 'active') AS contracts_active,
    COUNT(DISTINCT contract_id) FILTER (WHERE contract_status = 'settled') AS contracts_settled,
    COUNT(DISTINCT contract_id) FILTER (WHERE contract_status = 'defaulted') AS contracts_defaulted,
    COALESCE(SUM(principal_amount), 0) AS contracts_principal_sum
FROM (
    SELECT cs.organization_id, l.city_id, cs.product_id, cs.id AS sim_id, cs.amount_requested, cs.term_months AS term_months_val,
        NULL::uuid AS analysis_id, NULL::text AS analysis_status, NULL::numeric AS approved_amount,
        NULL::uuid AS contract_id, NULL::text AS contract_status, NULL::numeric AS principal_amount
    FROM credit_simulations cs JOIN leads l ON l.id = cs.lead_id AND l.deleted_at IS NULL
    UNION ALL
    SELECT ca.organization_id, l.city_id, NULL::uuid AS product_id, NULL::uuid AS sim_id, NULL::numeric AS amount_requested, NULL::integer AS term_months_val,
        ca.id AS analysis_id, ca.status AS analysis_status, ca.approved_amount,
        NULL::uuid AS contract_id, NULL::text AS contract_status, NULL::numeric AS principal_amount
    FROM credit_analyses ca JOIN leads l ON l.id = ca.lead_id AND l.deleted_at IS NULL
    UNION ALL
    SELECT ct.organization_id, l.city_id, NULL::uuid AS product_id, NULL::uuid AS sim_id, NULL::numeric AS amount_requested, NULL::integer AS term_months_val,
        NULL::uuid AS analysis_id, NULL::text AS analysis_status, NULL::numeric AS approved_amount,
        ct.id AS contract_id, ct.status AS contract_status, ct.principal_amount
    FROM contracts ct JOIN customers cu ON cu.id = ct.customer_id
    JOIN leads l ON l.id = cu.primary_lead_id AND l.deleted_at IS NULL
) combined GROUP BY organization_id, city_id, product_id
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_reports_credit ON mv_reports_credit (organization_id, (COALESCE(product_id::text, '__null__')), (COALESCE(city_id::text, '__null__')));

-- MV 5 -- mv_reports_collection: parcelas por org/city/status + atraso medio
-- city_id: payment_dues -> customers.primary_lead_id -> leads.city_id
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_reports_collection AS
SELECT pd.organization_id, l.city_id, pd.status,
    COUNT(pd.id) AS dues_count,
    COALESCE(SUM(pd.amount), 0) AS dues_amount_sum,
    COALESCE(AVG(pd.amount), 0) AS dues_amount_avg,
    COALESCE(AVG(CASE
        WHEN pd.status = 'overdue' THEN GREATEST(0, EXTRACT(EPOCH FROM (now() - pd.due_date::timestamptz)) / 86400.0)
        WHEN pd.status = 'paid' AND pd.paid_at IS NOT NULL AND pd.paid_at > pd.due_date::timestamptz
            THEN EXTRACT(EPOCH FROM (pd.paid_at - pd.due_date::timestamptz)) / 86400.0
        ELSE NULL
    END), 0) AS avg_days_overdue
FROM payment_dues pd
JOIN customers cu ON cu.id = pd.customer_id
JOIN leads l ON l.id = cu.primary_lead_id AND l.deleted_at IS NULL
GROUP BY pd.organization_id, l.city_id, pd.status
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_reports_collection ON mv_reports_collection (organization_id, status, (COALESCE(city_id::text, '__null__')));

-- Indices de suporte nas tabelas-fonte (sem duplicar existentes)
-- Existentes confirmados: idx_leads_org_status_created, conversations_org_status_idx,
-- idx_credit_analyses_org_status, idx_contracts_org_status, idx_kanban_stage_history_card_time
CREATE INDEX IF NOT EXISTS idx_credit_analyses_org_created ON credit_analyses (organization_id, created_at DESC) WHERE status != 'cancelado';
CREATE INDEX IF NOT EXISTS idx_contracts_org_status_created ON contracts (organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_dues_org_due_date ON payment_dues (organization_id, due_date DESC);
