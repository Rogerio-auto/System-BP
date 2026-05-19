-- =============================================================================
-- 0024_chatwoot_handoffs.sql — Tabela de handoffs para o Chatwoot. (F3-S37)
--
-- Contexto: F3-S07 entregou POST /internal/handoffs usando apenas outbox +
-- idempotency_keys. Este migration cria a tabela permanente chatwoot_handoffs
-- para persistência durável, auditoria e rastreio de SLA dos handoffs.
--
-- Dependências:
--   - 0000_init              (pgcrypto, gen_random_uuid)
--   - 0001_bent_mac_gargan   (organizations)
--   - 0007_leads_core        (leads)
--   - 0016_credit_core       (credit_simulations)
--   - 0002_cities_agents     (agents)
--
-- LGPD (doc 17 §8.1, §8.5):
--   - summary: campo sensível — pode conter contexto do cliente resumido pela IA.
--     Dado interno de atendimento. Acesso restrito por RBAC. Redact obrigatório
--     via pino.redact. NUNCA incluir no payload do outbox ou em logs sem redact.
--     DLP aplicado pelo caller (LangGraph) antes de enviar (doc 06 §8.4).
--
-- LGPD Checklist (§14.2):
--   [x] Finalidade: persistência de handoffs para auditoria, SLA e idempotência.
--   [x] Base legal: execução de contrato (Art. 7º II) + legítimo interesse (Art. 7º IX).
--   [x] Necessidade: todos os campos têm finalidade documentada — sem excesso.
--   [x] PII: summary é campo sensível (contexto do cliente); acesso restrito; redact.
--   [x] Retenção: política geral de dados de atendimento (não PII direta).
--   [x] DLP: aplicado pelo LangGraph antes de preencher summary (doc 06 §8.4).
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. chatwoot_handoffs — Registro persistente de handoffs para atendimento humano
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "chatwoot_handoffs" (
    -- PK: UUID gerado pelo Postgres. Retornado como handoff_id pela API.
    "id"                        uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

    -- Multi-tenant root. Denormalizado para city-scope sem JOIN.
    "organization_id"           uuid        NOT NULL,

    -- Lead que originou este handoff.
    -- null = handoff sem lead identificado (conversa anônima encerrada).
    -- ON DELETE SET NULL: lead deletado não destrói o histórico de handoff.
    "lead_id"                   uuid,

    -- Identificador interno da conversa da IA (referência por valor, não FK).
    -- null = handoff criado antes de ter um AI conversation UUID disponível.
    -- Não é FK explícita: conversa pode ser purgada após 90 dias (LGPD retenção).
    "conversation_id"           uuid,

    -- ID da conversa no Chatwoot (string — não assumir tipo numérico).
    "chatwoot_conversation_id"  text        NOT NULL,

    -- Motivo do handoff. Catálogo: doc 06 §7.4.
    -- Valores: cliente_solicitou_atendente | topico_fora_do_escopo |
    --          dados_incompletos_repetidos | simulacao_enviada_sem_resposta |
    --          ai_unavailable (F3-S34).
    "reason"                    text        NOT NULL,

    -- Resumo da conversa gerado pela IA para o atendente humano.
    --
    -- LGPD CRÍTICO (label lgpd-impact):
    --   Campo sensível — pode conter contexto do cliente.
    --   Regras: pino.redact obrigatório; NUNCA no outbox; DLP antes de persistir.
    --   null = handoff sem resumo (ex: fallback ai_unavailable sem contexto IA).
    "summary"                   text,

    -- Simulação de crédito relacionada, quando aplicável.
    -- null = handoff sem simulação. ON DELETE SET NULL.
    "simulation_id"             uuid,

    -- Agente humano atribuído no Chatwoot. null = ainda não atribuído.
    -- ON DELETE SET NULL: agente desligado não invalida histórico de handoffs.
    "assigned_agent_id"         uuid,

    -- Estado do handoff: requested | accepted | resolved | cancelled.
    -- Default: requested (estado inicial ao criar o handoff).
    "status"                    text        NOT NULL DEFAULT 'requested',

    -- Chave de idempotência do header Idempotency-Key.
    -- UNIQUE parcial por org (constraint abaixo): evita handoffs duplicados.
    "idempotency_key"           text        NOT NULL,

    "created_at"                timestamptz NOT NULL DEFAULT now(),
    "updated_at"                timestamptz NOT NULL DEFAULT now(),

    -- Soft-delete: preserva histórico sem quebrar a constraint de idempotência.
    "deleted_at"                timestamptz
);
--> statement-breakpoint

-- FK: chatwoot_handoffs → organizations (ON DELETE RESTRICT)
DO $$ BEGIN
  ALTER TABLE "chatwoot_handoffs"
    ADD CONSTRAINT "fk_chatwoot_handoffs_organization"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- FK: chatwoot_handoffs → leads (ON DELETE SET NULL)
DO $$ BEGIN
  ALTER TABLE "chatwoot_handoffs"
    ADD CONSTRAINT "fk_chatwoot_handoffs_lead"
    FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- FK: chatwoot_handoffs → credit_simulations (ON DELETE SET NULL)
DO $$ BEGIN
  ALTER TABLE "chatwoot_handoffs"
    ADD CONSTRAINT "fk_chatwoot_handoffs_simulation"
    FOREIGN KEY ("simulation_id") REFERENCES "public"."credit_simulations"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- FK: chatwoot_handoffs → agents (ON DELETE SET NULL)
DO $$ BEGIN
  ALTER TABLE "chatwoot_handoffs"
    ADD CONSTRAINT "fk_chatwoot_handoffs_assigned_agent"
    FOREIGN KEY ("assigned_agent_id") REFERENCES "public"."agents"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- UNIQUE parcial (organization_id, idempotency_key): idempotência por organização.
-- Inclui todos os registros (mesmo deleted — intencional para bloquear reenvios).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_chatwoot_handoffs_org_idempotency"
    ON "chatwoot_handoffs" ("organization_id", "idempotency_key");
--> statement-breakpoint

-- Índice: handoffs de uma conversa em uma organização.
-- Query frequente: "qual handoff desta conversa na org X?"
CREATE INDEX IF NOT EXISTS "idx_chatwoot_handoffs_org_conversation"
    ON "chatwoot_handoffs" ("organization_id", "conversation_id");
--> statement-breakpoint

-- Índice: handoffs por status — dashboard de SLA.
-- Query frequente: "handoffs pendentes (requested) na org X".
CREATE INDEX IF NOT EXISTS "idx_chatwoot_handoffs_org_status"
    ON "chatwoot_handoffs" ("organization_id", "status");
