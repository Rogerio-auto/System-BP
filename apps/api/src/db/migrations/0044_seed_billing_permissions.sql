-- =============================================================================
-- 0044_seed_billing_permissions.sql — Permissões RBAC para módulo de cobrança.
--
-- Contexto: F5-S08.
-- Dependências:
--   - 0001_bent_mac_gargan (permissions, roles, role_permissions)
--   - 0036_collection.sql  (payment_dues, collection_rules, collection_jobs)
--
-- Cria permissões:
--   - billing:read        — leitura de parcelas, regras e jobs (city-scoped)
--   - billing:write       — criação e edição de regras de cobrança
--   - billing:mark_paid   — marcação manual de parcela como paga
--   - billing:cancel_job  — cancelamento manual de job de cobrança agendado
--
-- Atribuições por role:
--   - admin          → todas as 4 permissões
--   - gestor_geral   → read + write + mark_paid + cancel_job
--   - gestor_regional → read + mark_paid + cancel_job (city-scoped via leads)
--   - agente         → (sem permissão de billing — apenas via ficha do cliente)
--
-- Idempotente: INSERT ... ON CONFLICT DO NOTHING.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Criar permissões
-- ---------------------------------------------------------------------------

INSERT INTO "permissions" ("key", "description")
VALUES
  ('billing:read',
   'Leitura de parcelas, regras de cobrança e jobs agendados (city-scoped)'),
  ('billing:write',
   'Criação e edição de regras de cobrança (template, gatilho, ativação)'),
  ('billing:mark_paid',
   'Marcação manual de parcela como paga ou renegociada'),
  ('billing:cancel_job',
   'Cancelamento manual de jobs de cobrança agendados')
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
    'billing:read',
    'billing:write',
    'billing:mark_paid',
    'billing:cancel_job'
  )
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Atribuir à role 'gestor_geral' — read + write + mark_paid + cancel_job
--
-- Gestor geral configura réguas e pode marcar/cancelar de qualquer cidade.
-- ---------------------------------------------------------------------------

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT
  r.id AS role_id,
  p.id AS permission_id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.key = 'gestor_geral'
  AND p.key IN (
    'billing:read',
    'billing:write',
    'billing:mark_paid',
    'billing:cancel_job'
  )
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Atribuir à role 'gestor_regional' — read + mark_paid + cancel_job (city-scoped)
--
-- Gestor regional pode visualizar, marcar pago e cancelar jobs da sua regional.
-- Configuração de réguas é responsabilidade do gestor geral / admin.
-- city-scope aplicado no código (repository JOIN customers → leads.city_id).
-- ---------------------------------------------------------------------------

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT
  r.id AS role_id,
  p.id AS permission_id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.key = 'gestor_regional'
  AND p.key IN (
    'billing:read',
    'billing:mark_paid',
    'billing:cancel_job'
  )
ON CONFLICT DO NOTHING;
