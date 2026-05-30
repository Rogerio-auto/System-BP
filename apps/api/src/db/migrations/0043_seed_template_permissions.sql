-- =============================================================================
-- 0042_seed_template_permissions.sql — Permissões RBAC para gestão de templates WhatsApp.
--
-- Contexto: F5-S09.
-- Dependências:
--   - 0001_bent_mac_gargan (permissions, roles, role_permissions)
--   - 0034_followup_and_templates (whatsapp_templates table)
--
-- Cria permissões:
--   - templates:read   — leitura (listagem + detalhe)
--   - templates:write  — criação e edição de templates
--   - templates:sync   — sincronização com Meta Cloud API
--   - templates:delete — soft delete (status=paused)
--
-- Atribuições por role:
--   - admin         → todas as 4 permissões
--   - gestor_geral  → read + write + sync + delete (acesso global à org)
--   - gestor_regional → read + write (gestão local, sem delete/sync para evitar
--                       remoção acidental de templates em uso por outras regiões)
--   - agente        → read (visibilidade apenas — não gerencia templates)
--
-- Idempotente: INSERT ... ON CONFLICT DO NOTHING.
--
-- LGPD: templates não contêm PII (validação DLP no Zod schema —
--   F5-S09 bloqueia CPF, email, telefone hardcoded no body).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Criar permissões
-- ---------------------------------------------------------------------------

INSERT INTO "permissions" ("key", "description")
VALUES
  ('templates:read',
   'Leitura do catálogo de templates WhatsApp: listagem, detalhe e status de aprovação'),
  ('templates:write',
   'Criação e edição de templates WhatsApp (apenas pending/rejected podem ser editados)'),
  ('templates:sync',
   'Sincronização de status de templates com a Meta Cloud API (individual e batch)'),
  ('templates:delete',
   'Soft delete de templates WhatsApp (status=paused — não remove da Meta)')
ON CONFLICT ("key") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Atribuir à role 'admin' — acesso total
-- ---------------------------------------------------------------------------

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT
  r.id AS role_id,
  p.id AS permission_id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.key = 'admin'
  AND p.key IN (
    'templates:read',
    'templates:write',
    'templates:sync',
    'templates:delete'
  )
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Atribuir à role 'gestor_geral' — read + write + sync + delete
-- ---------------------------------------------------------------------------

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT
  r.id AS role_id,
  p.id AS permission_id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.key = 'gestor_geral'
  AND p.key IN (
    'templates:read',
    'templates:write',
    'templates:sync',
    'templates:delete'
  )
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Atribuir à role 'gestor_regional' — read + write
--
-- Gestores regionais gerenciam templates localmente mas não fazem
-- delete nem sync-all (ações globais que afetam toda a organização).
-- ---------------------------------------------------------------------------

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT
  r.id AS role_id,
  p.id AS permission_id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.key = 'gestor_regional'
  AND p.key IN (
    'templates:read',
    'templates:write'
  )
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. Atribuir à role 'agente' — read
--
-- Agentes visualizam o catálogo de templates (para contexto nas conversas)
-- mas não gerenciam. Gestão é responsabilidade do gestor.
-- ---------------------------------------------------------------------------

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT
  r.id AS role_id,
  p.id AS permission_id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.key = 'agente'
  AND p.key IN (
    'templates:read'
  )
ON CONFLICT DO NOTHING;
