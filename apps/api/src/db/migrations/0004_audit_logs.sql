-- =============================================================================
-- 0004_audit_logs.sql — Tabela audit_logs append-only para rastreabilidade
--                        completa de ações sensíveis na plataforma.
--
-- Contexto: F1-S16. Destrava T1.16 (tela /admin/audit).
--
-- Características:
--   1. Append-only — sem UPDATE ou DELETE. Linhas são imutáveis por design.
--   2. before/after capturam diff do recurso antes e depois da mutação.
--   3. Índices otimizados para as queries da tela /admin/audit:
--      - Filtro por (org, período) — mais comum.
--      - Filtro por (resource_type, resource_id) — timeline de um recurso.
--      - Filtro por actor_user_id — auditoria por ator.
--   4. Multi-tenant: organization_id em todo registro.
--   5. correlation_id propaga contexto de request/evento de origem.
--
-- LGPD §8.5 — AVISO CRÍTICO:
--   Os campos before/after PODEM conter PII (CPF, e-mail, etc.).
--   RESPONSABILIDADE DO CALLER: aplicar redactSensitive() antes de chamar
--   auditLog(). O helper não redacta automaticamente — ver audit.ts.
--   Retenção mínima: 5 anos para ações de crédito (docs/10 §5.2).
--   No MVP não há TTL automático — job de retenção será implementado em F2.
--
-- Política de retenção (MVP):
--   - Sem TTL automático neste sprint.
--   - Job de purga/arquivamento planejado para F2 (ref: docs/10 §5.2).
--   - Retenção mínima: 5 anos para ações de crédito; 2 anos para demais.
--   - Arquivamento para cold storage (S3-compatible) antes de purga.
--
-- Relacionamentos:
--   - organization_id → organizations(id) ON DELETE restrict.
--   - actor_user_id → users(id) ON DELETE set null (user pode ser desativado).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tabela audit_logs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "audit_logs" (
    -- Identificador único do registro de auditoria
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

    -- Multi-tenant: todo registro pertence a uma organização
    "organization_id" uuid NOT NULL,

    -- Ator: quem executou a ação
    -- null para ações de sistema (worker, job, integração)
    "actor_user_id" uuid,

    -- Role do ator no momento da ação (snapshot — não muda se role mudar depois)
    -- null para ações de sistema
    "actor_role" text,

    -- Ação executada. Formato recomendado: "<dominio>.<verbo>"
    -- Ex: "leads.created", "kanban.stage_updated", "user.password_changed"
    "action" text NOT NULL,

    -- Tipo do recurso afetado. Ex: "lead", "user", "feature_flag"
    "resource_type" text NOT NULL,

    -- UUID do recurso afetado
    "resource_id" text NOT NULL,

    -- Estado do recurso ANTES da mutação (snapshot parcial ou completo).
    -- LGPD: caller deve aplicar redactSensitive() antes de persistir.
    -- null para ações de criação (não há estado anterior).
    "before" jsonb,

    -- Estado do recurso APÓS a mutação (snapshot parcial ou completo).
    -- LGPD: caller deve aplicar redactSensitive() antes de persistir.
    -- null para ações de exclusão (não há estado posterior).
    "after" jsonb,

    -- IP do cliente que originou a requisição (IPv4 ou IPv6)
    -- null para ações de sistema sem contexto HTTP
    "ip" text,

    -- User-Agent do cliente (truncado a 512 chars para evitar abuso)
    -- null para ações de sistema
    "user_agent" text,

    -- Correlation ID propagado do request/evento de origem
    -- Permite rastrear toda a cadeia: HTTP request → mutação → audit log → evento outbox
    "correlation_id" uuid,

    -- Timestamp de criação (imutável — nunca atualizado)
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Foreign Keys
-- ---------------------------------------------------------------------------

-- FK para organizations — restringir delete para preservar auditoria
DO $$ BEGIN
  ALTER TABLE "audit_logs"
    ADD CONSTRAINT "fk_audit_logs_organization"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
    ON DELETE restrict ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- FK para users — set null ao invés de restrict/cascade
-- Usuários podem ser desativados/removidos sem apagar o histórico de auditoria.
-- actor_user_id fica null: "ação executada por usuário removido".
DO $$ BEGIN
  ALTER TABLE "audit_logs"
    ADD CONSTRAINT "fk_audit_logs_actor_user"
    FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Índices
-- ---------------------------------------------------------------------------

-- Índice principal: filtro por organização + período (tela /admin/audit, query padrão)
-- DESC para ordenação natural (mais recente primeiro) sem sort adicional
CREATE INDEX IF NOT EXISTS "idx_audit_logs_org_created"
  ON "audit_logs" USING btree ("organization_id", "created_at" DESC);
--> statement-breakpoint

-- Índice para timeline de um recurso específico (ex: histórico de um lead)
CREATE INDEX IF NOT EXISTS "idx_audit_logs_resource"
  ON "audit_logs" USING btree ("resource_type", "resource_id");
--> statement-breakpoint

-- Índice para auditoria por ator (ex: "o que o usuário X fez?")
-- Índice parcial: exclui linhas sem actor (ações de sistema — não filtradas por usuário)
CREATE INDEX IF NOT EXISTS "idx_audit_logs_actor_user"
  ON "audit_logs" USING btree ("actor_user_id")
  WHERE "actor_user_id" IS NOT NULL;
--> statement-breakpoint

-- Índice para filtro por correlation_id (rastrear cadeia de uma requisição)
CREATE INDEX IF NOT EXISTS "idx_audit_logs_correlation"
  ON "audit_logs" USING btree ("correlation_id")
  WHERE "correlation_id" IS NOT NULL;
