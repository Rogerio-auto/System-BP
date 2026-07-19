-- =============================================================================
-- 0092_notifications_severity.sql — Persiste severidade na linha da notificação (F26-S03).
--
-- Contexto (doc 23 §13, gap G6): `severity` hoje só viaja no payload do socket
-- (realtime.ts) — a linha `notifications` não tem a coluna, então a central
-- REST (GET /api/notifications) não sabe diferenciar crítico/aviso/informativo
-- e a severidade some no reload da página.
--
-- notifications.severity: texto restrito por CHECK, mesmo domínio de valores
-- de notification_rules.severity (0076) e NotificationSocketSeverity
-- (realtime.ts) — 'info' | 'warning' | 'critical'.
--
-- DEFAULT 'info' + coluna aditiva: linhas existentes (legado) recebem o valor
-- neutro sem necessidade de backfill (fora de escopo deste slot).
--
-- Idempotente: ADD COLUMN IF NOT EXISTS; DROP CONSTRAINT IF EXISTS antes de
-- recriar o CHECK (permite reexecução segura da migration).
--
-- Rollback manual (em caso de necessidade — migrations mergeadas não devem
-- ser revertidas; prefira criar nova migration corretiva):
--   ALTER TABLE notifications DROP CONSTRAINT IF EXISTS chk_notifications_severity;
--   ALTER TABLE notifications DROP COLUMN IF EXISTS severity;
-- =============================================================================

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS severity text NOT NULL DEFAULT 'info';
--> statement-breakpoint

ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS chk_notifications_severity;
--> statement-breakpoint

ALTER TABLE notifications
  ADD CONSTRAINT chk_notifications_severity
    CHECK (severity IN ('info', 'warning', 'critical'));
