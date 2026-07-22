-- =============================================================================
-- 0095_seed_quick_replies_permissions.sql — RBAC + flag de respostas rápidas
--   do live chat (F28-S01). Doc 25 §5.
--
-- Permissões:
--   livechat:quick_reply:read   — listar e usar respostas rápidas (org + próprias)
--   livechat:quick_reply:write  — CRUD das PRÓPRIAS (visibility='personal')
--   livechat:quick_reply:manage — CRUD das da ORGANIZAÇÃO + reordenar + ver/
--                                  editar as de qualquer um
--
-- ⚠️ NOTA SOBRE OS PAPÉIS (desvio deliberado do texto literal do doc 25 §5):
--   O doc 25 lista os papéis `gestor_cidade` e `agente_admin` na matriz de
--   permissões. NENHUM dos dois existe como linha em `roles` — o catálogo
--   real (roles.key, conferido em apps/api/src/db/schema/roles.ts e
--   docs/qa/02-rbac-roles-permissoes.md) é: admin, gestor_geral,
--   gestor_regional, agente, operador, leitura, cobranca. `gestor_cidade` e
--   `agente_admin` são nomes de rascunho que aparecem em docs auxiliares
--   (docs/20-central-de-ajuda.md, featureGate.ts KNOWN_ROLES) mas nunca
--   foram materializados como role real.
--
--   Live chat hoje só é acessível a admin/gestor_geral/agente (migrations
--   0063/0064/0069 — channel.connect, livechat:conversation:*,
--   livechat:message:send). gestor_regional NÃO tem acesso a live chat.
--   Mapeamento aplicado aqui, alinhado a esse precedente já estabelecido:
--     - read/write  → admin, gestor_geral, agente   (quem já usa o live chat)
--     - manage      → admin, gestor_geral            (quem já cura canais/config
--                       do live chat — mesma população de channels:manage)
--   Um `agente` comum NÃO recebe `manage` — não pode curar a biblioteca da
--   organização nem editar respostas de outro dono, apenas as próprias
--   (write) e o uso/leitura (read). Isso preserva a intenção do doc 25 de
--   distinguir tiers dentro da população de agentes sem inventar uma role
--   inexistente no banco.
--
-- Seed idempotente da flag `livechat.quick_replies.enabled` (status
-- 'disabled', visible=false) no molde de 0090_seed_assistant_history_flag.sql.
--
-- Molde de permissões + role_permissions: 0069_seed_livechat_action_permissions.sql.
-- Idempotente: INSERT ... ON CONFLICT DO NOTHING em todas as operações —
-- rodar esta migration duas vezes não duplica nada.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Inserir permissões
-- ---------------------------------------------------------------------------
INSERT INTO "permissions" ("key", "description")
VALUES
  (
    'livechat:quick_reply:read',
    'Listar e usar respostas rápidas no live chat (biblioteca da organização + próprias)'
  ),
  (
    'livechat:quick_reply:write',
    'CRUD das próprias respostas rápidas (visibility=personal)'
  ),
  (
    'livechat:quick_reply:manage',
    'CRUD das respostas rápidas da organização (visibility=organization), reordenar e '
      || 'ver/editar as de qualquer dono'
  )
ON CONFLICT ("key") DO NOTHING;

-- ---------------------------------------------------------------------------
-- admin — read + write + manage
-- ---------------------------------------------------------------------------
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r CROSS JOIN "permissions" p
WHERE r.key = 'admin'
  AND p.key IN (
    'livechat:quick_reply:read',
    'livechat:quick_reply:write',
    'livechat:quick_reply:manage'
  )
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- gestor_geral — read + write + manage
-- ---------------------------------------------------------------------------
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r CROSS JOIN "permissions" p
WHERE r.key = 'gestor_geral'
  AND p.key IN (
    'livechat:quick_reply:read',
    'livechat:quick_reply:write',
    'livechat:quick_reply:manage'
  )
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- agente — read + write (sem manage — não cura a biblioteca da organização)
-- ---------------------------------------------------------------------------
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r CROSS JOIN "permissions" p
WHERE r.key = 'agente'
  AND p.key IN (
    'livechat:quick_reply:read',
    'livechat:quick_reply:write'
  )
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Seed idempotente da flag `livechat.quick_replies.enabled` — nasce disabled.
--
-- `visible = false`: a flag não aparece no painel geral como "Em
-- desenvolvimento" até a fase F28 estar pronta para anúncio (mesmo padrão
-- de 0090/0093).
-- ---------------------------------------------------------------------------
INSERT INTO "feature_flags" ("key", "status", "visible", "ui_label", "description", "audience")
VALUES (
  'livechat.quick_replies.enabled',
  'disabled',
  false,
  'Respostas rápidas do live chat',
  'Biblioteca de mensagens pré-definidas (texto/mídia) que o operador dispara no live '
    || 'chat com um clique. Gateia UI/API/worker/tool (doc 25-respostas-rapidas.md §D7).',
  '{}'
)
ON CONFLICT ("key") DO NOTHING;
