-- =============================================================================
-- 0060_seed_contracts_permissions.sql — Permissões do módulo de contratos (F17-S03).
--
-- Permissões:
--   contracts:read  → leitura de contratos (listagem + detalhe)
--   contracts:write → criar e editar contratos
--   contracts:sign  → transição de status draft→signed→active
--
-- Roles:
--   admin        → read + write + sign
--   gestor_geral → read + write + sign
--   agente       → read + sign (write apenas para gestor/sistema)
-- =============================================================================

-- Inserir permissões de contratos
INSERT INTO "permissions" ("key", "description")
VALUES
  ('contracts:read',  'Leitura de contratos do cliente — listagem e detalhe'),
  ('contracts:write', 'Criar e editar contratos — inserção e atualização de dados'),
  ('contracts:sign',  'Marcar contrato como assinado — transição draft→signed→active')
ON CONFLICT ("key") DO NOTHING;

-- Vincular ao admin (read + write + sign)
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r CROSS JOIN "permissions" p
WHERE r.key = 'admin'
  AND p.key IN ('contracts:read', 'contracts:write', 'contracts:sign')
ON CONFLICT DO NOTHING;

-- Vincular ao gestor_geral (read + write + sign)
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r CROSS JOIN "permissions" p
WHERE r.key = 'gestor_geral'
  AND p.key IN ('contracts:read', 'contracts:write', 'contracts:sign')
ON CONFLICT DO NOTHING;

-- Vincular ao agente (read + sign; write é restrito a gestor/sistema)
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r CROSS JOIN "permissions" p
WHERE r.key = 'agente'
  AND p.key IN ('contracts:read', 'contracts:sign')
ON CONFLICT DO NOTHING;
