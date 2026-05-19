-- =============================================================================
-- 0023_ai_conversation.sql — Schema de IA: estado de conversa, logs de decisão
--                            e versionamento de prompts. Mais alterações:
--                            sent_at em credit_simulations e city_id nullable em leads.
--
-- Contexto: F3-S01 (schema base LangGraph) + expansão de escopo do CTO.
--
-- Dependências:
--   - 0000_init              (pgcrypto, gen_random_uuid)
--   - 0001_bent_mac_gargan   (organizations)
--   - 0007_leads_core        (leads, customers)
--   - 0001/users             (users)
--   - 0016_credit_core       (credit_simulations)
--
-- Tabelas criadas (em ordem de dependência):
--   1. ai_conversation_states — checkpoint de estado por conversa LangGraph
--   2. ai_decision_logs       — log append-only de decisões de nó (12 meses retenção)
--   3. prompt_versions        — catálogo versionado de prompts (imutável após publicação)
--
-- Alterações em tabelas existentes:
--   4. credit_simulations.sent_at — timestamptz NULL (quando a simulação foi enviada ao lead)
--   5. leads.city_id DROP NOT NULL — nullable: o agente cria o lead antes de saber a cidade
--
-- LGPD (doc 17):
--   - ai_conversation_states.state jsonb: NÃO deve conter CPF/RG/document_number brutos.
--     Apenas IDs internos. DLP aplicado pelo serviço Python antes de persistir (§8.4).
--   - ai_decision_logs.decision jsonb: mesma regra. Retenção 12 meses (§6.1 + doc 03 §14).
--   - ai_conversation_states.phone: PII de contato — pino.redact obrigatório (§8.3).
--   - prompt_versions: sem PII.
--   - credit_simulations.sent_at: dado de funil (não PII).
--   - leads.city_id: alteração estrutural sem impacto em PII.
--
-- LGPD Checklist (§14.2):
--   [x] Finalidade: persistência de estado do agente IA para retomada de conversa;
--        audit trail de decisões; controle de versão de prompts; rastreio de envio de simulação.
--   [x] Base legal: execução de contrato (Art. 7º II) + legítimo interesse (Art. 7º IX)
--        para o fluxo de concessão de microcrédito.
--   [x] Necessidade: sem campos por garantia — cada coluna tem finalidade documentada.
--   [x] PII: state/decision jsonb não armazenam PII bruta (CPF/RG). Phone em conv_states
--        é necessário para roteamento. Redact configurado.
--   [x] Retenção: ai_decision_logs 12 meses. ai_conversation_states 90 dias para state jsonb.
--   [x] DLP: aplicado no serviço Python antes de persistir state/decision.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. ai_conversation_states — Estado durável de conversa por turno LangGraph
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ai_conversation_states" (
    "id"                        uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

    -- Multi-tenant root. Denormalizado para city-scope sem JOIN.
    "organization_id"           uuid        NOT NULL,

    -- Identificador interno da conversa. UNIQUE: 1 estado por conversa.
    -- LangGraph usa este ID para carregar/salvar o checkpoint.
    "conversation_id"           uuid        NOT NULL,

    -- ID da conversa no sistema externo Chatwoot (string — não assumir tipo do Chatwoot).
    -- null = conversa ainda não sincronizada com o Chatwoot.
    "chatwoot_conversation_id"  text,

    -- Lead associado. null = lead ainda não criado (primeiro contato).
    -- ON DELETE SET NULL: lead deletado não destrói histórico de conversa.
    "lead_id"                   uuid,

    -- Cliente identificado (CPF obtido). null = não convertido ainda.
    -- ON DELETE SET NULL: customer deletado preserva o histórico.
    "customer_id"               uuid,

    -- Telefone normalizado (apenas dígitos, ex: 5569912345678).
    -- LGPD: PII de contato — pino.redact obrigatório antes de logar.
    "phone"                     text        NOT NULL,

    -- Nome do nó LangGraph onde a conversa está pausada.
    -- Ex: "classify_intent", "collect_missing_profile_data", "generate_simulation".
    "current_node"              text,

    -- Versão SemVer do grafo (ex: "v1.0.0"). Identifica conversas em versões antigas.
    "graph_version"             text,

    -- Snapshot serializado do ConversationState.
    -- LGPD CRÍTICO: NÃO armazenar CPF/RG/document_number em texto puro.
    -- Apenas IDs internos + dados de fluxo. DLP aplicado antes de persistir.
    "state"                     jsonb       NOT NULL DEFAULT '{}'::jsonb,

    -- Última mensagem recebida. Job de expiração usa para detectar inatividade.
    "last_message_at"           timestamptz,

    "created_at"                timestamptz NOT NULL DEFAULT now(),
    "updated_at"                timestamptz NOT NULL DEFAULT now(),

    -- Soft-delete: encerrar conversa sem perder checkpoint para auditoria.
    "deleted_at"                timestamptz
);
--> statement-breakpoint

-- FK: ai_conversation_states → organizations
DO $$ BEGIN
  ALTER TABLE "ai_conversation_states"
    ADD CONSTRAINT "fk_ai_conv_states_organization"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- FK: ai_conversation_states → leads
DO $$ BEGIN
  ALTER TABLE "ai_conversation_states"
    ADD CONSTRAINT "fk_ai_conv_states_lead"
    FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- FK: ai_conversation_states → customers
DO $$ BEGIN
  ALTER TABLE "ai_conversation_states"
    ADD CONSTRAINT "fk_ai_conv_states_customer"
    FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- UNIQUE: 1 estado por conversa (regra de negócio crítica).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_ai_conv_states_conversation_id"
    ON "ai_conversation_states" ("conversation_id");
--> statement-breakpoint

-- Índice: conversas ativas de um lead (WHERE lead_id IS NOT NULL).
CREATE INDEX IF NOT EXISTS "idx_ai_conv_states_lead"
    ON "ai_conversation_states" ("lead_id")
    WHERE "lead_id" IS NOT NULL;
--> statement-breakpoint

-- Índice: job de expiração por org (conversas inativas > N horas).
CREATE INDEX IF NOT EXISTS "idx_ai_conv_states_org_last_message"
    ON "ai_conversation_states" ("organization_id", "last_message_at");
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 2. ai_decision_logs — Log append-only de decisões de nó do LangGraph
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ai_decision_logs" (
    "id"               uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

    -- Multi-tenant root. Denormalizado para analytics sem JOIN.
    "organization_id"  uuid        NOT NULL,

    -- Conversa que originou esta decisão.
    -- Sem FK para ai_conversation_states: o log deve sobreviver após conversa purgada.
    "conversation_id"  uuid        NOT NULL,

    -- Lead associado no momento da decisão. null = pré-identificação.
    -- ON DELETE SET NULL: lead deletado não destrói o audit trail.
    "lead_id"          uuid,

    -- Cliente associado no momento da decisão. null = não convertido ainda.
    -- ON DELETE SET NULL: customer deletado não destrói o audit trail.
    "customer_id"      uuid,

    -- Nome do nó que tomou a decisão (ex: "classify_intent").
    "node_name"        text        NOT NULL,

    -- Intenção classificada neste nó (ex: "quer_simular"). null = nó não classificou.
    "intent"           text,

    -- Chave canônica do prompt sem versão (ex: "intent_classifier").
    -- null = nó não fez chamada LLM.
    "prompt_key"       text,

    -- Versão do prompt no formato "key@vN" (ex: "intent_classifier@v3").
    -- null = nó não fez chamada LLM.
    "prompt_version"   text,

    -- Identificador do modelo LLM utilizado (ex: "anthropic/claude-3-5-sonnet").
    -- null = nó não fez chamada LLM.
    "model"            text,

    -- Tokens de entrada (prompt + contexto). null = sem chamada LLM.
    "tokens_in"        integer,

    -- Tokens de saída (completion). null = sem chamada LLM.
    "tokens_out"       integer,

    -- Latência da chamada ao LLM em ms. null = sem chamada LLM.
    "latency_ms"       integer,

    -- Output estruturado da decisão do nó.
    -- LGPD CRÍTICO: NÃO incluir CPF/RG/document_number/senhas.
    -- Apenas IDs internos, intenções e dados de fluxo. DLP antes de persistir.
    "decision"         jsonb       NOT NULL DEFAULT '{}'::jsonb,

    -- Mensagem de erro se o nó falhou. null = sucesso. Sem stack traces com PII.
    "error"            text,

    -- ID de correlação do request (X-Correlation-Id). Correlaciona logs do mesmo request.
    "correlation_id"   uuid        NOT NULL,

    -- Timestamp de inserção. Única dimensão de tempo (append-only).
    -- Job de retenção: purgar WHERE created_at < now() - interval '12 months'.
    "created_at"       timestamptz NOT NULL DEFAULT now()
    -- SEM updated_at: tabela append-only, imutável após inserção.
);
--> statement-breakpoint

-- FK: ai_decision_logs → organizations
DO $$ BEGIN
  ALTER TABLE "ai_decision_logs"
    ADD CONSTRAINT "fk_ai_decision_logs_organization"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- FK: ai_decision_logs → leads
DO $$ BEGIN
  ALTER TABLE "ai_decision_logs"
    ADD CONSTRAINT "fk_ai_decision_logs_lead"
    FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- FK: ai_decision_logs → customers
DO $$ BEGIN
  ALTER TABLE "ai_decision_logs"
    ADD CONSTRAINT "fk_ai_decision_logs_customer"
    FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Índice: timeline de decisões de uma conversa (query mais frequente).
CREATE INDEX IF NOT EXISTS "idx_ai_decision_logs_conversation_created"
    ON "ai_decision_logs" ("conversation_id", "created_at");
--> statement-breakpoint

-- Índice: analytics de custo e volume por organização.
CREATE INDEX IF NOT EXISTS "idx_ai_decision_logs_org_created"
    ON "ai_decision_logs" ("organization_id", "created_at");
--> statement-breakpoint

-- Índice: histórico de decisões de um lead específico (parcial).
CREATE INDEX IF NOT EXISTS "idx_ai_decision_logs_lead"
    ON "ai_decision_logs" ("lead_id")
    WHERE "lead_id" IS NOT NULL;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 3. prompt_versions — Catálogo versionado de prompts (imutável após publicação)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "prompt_versions" (
    "id"                uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

    -- Chave canônica snake_case (ex: "intent_classifier"). Imutável após criação.
    "key"               text        NOT NULL,

    -- Versão inteira, começa em 1. Incrementa a cada mudança de conteúdo.
    "version"           integer     NOT NULL,

    -- Modelo LLM recomendado (ex: "anthropic/claude-3-5-sonnet").
    -- null = usar modelo padrão do serviço.
    "model_recommended" text,

    -- SHA-256 do campo `body`. Checksum de integridade do prompt.
    "content_hash"      text        NOT NULL,

    -- true = versão em uso pelos agentes. Apenas 1 por key deve ser true.
    -- Aplicação desativa versão anterior em transação antes de ativar nova.
    "active"            boolean     NOT NULL DEFAULT false,

    -- Conteúdo completo do prompt (pode ter placeholders: {lead_name}, {city_name}).
    -- Imutável após publicação. NUNCA incluir dados reais de clientes.
    "body"              text        NOT NULL,

    -- Changelog desta versão: o que mudou e por quê.
    "notes"             text,

    -- Usuário interno que publicou esta versão.
    -- ON DELETE SET NULL: usuário deletado não invalida o histórico.
    "created_by"        uuid,

    "created_at"        timestamptz NOT NULL DEFAULT now()
    -- SEM updated_at: prompt_versions é imutável após criação.
);
--> statement-breakpoint

-- FK: prompt_versions → users
DO $$ BEGIN
  ALTER TABLE "prompt_versions"
    ADD CONSTRAINT "fk_prompt_versions_created_by"
    FOREIGN KEY ("created_by") REFERENCES "public"."users"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- UNIQUE: (key, version) — chave de negócio imutável do prompt.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_prompt_versions_key_version"
    ON "prompt_versions" ("key", "version");
--> statement-breakpoint

-- Índice parcial: versão ativa por chave — query frequente do agente.
-- WHERE active = true mantém o índice extremamente enxuto (1 row por key).
CREATE INDEX IF NOT EXISTS "idx_prompt_versions_active_key"
    ON "prompt_versions" ("key")
    WHERE "active" = true;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 4. credit_simulations.sent_at — quando a simulação foi enviada ao lead
-- ---------------------------------------------------------------------------
-- Consumida por F3-S11 (endpoint mark_simulation_sent).
-- null = simulação ainda não enviada ao lead.
-- Imutável após set: nunca deve ser revertida para null.
ALTER TABLE "credit_simulations"
    ADD COLUMN IF NOT EXISTS "sent_at" timestamptz;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 5. leads.city_id — remover NOT NULL
-- ---------------------------------------------------------------------------
-- O agente WhatsApp cria o lead no primeiro contato (get_or_create_lead),
-- antes de o nó identify_city ser executado.
-- null = cidade ainda não identificada para este lead.
ALTER TABLE "leads"
    ALTER COLUMN "city_id" DROP NOT NULL;
--> statement-breakpoint

-- Recriar índice de escopo multi-cidade como parcial (WHERE city_id IS NOT NULL)
-- para excluir leads em fase pré-identificação de cidade.
DROP INDEX IF EXISTS "idx_leads_org_city";
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_leads_org_city"
    ON "leads" ("organization_id", "city_id")
    WHERE "city_id" IS NOT NULL;
