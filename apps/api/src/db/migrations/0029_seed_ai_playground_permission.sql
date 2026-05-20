-- =============================================================================
-- 0029_seed_ai_playground_permission.sql — Permissão RBAC para ai-console/playground.
--
-- Contexto: F9-S04 — Proxy /api/ai-console/playground + DLP na entrada do operador.
-- Dependências:
--   - 0001_bent_mac_gargan (permissions, roles, role_permissions)
--   - 0023_ai_conversation  (estrutura ai-console)
--
-- Cria permissão:
--   - ai_playground:run — execução do playground dry-run (admin only)
--
-- Atribuições (doc 10 §3.2 + matriz de papéis):
--   - admin:  ai_playground:run (somente admin — acesso privilegiado a dry-run do grafo)
--
-- Idempotente: INSERT ... ON CONFLICT DO NOTHING.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Criar permissão
-- ---------------------------------------------------------------------------

INSERT INTO "permissions" ("key", "description")
VALUES
  ('ai_playground:run', 'Execução do playground dry-run do agente LangGraph (somente admin)')
ON CONFLICT ("key") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Atribuir ai_playground:run à role 'admin' (doc 10 §3.2 — admin-only)
-- ---------------------------------------------------------------------------

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT
  r.id AS role_id,
  p.id AS permission_id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.key = 'admin'
  AND p.key = 'ai_playground:run'
ON CONFLICT DO NOTHING;
