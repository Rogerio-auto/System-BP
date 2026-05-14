-- =============================================================================
-- 0018_seed_simulations_permissions.sql — Permissões RBAC para simulações de crédito.
--
-- Contexto: F2-S04.
-- Dependências:
--   - 0001_bent_mac_gargan (permissions, roles, role_permissions)
--   - 0016_credit_core (credit_simulations table)
--
-- Cria permissões:
--   - simulations:create  — criação de simulações via UI e IA
--   - simulations:read    — leitura de histórico de simulações
--
-- Atribui à role 'admin'.
--
-- Idempotente: INSERT ... ON CONFLICT DO NOTHING.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Criar permissões
-- ---------------------------------------------------------------------------

INSERT INTO "permissions" ("key", "description")
VALUES
  ('simulations:create', 'Criação de simulações de crédito para um lead'),
  ('simulations:read',   'Leitura de histórico de simulações de crédito')
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
  AND p.key IN ('simulations:create', 'simulations:read')
ON CONFLICT DO NOTHING;
