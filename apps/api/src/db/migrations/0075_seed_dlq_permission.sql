-- =============================================================================
-- 0075_seed_dlq_permission.sql — Permissão de gestão da Dead-Letter Queue.
--
-- As rotas de DLQ (apps/api/src/modules/admin/dlq.routes.ts) exigem `dlq:manage`
-- via authorize(), mas a permissão nunca foi inserida no catálogo — resultando em
-- 403 para TODOS, inclusive admin. Esta migration cadastra a permissão e a concede
-- ao papel admin (DLQ é operação de administração/infra).
-- =============================================================================

INSERT INTO "permissions" ("key", "description")
VALUES ('dlq:manage', 'Gestão da Dead-Letter Queue — listar, reprocessar e descartar mensagens falhas')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r CROSS JOIN "permissions" p
WHERE r.key = 'admin'
  AND p.key = 'dlq:manage'
ON CONFLICT DO NOTHING;
