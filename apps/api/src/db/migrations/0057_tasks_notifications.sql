-- =============================================================================
-- 0057_tasks_notifications.sql — Tabelas `tasks`, `notifications` e
--                                 `notification_preferences` (F15-S03).
--
-- Contexto: Épico F15 — fundação reutilizável de tarefas e notificações.
--   - Tarefas (tasks): atribuídas a role key + cidade (D14). Consumidas pelos
--     Épicos E (win-back), F.3 (advocacia) e SPC (inclusão/exclusão).
--   - Notificações (notifications): in-app + histórico (D12).
--   - Preferências de canal (notification_preferences): opt-out por canal.
--
-- Decisões de design:
--   D12 — Notificações por usuário destinatário; preferências de canal separadas.
--   D14 — Tarefas atribuídas por role key (texto); sem FK rígida em role.
--          city_id NULLABLE = tarefa global (todas as cidades da org).
--          entity_type/entity_id: polimorfismo sem FK rígida.
--          claimed_by / completed_by: FK users ON DELETE SET NULL.
--
-- Multi-tenant: organization_id em todas as 3 tabelas.
--
-- Dependências:
--   - 0000_init      (extensões pgcrypto, pg_trgm, unaccent, citext)
--   - 0001 / F1-S01  (tabela organizations)
--   - 0002 / F1-S05  (tabela cities)
--   - 0001 / F1-S01  (tabela users)
--
-- Idempotente: CREATE TABLE IF NOT EXISTS; CREATE INDEX IF NOT EXISTS;
--   CREATE UNIQUE INDEX IF NOT EXISTS.
-- Rollback manual:
--   DROP TABLE IF EXISTS notification_preferences;
--   DROP TABLE IF EXISTS notifications;
--   DROP TABLE IF EXISTS tasks;
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. tasks
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "tasks" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL,

  -- Role key canônica do destinatário (doc 10 §3.1).
  -- Sem FK rígida — texto imutável; validação na borda Zod.
  "assignee_role"   text NOT NULL,

  -- Cidade alvo. NULL = tarefa global (todas as cidades da org).
  "city_id"         uuid,

  -- Tipo de tarefa: domínio fechado.
  "type"            text NOT NULL
    CONSTRAINT chk_tasks_type CHECK (
      "type" IN ('spc_inclusion', 'spc_removal', 'winback', 'lawyer_handoff', 'custom')
    ),

  -- Polimorfismo — entidade relacionada opcional.
  "entity_type"     text,
  "entity_id"       uuid,

  "title"           text NOT NULL,
  "description"     text,
  "due_at"          timestamptz,

  -- Ciclo de vida: open (default) → done | cancelled.
  "status"          text NOT NULL DEFAULT 'open'
    CONSTRAINT chk_tasks_status CHECK (
      "status" IN ('open', 'done', 'cancelled')
    ),

  -- Usuário que reclamou a tarefa (nullable — tarefa ainda não assumida).
  "claimed_by"      uuid,
  "claimed_at"      timestamptz,

  -- Usuário que concluiu/cancelou a tarefa.
  "completed_by"    uuid,
  "completed_at"    timestamptz,

  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_tasks_organization
    FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT,

  CONSTRAINT fk_tasks_city
    FOREIGN KEY ("city_id") REFERENCES "cities" ("id") ON DELETE RESTRICT,

  CONSTRAINT fk_tasks_claimed_by
    FOREIGN KEY ("claimed_by") REFERENCES "users" ("id") ON DELETE SET NULL,

  CONSTRAINT fk_tasks_completed_by
    FOREIGN KEY ("completed_by") REFERENCES "users" ("id") ON DELETE SET NULL
);
--> statement-breakpoint

-- Índice composto principal: fila de tarefas por org + role + cidade + status.
CREATE INDEX IF NOT EXISTS "idx_tasks_org_role_city_status"
  ON "tasks" ("organization_id", "assignee_role", "city_id", "status");
--> statement-breakpoint

-- Índice parcial de tarefas abertas: caso de uso mais comum (sin fila de trabalho).
-- Parcial WHERE status = 'open' mantém o índice enxuto excluindo done/cancelled.
-- NOTA: Drizzle não gera WHERE com valor literal ('open') — criado manualmente.
CREATE INDEX IF NOT EXISTS "idx_tasks_org_role_city_open"
  ON "tasks" ("organization_id", "assignee_role", "city_id")
  WHERE "status" = 'open';
--> statement-breakpoint

-- Lookup de tarefas por entidade relacionada (polimorfismo).
-- Parcial: somente registros com entity_type preenchido.
CREATE INDEX IF NOT EXISTS "idx_tasks_entity"
  ON "tasks" ("organization_id", "entity_type", "entity_id")
  WHERE "entity_type" IS NOT NULL;
--> statement-breakpoint

-- Dashboard pessoal: tarefas reclamadas por usuário específico.
-- Parcial: somente registros com claimed_by preenchido.
CREATE INDEX IF NOT EXISTS "idx_tasks_claimed_by"
  ON "tasks" ("claimed_by")
  WHERE "claimed_by" IS NOT NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. notifications
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "notifications" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL,

  -- Destinatário da notificação (FK cascade: apaga junto com o usuário).
  "user_id"         uuid NOT NULL,

  -- Tipo extensível via texto livre (ex: 'task_assigned', 'payment_overdue').
  "type"            text NOT NULL,

  -- Conteúdo exibido no sino.
  -- LGPD: pode ter PII indireta — não logar sem redact.
  "title"           text NOT NULL,
  "body"            text NOT NULL,

  -- Polimorfismo — entidade relacionada para deep-link (opcional).
  "entity_type"     text,
  "entity_id"       uuid,

  -- NULL = não lida; NOT NULL = lida (timestamp de leitura).
  "read_at"         timestamptz,

  "created_at"      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_notifications_organization
    FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT,

  CONSTRAINT fk_notifications_user
    FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
);
--> statement-breakpoint

-- Query principal do sino: notificações de um usuário (lidas e não lidas).
-- B-tree composto: user_id (equality) + read_at (IS NULL / ORDER).
CREATE INDEX IF NOT EXISTS "idx_notifications_user_read_at"
  ON "notifications" ("user_id", "read_at");
--> statement-breakpoint

-- Listagem administrativa + job de limpeza por retenção LGPD (§9 doc 17).
CREATE INDEX IF NOT EXISTS "idx_notifications_org_created_at"
  ON "notifications" ("organization_id", "created_at");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. notification_preferences
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "notification_preferences" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL,

  -- Usuário dono da preferência.
  "user_id"         uuid NOT NULL,

  -- Canal de entrega.
  "channel"         text NOT NULL
    CONSTRAINT chk_notification_preferences_channel CHECK (
      "channel" IN ('in_app', 'email', 'whatsapp')
    ),

  -- true (default) = canal ativo; false = desabilitado pelo usuário (opt-out).
  "enabled"         boolean NOT NULL DEFAULT true,

  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_notification_preferences_organization
    FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT,

  CONSTRAINT fk_notification_preferences_user
    FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
);
--> statement-breakpoint

-- Unique: 1 preferência por canal por usuário.
-- Permite upsert idempotente: INSERT ... ON CONFLICT (user_id, channel) DO UPDATE.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_notification_preferences_user_channel"
  ON "notification_preferences" ("user_id", "channel");
