-- =============================================================================
-- 0028_seed_ai_decisions_permission.sql — Permissão RBAC para módulo ai-console/decisions.
--
-- Contexto: F9-S02 — API read de ai_decision_logs (lista + timeline, city-scoped).
-- Dependências:
--   - 0001_bent_mac_gargan (permissions, roles, role_permissions)
--   - 0023_ai_conversation  (estrutura ai-console)
--
-- Cria permissão:
--   - ai_decisions:read — leitura de ai_decision_logs (lista + timeline)
--
-- Atribuições (doc 10 §3.2 + §74):
--   - admin:            ai_decisions:read (acesso global, inclui lead_id IS NULL)
--   - gestor_geral:     ai_decisions:read (acesso global, inclui lead_id IS NULL)
--   - gestor_regional:  ai_decisions:read (city-scoped via leads.city_id;
--                       decisões lead_id IS NULL excluídas — não identificadas)
--
-- Idempotente: INSERT ... ON CONFLICT DO NOTHING.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Criar permissão
-- ---------------------------------------------------------------------------

INSERT INTO "permissions" ("key", "description")
VALUES
  ('ai_decisions:read', 'Leitura de logs de decisão do agente LangGraph (ai_decision_logs)')
ON CONFLICT ("key") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Atribuir ai_decisions:read às roles 'admin', 'gestor_geral' e 'gestor_regional'
--    (doc 10 §3.2 + §74 — gestor_regional com city-scope aplicado no código)
-- ---------------------------------------------------------------------------

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT
  r.id AS role_id,
  p.id AS permission_id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.key IN ('admin', 'gestor_geral', 'gestor_regional')
  AND p.key = 'ai_decisions:read'
ON CONFLICT DO NOTHING;
