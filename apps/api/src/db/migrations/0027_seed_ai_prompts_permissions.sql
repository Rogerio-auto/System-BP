-- =============================================================================
-- 0027_seed_ai_prompts_permissions.sql — Permissões RBAC para módulo ai-console/prompts.
--
-- Contexto: F9-S01 — API de prompt_versions.
-- Dependências:
--   - 0001_bent_mac_gargan (permissions, roles, role_permissions)
--   - 0023_ai_conversation  (estrutura ai-console)
--   - 0025_ai_prompts_schema (tabela prompt_versions)
--
-- Cria permissões:
--   - ai_prompts:read     — leitura de prompt_versions
--   - ai_prompts:write    — criação de novas versões de prompt
--   - ai_prompts:activate — ativação transacional de versões de prompt
--
-- Atribuições (doc 10 §3.2):
--   - admin:        ai_prompts:read + ai_prompts:write + ai_prompts:activate
--   - gestor_geral: ai_prompts:read (somente leitura — sem write/activate)
--
-- Idempotente: INSERT ... ON CONFLICT DO NOTHING.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Criar permissões
-- ---------------------------------------------------------------------------

INSERT INTO "permissions" ("key", "description")
VALUES
  ('ai_prompts:read',     'Leitura de versões de prompts do agente LangGraph'),
  ('ai_prompts:write',    'Criação de novas versões de prompts do agente LangGraph'),
  ('ai_prompts:activate', 'Ativação transacional de versões de prompts do agente LangGraph')
ON CONFLICT ("key") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Atribuir ai_prompts:read às roles 'admin' e 'gestor_geral'
-- ---------------------------------------------------------------------------

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT
  r.id AS role_id,
  p.id AS permission_id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.key IN ('admin', 'gestor_geral')
  AND p.key = 'ai_prompts:read'
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Atribuir ai_prompts:write e ai_prompts:activate SOMENTE à role 'admin'
-- ---------------------------------------------------------------------------

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT
  r.id AS role_id,
  p.id AS permission_id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.key = 'admin'
  AND p.key IN ('ai_prompts:write', 'ai_prompts:activate')
ON CONFLICT DO NOTHING;
