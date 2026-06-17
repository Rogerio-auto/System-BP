-- =============================================================================
-- 0069_seed_livechat_action_permissions.sql
--
-- Adiciona as permissões de escrita do livechat que foram referenciadas nas
-- rotas (F16-S13) mas nunca inseridas no catálogo:
--
--   livechat:conversation:manage  → PATCH /assign + PATCH /resolve
--   livechat:message:send         → POST /conversations/:id/messages
--                                   + POST /uploads/signed-url
--   channels:manage               → PATCH /channels/:id/default
--
-- Roles:
--   admin, gestor_geral → as três permissões
--   agente              → livechat:conversation:manage + livechat:message:send
--                         (sem channels:manage — agente não administra canais)
--
-- Não conflita com 0063 (channel.connect) nem 0064 (livechat:conversation:read).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Inserir permissões
-- ---------------------------------------------------------------------------
INSERT INTO "permissions" ("key", "description")
VALUES
  (
    'livechat:conversation:manage',
    'Atribuir agente, resolver e gerenciar estado de conversas no inbox de live chat'
  ),
  (
    'livechat:message:send',
    'Enviar mensagens de texto e mídia em conversas do inbox de live chat'
  ),
  (
    'channels:manage',
    'Gerenciar configurações de canais: definir canal padrão da organização'
  )
ON CONFLICT ("key") DO NOTHING;

-- ---------------------------------------------------------------------------
-- admin — todas as três
-- ---------------------------------------------------------------------------
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r CROSS JOIN "permissions" p
WHERE r.key = 'admin'
  AND p.key IN (
    'livechat:conversation:manage',
    'livechat:message:send',
    'channels:manage'
  )
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- gestor_geral — todas as três
-- ---------------------------------------------------------------------------
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r CROSS JOIN "permissions" p
WHERE r.key = 'gestor_geral'
  AND p.key IN (
    'livechat:conversation:manage',
    'livechat:message:send',
    'channels:manage'
  )
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- agente — manage + send (sem channels:manage)
-- ---------------------------------------------------------------------------
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r CROSS JOIN "permissions" p
WHERE r.key = 'agente'
  AND p.key IN (
    'livechat:conversation:manage',
    'livechat:message:send'
  )
ON CONFLICT DO NOTHING;
