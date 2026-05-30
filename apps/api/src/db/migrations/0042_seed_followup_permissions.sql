-- =============================================================================
-- 0042_seed_followup_permissions.sql — Permissões RBAC para módulo de follow-up.
--
-- Contexto: F5-S05.
-- Dependências:
--   - 0001_bent_mac_gargan (permissions, roles, role_permissions)
--   - 0034_followup_and_templates (followup_rules, followup_jobs tables)
--
-- Cria permissões:
--   - followup:read        — leitura de réguas + lista de jobs (city-scoped via org)
--   - followup:write       — criação e edição de réguas de follow-up
--   - followup:cancel_job  — cancelamento manual de job agendado
--
-- Nota sobre followup:manage (já existente no doc):
--   A doc 10 menciona 'followup:manage' como permissão genérica.
--   Este slot implementa granularidade 3-tier (read/write/cancel_job)
--   para separar acesso ao calendário de jobs (que pode conter lead_id)
--   de acesso à configuração das réguas.
--
-- Atribuições por role:
--   - admin         → todas as 3 permissões
--   - gestor_geral  → read + write + cancel_job (acesso global à org)
--   - gestor_regional → read + cancel_job (acesso city-scoped)
--   - agente        → (sem permissão de follow-up — acesso apenas na ficha do lead via CRM)
--
-- Idempotente: INSERT ... ON CONFLICT DO NOTHING.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Criar permissões
-- ---------------------------------------------------------------------------

INSERT INTO "permissions" ("key", "description")
VALUES
  ('followup:read',
   'Leitura de réguas de follow-up e listagem de jobs agendados'),
  ('followup:write',
   'Criação e edição de réguas de follow-up (template, gatilho, espera, ativação)'),
  ('followup:cancel_job',
   'Cancelamento manual de jobs de follow-up agendados')
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
    'followup:read',
    'followup:write',
    'followup:cancel_job'
  )
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Atribuir à role 'gestor_geral' — read + write + cancel_job
--
-- Gestor geral configura réguas e pode cancelar jobs de qualquer cidade.
-- ---------------------------------------------------------------------------

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT
  r.id AS role_id,
  p.id AS permission_id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.key = 'gestor_geral'
  AND p.key IN (
    'followup:read',
    'followup:write',
    'followup:cancel_job'
  )
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Atribuir à role 'gestor_regional' — read + cancel_job (city-scoped)
--
-- Gestor regional pode visualizar e cancelar jobs da sua regional.
-- Configuração de réguas é responsabilidade do gestor geral / admin.
-- ---------------------------------------------------------------------------

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT
  r.id AS role_id,
  p.id AS permission_id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.key = 'gestor_regional'
  AND p.key IN (
    'followup:read',
    'followup:cancel_job'
  )
ON CONFLICT DO NOTHING;
