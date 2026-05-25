-- =============================================================================
-- 0033_seed_credit_analyses_permissions.sql — Permissões RBAC para análise de crédito.
--
-- Contexto: F4-S02.
-- Dependências:
--   - 0001_bent_mac_gargan (permissions, roles, role_permissions)
--   - 0032_credit_analyses (credit_analyses, credit_analysis_versions tables)
--
-- Cria permissões:
--   - credit_analyses:read           — leitura (listagem + detalhe, city-scoped)
--   - credit_analyses:write          — criação e nova versão de parecer
--   - credit_analyses:decide         — decisão final (aprovado | recusado)
--   - credit_analyses:request_review — solicitar revisão humana (Art. 20 §5 LGPD)
--
-- Atribuições por role:
--   - admin         → todas as 4 permissões
--   - gestor_geral  → read + write + decide (acesso global à org)
--   - gestor_regional → read + write + decide (city-scoped — enforced no service)
--   - agente        → read + request_review (city-scoped, apenas leads atribuídos)
--
-- Nota sobre city-scope e agente:
--   A restrição "apenas leads atribuídos" para agentes é aplicada na service
--   layer (assertLeadAccess + applyCityScope), não na permissão em si.
--   A permissão credit_analyses:read concede acesso estrutural; o scope
--   restringe quais análises são visíveis.
--
-- Idempotente: INSERT ... ON CONFLICT DO NOTHING.
--
-- LGPD: estas permissões implementam Art. 20 §1º (registro auditável de
--   decisões) e §5 (direito de revisão por humano). O escopo de cidade garante
--   que analistas de uma regional não acessem dados de outra.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Criar permissões
-- ---------------------------------------------------------------------------

INSERT INTO "permissions" ("key", "description")
VALUES
  ('credit_analyses:read',
   'Leitura de análises de crédito e histórico de pareceres (city-scoped)'),
  ('credit_analyses:write',
   'Criação de análise de crédito e adição de novos pareceres versionados'),
  ('credit_analyses:decide',
   'Emissão de decisão final de crédito (aprovado ou recusado) — Art. 20 §1º LGPD'),
  ('credit_analyses:request_review',
   'Solicitar revisão humana de decisão de crédito — Art. 20 §5 LGPD')
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
    'credit_analyses:read',
    'credit_analyses:write',
    'credit_analyses:decide',
    'credit_analyses:request_review'
  )
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Atribuir à role 'gestor_geral' — read + write + decide (acesso global)
-- ---------------------------------------------------------------------------

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT
  r.id AS role_id,
  p.id AS permission_id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.key = 'gestor_geral'
  AND p.key IN (
    'credit_analyses:read',
    'credit_analyses:write',
    'credit_analyses:decide'
  )
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Atribuir à role 'gestor_regional' — read + write + decide (city-scoped)
--
-- O escopo de cidade (city_scope) é aplicado pelo service layer.
-- A permissão concede acesso estrutural; o scope restringe quais análises
-- são visíveis/modificáveis.
-- ---------------------------------------------------------------------------

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT
  r.id AS role_id,
  p.id AS permission_id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.key = 'gestor_regional'
  AND p.key IN (
    'credit_analyses:read',
    'credit_analyses:write',
    'credit_analyses:decide'
  )
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. Atribuir à role 'agente' — read + request_review (city-scoped)
--
-- Agentes leem análises dos leads na sua cidade.
-- Podem solicitar revisão (Art. 20 §5) mas NÃO podem escrever ou decidir.
-- A restrição "apenas leads atribuídos" é enforced no service layer.
-- ---------------------------------------------------------------------------

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT
  r.id AS role_id,
  p.id AS permission_id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.key = 'agente'
  AND p.key IN (
    'credit_analyses:read',
    'credit_analyses:request_review'
  )
ON CONFLICT DO NOTHING;
