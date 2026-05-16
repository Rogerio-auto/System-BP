-- =============================================================================
-- 0020_seed_dashboard_permission.sql — Permissão RBAC para leitura do dashboard.
--
-- Contexto: F8-S03.
-- Dependências:
--   - 0001_bent_mac_gargan (permissions, roles, role_permissions)
--
-- Cria permissão:
--   - dashboard:read — acesso ao endpoint GET /api/dashboard/metrics
--
-- Atribui às roles 'admin' e 'agente'.
--
-- Idempotente: INSERT ... ON CONFLICT DO NOTHING.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Criar permissão
-- ---------------------------------------------------------------------------

INSERT INTO "permissions" ("key", "description")
VALUES
  ('dashboard:read', 'Leitura dos KPIs agregados do dashboard')
ON CONFLICT ("key") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Atribuir às roles 'admin' e 'agente'
-- ---------------------------------------------------------------------------

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT
  r.id AS role_id,
  p.id AS permission_id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.key IN ('admin', 'agente')
  AND p.key = 'dashboard:read'
ON CONFLICT DO NOTHING;
