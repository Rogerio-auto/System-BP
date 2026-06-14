-- =============================================================================
-- 0054_seed_billing_boleto_permission.sql — RBAC para anexar boleto (F5-S13).
--
-- Contexto: docs/10-seguranca-permissoes.md + F5-S13.
--
-- Cria permissão:
--   - billing:boleto:write — anexar/remover boleto em parcela (upload + referência)
--
-- Atribuições por role:
--   - admin          → billing:boleto:write
--   - gestor_geral   → billing:boleto:write
--   - gestor_regional → billing:boleto:write (city-scoped via repository)
--
-- Idempotente: INSERT ... ON CONFLICT DO NOTHING.
-- Dependências: 0044_seed_billing_permissions (payments, roles, role_permissions)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Criar permissão billing:boleto:write
-- ---------------------------------------------------------------------------

INSERT INTO "permissions" ("key", "description")
VALUES (
  'billing:boleto:write',
  'Anexar, atualizar ou remover boleto (PDF via upload ou referência URL/linha) de uma parcela de cobrança'
)
ON CONFLICT ("key") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Atribuir à role 'admin'
-- ---------------------------------------------------------------------------

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.key = 'admin'
  AND p.key = 'billing:boleto:write'
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Atribuir à role 'gestor_geral'
-- ---------------------------------------------------------------------------

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.key = 'gestor_geral'
  AND p.key = 'billing:boleto:write'
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Atribuir à role 'gestor_regional' (city-scoped via repository JOIN leads)
-- ---------------------------------------------------------------------------

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.key = 'gestor_regional'
  AND p.key = 'billing:boleto:write'
ON CONFLICT DO NOTHING;
