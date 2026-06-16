-- =============================================================================
-- 0062_seed_livechat_channel_permissions.sql — Permissões do módulo de canais (F16-S11).
--
-- Permissões:
--   channel.connect → conectar, listar e desativar canais de mensagem
--
-- Roles:
--   admin        → channel.connect
--   gestor_geral → channel.connect
--
-- Nota: agentes não recebem channel.connect — a conexão de canais é
-- uma operação de configuração de sistema reservada a gestores/admins.
-- =============================================================================

-- Inserir permissão de canal
INSERT INTO "permissions" ("key", "description")
VALUES
  ('channel.connect', 'Conectar, listar e desativar canais de mensagem (WhatsApp, Instagram, WAHA)')
ON CONFLICT ("key") DO NOTHING;

-- Vincular ao admin
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r CROSS JOIN "permissions" p
WHERE r.key = 'admin'
  AND p.key IN ('channel.connect')
ON CONFLICT DO NOTHING;

-- Vincular ao gestor_geral
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r CROSS JOIN "permissions" p
WHERE r.key = 'gestor_geral'
  AND p.key IN ('channel.connect')
ON CONFLICT DO NOTHING;
