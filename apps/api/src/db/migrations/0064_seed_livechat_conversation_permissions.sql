-- =============================================================================
-- 0064_seed_livechat_conversation_permissions.sql — Permissões de conversas livechat (F16-S12).
--
-- Permissões:
--   livechat:conversation:read → listar e visualizar conversas e mensagens
--   crm:contact:phone:read    → obter telefone decifrado no detalhe da conversa
--
-- Roles:
--   admin        → ambas as permissões
--   gestor_geral → ambas as permissões
--   agente       → livechat:conversation:read (sem acesso a PII de telefone)
--
-- Não conflita com 0063 (channel.connect).
-- =============================================================================

-- Inserir permissões
INSERT INTO "permissions" ("key", "description")
VALUES
  (
    'livechat:conversation:read',
    'Listar e visualizar conversas e mensagens do inbox de live chat'
  ),
  (
    'crm:contact:phone:read',
    'Obter o número de telefone decifrado de um contato em conversas (LGPD: PII protegida)'
  )
ON CONFLICT ("key") DO NOTHING;

-- Vincular ao admin
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r CROSS JOIN "permissions" p
WHERE r.key = 'admin'
  AND p.key IN ('livechat:conversation:read', 'crm:contact:phone:read')
ON CONFLICT DO NOTHING;

-- Vincular ao gestor_geral
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r CROSS JOIN "permissions" p
WHERE r.key = 'gestor_geral'
  AND p.key IN ('livechat:conversation:read', 'crm:contact:phone:read')
ON CONFLICT DO NOTHING;

-- Vincular ao agente (apenas leitura — sem PII de telefone)
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r CROSS JOIN "permissions" p
WHERE r.key = 'agente'
  AND p.key IN ('livechat:conversation:read')
ON CONFLICT DO NOTHING;
