-- =============================================================================
-- 0091_conversations_ai_handoff.sql — Trava de idempotência do handoff da IA.
--
-- Contexto (bug de produção): toda mensagem inbound do cidadão re-disparava
-- o handoff da IA (gate só olhava assigned_user_id, não status) e o handoff
-- em si não tinha trava de estado (só idempotência por messageId) — o
-- resultado era reenvio do fallback "Um atendente vai te responder..." a
-- cada nova mensagem, mesmo depois da conversa já ter saído de 'open'.
--
-- conversations.ai_handoff_at: timestamp do PRIMEIRO handoff disparado pela
-- IA para esta conversa. NULL = handoff ainda não ocorreu. Setado via UPDATE
-- atômico (WHERE ai_handoff_at IS NULL) em triggerLivechatHandoff — a
-- corrida "primeiro a marcar, ganha" garante disparo único mesmo sob
-- concorrência (reprocessamento de fila, mensagens quase simultâneas).
--
-- Nullable, sem default — coluna aditiva, não quebra linhas existentes.
-- =============================================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ai_handoff_at timestamptz;
