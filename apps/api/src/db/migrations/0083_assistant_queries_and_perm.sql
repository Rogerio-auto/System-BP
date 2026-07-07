-- =============================================================================
-- 0083_assistant_queries_and_perm.sql
--   Permissão ai_assistant:use + tabela assistant_queries.
--
-- Contexto: docs/22-agente-interno-acoes.md §12.3/§12.5.
--
-- O que esta migration faz:
--   1. Cria a tabela `assistant_queries` — log imutável (append-only) de
--      auditoria das consultas ao copiloto interno. Armazena somente a
--      pergunta APÓS DLP (question_redacted) — nunca PII bruta.
--   2. Insere a permissão `ai_assistant:use` — "Conversar com o copiloto
--      interno". Não concede leitura de dados: cada consulta ainda exige
--      a permissão do domínio (§12.3 doc 22).
--   3. Concede `ai_assistant:use` aos 6 roles operacionais:
--      admin, gestor_geral, gestor_regional, agente, operador, leitura.
--
-- LGPD §14.2:
--   question_redacted: pergunta com DLP aplicado — nunca CPF/telefone/nome brutos.
--     O serviço LangGraph aplica dlp_filter() antes de persistir.
--   answer_summary: resumo da resposta; sem PII bruta.
--   tools_called: parâmetros não-PII (IDs e agregados).
--   city_scope_snapshot: IDs de cidades (entidades de referência, não PII).
--   Toda a tabela está sujeita à política de retenção de logs (doc 17 §9).
--
-- Dependências:
--   - 0000_init (extensões pgcrypto)
--   - 0001_bent_mac_gargan (tabelas organizations, users, permissions, roles,
--                           role_permissions)
--
-- Idempotente:
--   CREATE TABLE IF NOT EXISTS; CREATE INDEX IF NOT EXISTS;
--   INSERT ... ON CONFLICT DO NOTHING em permissions e role_permissions.
--
-- Rollback manual (não executar em produção sem decisão explícita):
--   DROP TABLE IF EXISTS assistant_queries;
--   DELETE FROM role_permissions WHERE permission_id IN (
--     SELECT id FROM permissions WHERE key = 'ai_assistant:use');
--   DELETE FROM permissions WHERE key = 'ai_assistant:use';
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tabela assistant_queries
--    Log imutável de consultas ao copiloto interno (superfície B, doc 22 §12).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "assistant_queries" (
  "id"                  uuid        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Multi-tenant root — isolamento garantido desde o primeiro registro (§8 CLAUDE.md).
  "organization_id"     uuid        NOT NULL,

  -- Usuário que realizou a consulta.
  -- NULL reservado para consultas de sistema futuras; hoje sempre preenchido.
  -- ON DELETE SET NULL: preserva o log mesmo após remoção do usuário.
  "user_id"             uuid,

  -- Pergunta APÓS DLP — JAMAIS armazenar a versão original com PII bruta aqui.
  -- O serviço LangGraph DEVE aplicar dlp_filter() antes de chamar a rota de persistência.
  -- Exemplo pós-DLP: "Quantos leads entraram hoje em Ariquemes?"
  "question_redacted"   text        NOT NULL,

  -- Resumo da resposta gerada pelo copiloto.
  -- NULL quando a consulta falhou, expirou ou foi interrompida antes da geração.
  "answer_summary"      text,

  -- Ferramentas invocadas durante o processamento.
  -- Formato: [{name: "leads_count", args: {city_ids: [...]}, result_summary: "42"}].
  -- Sem PII bruta nos args: apenas IDs de entidades e valores agregados.
  "tools_called"        jsonb,

  -- Snapshot do escopo de cidade do usuário no momento da consulta.
  -- Auditoria histórica: imutável após criação.
  -- Formato: {city_ids: ["<uuid>", ...], scope_type: "city" | "global"}.
  -- IDs de cidades não são PII (entidades geográficas de referência).
  "city_scope_snapshot" jsonb,

  -- Registro imutável (append-only): sem updated_at.
  "created_at"          timestamptz NOT NULL DEFAULT now(),

  -- -------------------------------------------------------------------------
  -- Foreign Keys (nomeadas explicitamente)
  -- -------------------------------------------------------------------------

  CONSTRAINT "fk_assistant_queries_organization"
    FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT,

  CONSTRAINT "fk_assistant_queries_user"
    FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL
);
--> statement-breakpoint

-- Índice composto B-tree: auditoria + histórico por usuário/org/data.
-- Cobre: "consultas do usuário X na org Y" e "consultas da org Y no período T".
CREATE INDEX IF NOT EXISTS "idx_assistant_queries_org_user_created_at"
  ON "assistant_queries" ("organization_id", "user_id", "created_at");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Permissão ai_assistant:use
--    Gate de acesso ao copiloto interno — não concede leitura de dados.
--    Cada consulta ainda exige a permissão do domínio (§12.3 doc 22).
-- ---------------------------------------------------------------------------

INSERT INTO "permissions" ("key", "description")
VALUES (
  'ai_assistant:use',
  'Conversar com o copiloto interno — acesso à interface de consulta em linguagem natural. '
  'Não concede leitura de dados: cada consulta ainda exige a permissão do domínio (§12.3 doc 22).'
)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Conceder ai_assistant:use aos 6 roles operacionais
--
-- Todos os roles operacionais recebem: o poder real de cada um já vem das
-- suas permissões de leitura de dados — o copiloto apenas as expõe via
-- linguagem natural respeitando o RBAC e o escopo de cidade de cada usuário.
-- (docs/22-agente-interno-acoes.md §12.3)
-- ---------------------------------------------------------------------------

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.key IN ('admin', 'gestor_geral', 'gestor_regional', 'agente', 'operador', 'leitura')
  AND p.key = 'ai_assistant:use'
ON CONFLICT DO NOTHING;
