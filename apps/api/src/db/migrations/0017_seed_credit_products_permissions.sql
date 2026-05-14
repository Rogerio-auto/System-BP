-- =============================================================================
-- 0017_seed_credit_products_permissions.sql — Permissões RBAC para produtos de crédito.
--
-- Contexto: F2-S03.
-- Dependências:
--   - 0001_bent_mac_gargan (permissions, roles, role_permissions)
--
-- Cria permissões:
--   - credit_products:read   — leitura de produtos e regras
--   - credit_products:write  — criação, atualização e publicação de regras
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
  ('credit_products:read',  'Leitura de produtos de crédito e histórico de regras'),
  ('credit_products:write', 'Criação, atualização e publicação de regras de crédito')
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
  AND p.key IN ('credit_products:read', 'credit_products:write')
ON CONFLICT DO NOTHING;
