-- =============================================================================
-- 0088_seed_assistant_escalate_permission.sql — Permissão assistant:escalate (F6-S30).
--
-- Contexto: docs/22-agente-interno-acoes.md — escalar lead ao Departamento de
-- Crédito a partir do copiloto interno (human-in-the-loop, POST /api/assistant/escalate).
--
-- O que esta migration faz:
--   1. Insere a permissão `assistant:escalate` — "Notificar o Departamento de
--      Crédito sobre um lead a partir do copiloto interno".
--   2. Concede `assistant:escalate` aos 6 roles operacionais (decisão do
--      Rogério: QUALQUER operador com acesso ao lead pode escalar — o gate
--      real de segurança é permissão + escopo de cidade do lead, aplicado
--      no service, não uma restrição adicional de role).
--
-- NÃO faz (decisão do Rogério, 2026-07-14):
--   Não popula organizations.settings.credit_escalation — configuração de
--   quem recebe a escalação (cidade da matriz + roles) é setada manualmente
--   em produção via SQL. Sem config, o service cai no fallback: destinatários
--   resolvidos pelos roles que detêm `credit_analyses:decide` (escopo global).
--
-- Dependências:
--   - 0001_bent_mac_gargan (permissions, roles, role_permissions)
--
-- Idempotente: INSERT ... ON CONFLICT DO NOTHING em todas as operações.
--
-- Rollback manual (não executar em produção sem decisão explícita):
--   DELETE FROM role_permissions WHERE permission_id IN (
--     SELECT id FROM permissions WHERE key = 'assistant:escalate');
--   DELETE FROM permissions WHERE key = 'assistant:escalate';
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Permissão assistant:escalate
-- ---------------------------------------------------------------------------

INSERT INTO "permissions" ("key", "description")
VALUES (
  'assistant:escalate',
  'Escalar um lead ao Departamento de Crédito a partir do copiloto interno ' ||
  '(human-in-the-loop — notifica os analistas responsáveis, a IA nunca escala sozinha)'
)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Conceder assistant:escalate aos 6 roles operacionais
--
-- Qualquer operador com acesso ao lead pode escalar — o gate de segurança é
-- a combinação permissão + escopo de cidade do lead (404 fora do escopo),
-- aplicado na service layer (apps/api/src/modules/assistant-escalation/).
-- ---------------------------------------------------------------------------

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.key IN ('admin', 'gestor_geral', 'gestor_regional', 'agente', 'operador', 'leitura')
  AND p.key = 'assistant:escalate'
ON CONFLICT DO NOTHING;
