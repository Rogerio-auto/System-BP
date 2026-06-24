-- =============================================================================
-- 0072_seed_reports_permissions.sql — Permissão reports:export + billing:read
--   escopado para gestor_regional (F23-S02).
--
-- Contexto: docs/planejamento-relatorios-metricas.md §3, §8, §10 (decisão D2).
--
-- O que esta migration faz:
--   1. Insere a permissão `reports:export` (nova — gating de exportação de
--      relatórios; ausência bloqueia download de CSV/XLSX na página de relatórios).
--   2. Vincula `reports:export` a admin e gestor_geral.
--   3. Vincula `billing:read` (já existente desde 0044/0056) ao role
--      `gestor_regional` — o filtro de cidade já propaga cityScopeIds em
--      getCollectionDashboard (F22-S01); conceder a permissão resulta
--      automaticamente em visão escopada por cidade (sem alteração de código).
--
-- NÃO mexe em:
--   - Role `cobranca` (scope global, decisão D11 em 0056 — intocado).
--   - Lógica de escopo (service.ts / repository.ts / scope.ts — files_forbidden).
--   - Qualquer outra permissão existente.
--
-- Dependências:
--   - 0001_bent_mac_gargan.sql (permissions, roles, role_permissions)
--   - 0044_seed_billing_permissions.sql (billing:read já existe)
--   - 0056_seed_cobranca_role_permissions.sql (role cobranca, billing:reconcile)
--   - 0071_reports_materialized_views.sql (vistas de relatórios)
--
-- Idempotente: INSERT ... ON CONFLICT DO NOTHING em todas as operações.
-- LGPD §14.2: toca somente RBAC/escopo — sem acesso a PII diretamente;
--   gestor_regional já opera dados de leads da sua cidade (escopo pré-existente);
--   billing:read expõe dados financeiros de cobranças cidade-escopados —
--   não há PII nova exposta além do que o role já acessava via leads.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Inserir nova permissão `reports:export`
--
-- Gating de exportação de relatórios (CSV/XLSX). Ausência bloqueia a ação de
-- download na UI e na rota de exportação do backend.
-- billing:read já existe desde 0044 — ON CONFLICT garante idempotência.
-- ---------------------------------------------------------------------------

INSERT INTO "permissions" ("key", "description")
VALUES
  ('reports:export',
   'Exportação de relatórios em CSV/XLSX — gating da ação de download na página de relatórios'),
  ('billing:read',
   'Leitura de parcelas, regras de cobrança e jobs agendados (city-scoped para roles regionais)')
ON CONFLICT ("key") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Vincular `reports:export` a admin, gestor_geral e gestor_regional
--
-- admin: acesso total sem restrição de cidade.
-- gestor_geral: visão global — pode exportar relatórios de qualquer cidade.
-- gestor_regional: exporta os relatórios da(s) sua(s) cidade(s). O export
--   reaplica o city-scope no backend (F23-S09) + flag reports.export.enabled,
--   então o regional só baixa agregados da própria cidade. Conforme o plano §8
--   e o spec deste slot (concessão a admin/gestor_geral/gestor_regional).
-- ---------------------------------------------------------------------------

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.key IN ('admin', 'gestor_geral', 'gestor_regional')
  AND p.key = 'reports:export'
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Vincular `billing:read` ao role `gestor_regional`
--
-- Decisão D2 (§10 do plano): gestor_regional passa a visualizar o dashboard de
-- cobrança filtrado pela(s) sua(s) cidade(s). O filtro já existe no código
-- (getCollectionDashboard recebe cityScopeIds e propaga para todas as queries).
-- Apenas a permissão estava ausente — concedê-la é suficiente para habilitar
-- a visão escopada sem nenhuma alteração de lógica de negócio.
-- ---------------------------------------------------------------------------

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.key = 'gestor_regional'
  AND p.key = 'billing:read'
ON CONFLICT DO NOTHING;
