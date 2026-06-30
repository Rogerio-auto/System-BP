-- =============================================================================
-- 0077_seed_notifications_permissions.sql — Permissão RBAC + feature flags de
-- notificações (F24-S02).
--
-- Contexto: F24 — módulo de notificações (regras, SLA, e-mail, realtime).
-- Dependências:
--   - 0001_bent_mac_gargan (permissions, roles, role_permissions)
--   - 0076_notification_rules (notification_rules, notification_deliveries)
--
-- Cria permissão:
--   - notifications:manage — gestão de regras e entregas de notificação
--
-- Atribuições por role:
--   - admin        → notifications:manage
--   - gestor_geral → notifications:manage
--
-- Semeia feature flags (todas disabled — nada entra em prod sem flip explícito):
--   - notifications.rules.enabled    — motor de regras de notificação
--   - notifications.sla.enabled      — notificações de violação de SLA
--   - notifications.email.enabled    — canal e-mail para entrega de notificações
--   - notifications.realtime.enabled — entrega realtime (SSE/WebSocket)
--
-- Idempotente: INSERT ... ON CONFLICT DO NOTHING em todos os blocos.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Criar permissão
-- ---------------------------------------------------------------------------

INSERT INTO "permissions" ("key", "description")
VALUES (
  'notifications:manage',
  'Gerenciar regras e entregas de notificações do sistema (notification_rules, notification_deliveries)'
)
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
  AND p.key = 'notifications:manage'
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Atribuir à role 'gestor_geral'
-- ---------------------------------------------------------------------------

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT
  r.id AS role_id,
  p.id AS permission_id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.key = 'gestor_geral'
  AND p.key = 'notifications:manage'
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Feature flags de notificações — todas disabled (gate explícito por
--    funcionalidade; habilitar individualmente após validação operacional)
-- ---------------------------------------------------------------------------

INSERT INTO "feature_flags" ("key", "status", "visible", "ui_label", "description", "audience")
VALUES
  (
    'notifications.rules.enabled',
    'disabled',
    true,
    'Disponível na Fase 24',
    'Motor de regras de notificação — avalia notification_rules e gera notification_deliveries',
    '{}'
  ),
  (
    'notifications.sla.enabled',
    'disabled',
    true,
    'Disponível na Fase 24',
    'Notificações de violação de SLA — dispara alertas quando leads ultrapassam tempo limite por stage',
    '{}'
  ),
  (
    'notifications.email.enabled',
    'disabled',
    true,
    'Disponível na Fase 24',
    'Canal e-mail para entrega de notificações — habilitar somente após configurar SMTP/SendGrid',
    '{}'
  ),
  (
    'notifications.realtime.enabled',
    'disabled',
    true,
    'Disponível na Fase 24',
    'Entrega realtime de notificações via SSE/WebSocket — requer notifications.rules.enabled',
    '{}'
  )
ON CONFLICT ("key") DO NOTHING;
