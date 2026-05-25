-- =============================================================================
-- 0039_unique_org_phone_active.sql — Índice único parcial em ai_conversation_states
--                                    para prevenir race condition (F7-S03 item 7).
--
-- Contexto:
--   O endpoint PUT /internal/conversations/:id/state usa ON CONFLICT (conversation_id)
--   mas o processo de criação inicial em process-with-ai.ts usa INSERT ...
--   ON CONFLICT DO NOTHING sobre (organization_id, phone). Em alto paralelismo
--   (múltiplas mensagens WhatsApp simultâneas do mesmo número), duas instâncias
--   do outbox-publisher podem tentar inserir estados para o mesmo (org, phone)
--   quase simultaneamente, resultando em múltiplos registros ativos.
--
-- Solução:
--   UNIQUE INDEX parcial em (organization_id, phone) WHERE deleted_at IS NULL.
--   A condição parcial exclui conversas soft-deletadas, permitindo reativar
--   o mesmo número após encerrar uma conversa anterior.
--
-- Impacto no código:
--   - process-with-ai.ts: INSERT ... ON CONFLICT DO NOTHING já usa a condição
--     correta — sem alteração necessária no código de produção.
--   - O ON CONFLICT de conversations/routes.ts (PUT /state) usa conversation_id
--     — permanece inalterado (é o identificador canônico do LangGraph).
--
-- LGPD (doc 17 §8.4):
--   - phone: PII de contato necessária para roteamento (finalidade §3.3 item 1).
--   - Índice não armazena dados adicionais — apenas cria restrição estrutural.
--   - A constraint previne duplicação de estado que poderia causar inconsistência
--     nos dados do cidadão (violação de integridade é pior que ausência).
--
-- Rollback:
--   DROP INDEX IF EXISTS "uq_ai_conversation_states_org_phone_active";
-- =============================================================================

-- Índice único parcial: (organization_id, phone) WHERE deleted_at IS NULL.
-- Garante que exista no máximo 1 estado ativo por (org, phone).
-- A condição WHERE exclui conversas encerradas (soft-delete),
-- permitindo que o mesmo número seja atendido novamente após encerramento.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_ai_conversation_states_org_phone_active"
    ON "ai_conversation_states" ("organization_id", "phone")
    WHERE "deleted_at" IS NULL;
