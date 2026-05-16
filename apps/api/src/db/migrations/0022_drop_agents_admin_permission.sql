-- =============================================================================
-- 0022_drop_agents_admin_permission.sql — Remove permissão órfã agents:admin.
--
-- Contexto: F8-S10 — Reconciliação RBAC (convenção :manage).
--
-- Problema: a migration 0019 criou agents:admin como permissão separada, mas
-- o seed base já cria e atribui agents:manage. A duplicação é incoerente com
-- a convenção canônica :manage adotada em todo o sistema.
--
-- Solução: DELETE de agents:admin na tabela permissions. O ON DELETE CASCADE
-- de role_permissions remove automaticamente todos os vínculos a roles.
--
-- Idempotente: DELETE WHERE key = 'agents:admin' é seguro em re-execução.
--
-- NÃO editar 0019_seed_agents_permission.sql — registro histórico imutável.
-- =============================================================================

DELETE FROM "permissions"
WHERE "key" = 'agents:admin';
