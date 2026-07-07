-- =============================================================================
-- 0084_seed_ai_actions_permissions.sql — Permissões ai_actions:* (F25-S02).
--
-- Contexto: docs/22-agente-interno-acoes.md §8.B.
--
-- O que esta migration faz:
--   1. Insere 3 permissões novas para supervisão humana das ações autônomas da IA:
--      - ai_actions:read    — Ver o registro e painel de ações do agente de IA no funil.
--      - ai_actions:revert  — Reverter uma ação autônoma do agente de IA.
--      - ai_actions:manage  — Configurar o agente de IA no funil (habilitar, limiares).
--   2. Vincula as permissões a roles conforme pré-mapeamento §8.B:
--      - ai_actions:read   → todos os 6 roles operacionais
--      - ai_actions:revert → admin, gestor_geral, gestor_regional, agente
--      - ai_actions:manage → admin, gestor_geral
--   3. Atualiza o catálogo da flag internal_assistant.actions.enabled com
--      uiLabel e description alinhados ao doc 22 §8.
--
-- NÃO mexe em:
--   - MODULE_PREFIX_MAP (ai_actions: já registrado em roles/service.ts).
--   - ai_assistant:use (criado em 0083).
--   - Guards nas rotas (F25-S06).
--   - Lógica de workers/ações (F25-S03/S05).
--
-- LGPD §14.2:
--   Toca somente RBAC e flag de configuração. Sem acesso a PII.
--
-- Dependências:
--   - 0001_bent_mac_gargan (permissions, roles, role_permissions)
--   - 0083_assistant_queries_and_perm (ai_assistant:use — antecessor lógico)
--
-- Idempotente: INSERT ... ON CONFLICT DO NOTHING em todas as operações.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Inserir as 3 permissões de supervisão humana das ações da IA
-- ---------------------------------------------------------------------------

INSERT INTO "permissions" ("key", "description")
VALUES
  ('ai_actions:read',
   'Ver o registro e o painel de ações do agente de IA no funil'),
  ('ai_actions:revert',
   'Reverter uma ação autônoma do agente de IA'),
  ('ai_actions:manage',
   'Configurar o agente de IA no funil (habilitar ações, limiares)')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Vincular ai_actions:read a todos os 6 roles operacionais
--
-- A leitura do painel de ações é necessária para todo operador poder acompanhar
-- o que a IA fez — sem ela, a IA é uma caixa-preta. (doc 22 §8.B)
-- ---------------------------------------------------------------------------

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.key IN ('admin', 'gestor_geral', 'gestor_regional', 'agente', 'operador', 'leitura')
  AND p.key = 'ai_actions:read'
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Vincular ai_actions:revert a supervisores de alto nível
--
-- Apenas quem tem autoridade sobre o funil pode reverter ações da IA.
-- Roles read-only (leitura, operador) não revertem. (doc 22 §8.B)
-- ---------------------------------------------------------------------------

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.key IN ('admin', 'gestor_geral', 'gestor_regional', 'agente')
  AND p.key = 'ai_actions:revert'
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Vincular ai_actions:manage a gestores globais
--
-- Somente admin e gestor_geral configuram o agente (habilitar, limiares de
-- confiança, lista de ações permitidas). (doc 22 §8.B)
-- ---------------------------------------------------------------------------

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.key IN ('admin', 'gestor_geral')
  AND p.key = 'ai_actions:manage'
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. Atualizar flag internal_assistant.actions.enabled
--
-- O catálogo pode já ter esta flag (inserida por slot anterior com descrição
-- genérica). Atualiza uiLabel e description para refletir o doc 22 §8.
-- Mantém status=disabled e visible=true inalterados.
-- ---------------------------------------------------------------------------

INSERT INTO "feature_flags" ("key", "status", "visible", "ui_label", "description", "audience")
VALUES (
  'internal_assistant.actions.enabled',
  'disabled',
  true,
  'Ações Autônomas do Agente de IA',
  'Habilita as ações autônomas do agente de IA no funil (qualificação, kanban, housekeeping). '
  'Requer supervisão humana: ai_actions:read para todos os operadores; ai_actions:revert para '
  'supervisores; ai_actions:manage para gestores. Default OFF — habilitar somente após validação '
  'completa (doc 22 §8.A/§8.B).',
  '{}'
)
ON CONFLICT ("key") DO UPDATE
  SET "ui_label"   = EXCLUDED."ui_label",
      "description" = EXCLUDED."description";
