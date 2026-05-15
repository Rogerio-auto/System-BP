-- =============================================================================
-- 0019_seed_agents_permission.sql — Permissão RBAC para gestão de agentes.
--
-- Contexto: F8-S01.
-- Dependências:
--   - 0001_bent_mac_gargan (permissions, roles, role_permissions)
--   - 0002_cities_agents   (agents, agent_cities tables)
--
-- Cria permissão:
--   - agents:admin — CRUD completo de agentes e vínculo com cidades
--
-- Atribui à role 'admin'.
--
-- Idempotente: INSERT ... ON CONFLICT DO NOTHING.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Criar permissão
-- ---------------------------------------------------------------------------

INSERT INTO "permissions" ("key", "description")
VALUES
  ('agents:admin', 'Gestão completa de agentes de crédito e suas atribuições a cidades')
ON CONFLICT ("key") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Atribuir à role 'admin'
-- ---------------------------------------------------------------------------

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT
  r.id AS role_id,
  p.id AS permission_id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.key = 'admin'
  AND p.key = 'agents:admin'
ON CONFLICT DO NOTHING;
