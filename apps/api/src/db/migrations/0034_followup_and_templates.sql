-- =============================================================================
-- 0034_followup_and_templates.sql — Schema da régua de follow-up automático.
--
-- Contexto: F5-S01.
-- Dependências:
--   - 0000_init          (pgcrypto, gen_random_uuid, set_updated_at function)
--   - 0001_bent_mac_gargan (organizations)
--   - 0007_leads_core    (leads)
--
-- Tabelas criadas (em ordem de dependência):
--   1. whatsapp_templates — catálogo de templates Meta aprovados (HSM)
--   2. followup_rules     — catálogo de regras da régua (trigger + wait + template)
--   3. followup_jobs      — instâncias agendadas de follow-up por lead/regra
--
-- Gating obrigatório (triple-gate — zero disparo acidental em produção):
--   Nenhuma mensagem é enviada sem que as 3 condições sejam verdadeiras:
--     1. feature_flags.followup.enabled = 'enabled'
--     2. feature_flags.followup.scheduler.enabled = 'enabled'
--     3. followup_rules.is_active = true (por regra)
--   is_active default false garante que o schema pode ser deployado em produção
--   sem ativar nenhum envio. Ativação requer decisão explícita do cliente.
--
-- Triggers:
--   - trg_whatsapp_templates_updated_at  (set_updated_at)
--   - trg_followup_rules_updated_at      (set_updated_at)
--   - trg_followup_jobs_updated_at       (set_updated_at)
--
-- Índices notáveis:
--   - idx_followup_jobs_scheduled: parcial WHERE status='scheduled' —
--     scanner de alta frequência do worker (F5-S03). Exclui registros
--     históricos (sent/failed/cancelled) que crescem sem limite.
--
-- LGPD:
--   - whatsapp_templates.body contém apenas texto estrutural com variáveis
--     ({{1}}, {{2}}). Sem PII no template em si.
--   - followup_jobs.lead_id aponta para entidade com PII — não logar.
--   - followup_jobs.sent_message_id (wamid Meta) não é PII por si só.
--   - Retenção de jobs: limpar jobs sent/failed/cancelled após 90 dias
--     (job de purga futuro — ver docs/17-lgpd-protecao-dados.md §9).
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. whatsapp_templates — Catálogo de templates Meta aprovados
--
-- Templates são mensagens pré-aprovadas pela Meta Business Suite.
-- Apenas templates com status='approved' podem ser enviados em janelas
-- fora de 24h (HSM — Highly Structured Messages).
--
-- Um template pertence a uma organização (multi-tenant).
-- O name é o slug interno único por organização.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "whatsapp_templates" (
    "id"               uuid   PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

    -- Multi-tenant: todo template pertence a uma organização.
    "organization_id"  uuid   NOT NULL,

    -- ID opaco retornado pela Meta Business API ao criar/sincronizar templates.
    -- Usado para correlacionar webhooks de aprovação/rejeição/pausa.
    "meta_template_id" text   NOT NULL,

    -- Slug interno único por organização.
    -- Ex: "followup_d1", "followup_d3", "followup_d7", "followup_d15".
    -- Permite referenciar templates em código sem depender do ID externo Meta.
    "name"             text   NOT NULL,

    -- Idioma no formato BCP-47 simplificado da Meta (ex: pt_BR, en_US).
    -- A Meta exige o idioma ao enviar o template via API.
    "language"         text   NOT NULL DEFAULT 'pt_BR',

    -- Categoria segundo política de uso Meta.
    -- 'utility': notificações transacionais (confirmações, status de proposta).
    -- 'marketing': ofertas/promoções (custo por sessão mais alto).
    -- 'authentication': OTPs e verificação de identidade.
    -- Para follow-up de crédito: 'utility' (notificação de status).
    "category"         text   NOT NULL
        CONSTRAINT "chk_whatsapp_templates_category"
            CHECK ("category" IN ('utility', 'marketing', 'authentication')),

    -- Corpo com variáveis no formato Meta: {{1}}, {{2}}, etc.
    -- Sem PII bruta — apenas texto estrutural. Variáveis preenchidas no envio.
    "body"             text   NOT NULL,

    -- Nomes semânticos das variáveis em ordem posicional ({{1}}, {{2}}, ...).
    -- Ex: ARRAY['nome_lead', 'link_simulacao']
    -- Permite ao worker mapear campos sem hardcode.
    "variables"        text[] NOT NULL DEFAULT ARRAY[]::text[],

    -- Status de aprovação pela Meta.
    -- 'pending'  → aguardando revisão (pode levar horas a dias).
    -- 'approved' → aprovado — pode ser usado em followup_rules e enviado.
    -- 'rejected' → recusado pela Meta — revisar conteúdo antes de resubmeter.
    -- 'paused'   → Meta pausou por violação de política.
    -- Somente 'approved' pode ser referenciado por followup_rules ativas.
    "status"           text   NOT NULL DEFAULT 'pending'
        CONSTRAINT "chk_whatsapp_templates_status"
            CHECK ("status" IN ('pending', 'approved', 'rejected', 'paused')),

    -- Idioma deve seguir formato ll_CC (ex: pt_BR, en_US, es_AR).
    CONSTRAINT "chk_whatsapp_templates_language_format"
        CHECK ("language" ~ '^[a-z]{2}_[A-Z]{2}$'),

    "created_at"       timestamptz NOT NULL DEFAULT now(),
    "updated_at"       timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- FK: whatsapp_templates → organizations
DO $$ BEGIN
  ALTER TABLE "whatsapp_templates"
    ADD CONSTRAINT "fk_whatsapp_templates_organization"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Unique: slug único por organização.
-- Permite referenciar templates pelo name em código e relatórios.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_whatsapp_templates_org_name"
    ON "whatsapp_templates" ("organization_id", "name");
--> statement-breakpoint

-- Índice: lookup por ID externo Meta (webhooks de status de aprovação).
CREATE INDEX IF NOT EXISTS "idx_templates_meta_id"
    ON "whatsapp_templates" USING btree ("meta_template_id");
--> statement-breakpoint

-- Trigger: atualiza updated_at em todo UPDATE.
CREATE OR REPLACE TRIGGER "trg_whatsapp_templates_updated_at"
  BEFORE UPDATE ON "whatsapp_templates"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 2. followup_rules — Catálogo de regras da régua de follow-up
--
-- Uma regra define QUANDO e COMO contatar um lead inativo.
-- Exemplos: d1 (24h), d3 (72h), d7 (168h), d15 (360h).
--
-- Triple-gate de segurança (nenhuma mensagem disparada sem todos os 3):
--   1. followup.enabled = 'enabled' (feature flag global)
--   2. followup.scheduler.enabled = 'enabled' (feature flag do worker)
--   3. is_active = true (regra específica)
-- is_active default false: regras cadastradas na UI não disparam sem ativação
-- explícita pós-decisão do cliente.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "followup_rules" (
    "id"                  uuid    PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

    -- Multi-tenant: toda regra pertence a uma organização.
    "organization_id"     uuid    NOT NULL,

    -- Slug identificador único por organização.
    -- Convenção: "d1" (1 dia), "d3", "d7", "d15".
    -- Usado em código para referenciar regras sem UUID.
    "key"                 text    NOT NULL,

    -- Nome descritivo para UI (ex: "Follow-up D+1", "Reengajamento D+7").
    "name"                text    NOT NULL,

    -- Tipo de gatilho para criação de followup_jobs.
    -- 'stage_inactivity': lead ficou no mesmo kanban stage sem atividade
    --   por wait_hours horas. Verificado pelo scheduler F5-S02.
    -- 'event_based': gatilho por evento do outbox (ex: lead.stage_changed).
    --   Suporte inicial apenas stage_inactivity; event_based reservado para futuro.
    "trigger_type"        text    NOT NULL
        CONSTRAINT "chk_followup_rules_trigger_type"
            CHECK ("trigger_type" IN ('stage_inactivity', 'event_based')),

    -- Tempo de espera em horas antes de acionar o follow-up.
    -- Ex: 24 (d1), 72 (d3), 168 (d7), 360 (d15). Deve ser > 0.
    "wait_hours"          integer NOT NULL
        CONSTRAINT "chk_followup_rules_wait_hours_positive"
            CHECK ("wait_hours" > 0),

    -- Template WhatsApp a enviar quando esta regra disparar.
    -- ON DELETE RESTRICT: template não pode ser excluído se referenciado.
    -- Worker valida template.status='approved' antes de enviar.
    "template_id"         uuid    NOT NULL,

    -- Filtro opcional por kanban stage atual do lead.
    -- null = aplica-se independente do stage.
    -- Alinhado com slugs de kanban_stages — validação app-level (sem FK).
    "applies_to_stage"    text,

    -- Filtro opcional por outcome do lead.
    -- null = aplica-se independente do outcome.
    -- Alinhado com valores de leads.metadata.outcome — validação app-level.
    "applies_to_outcome"  text,

    -- Controle de ativação (gate operacional por regra).
    -- false (default): regra cadastrada mas INATIVA — nenhum job criado.
    -- true: scheduler cria followup_jobs conforme trigger.
    -- Ver triple-gate acima: is_active=true é necessário mas não suficiente.
    "is_active"           boolean NOT NULL DEFAULT false,

    -- Máximo de tentativas de envio por lead/regra.
    -- Após max_attempts, scheduler não cria mais jobs para este lead + regra.
    -- Previne spam infinito em falhas de entrega. Default: 3.
    "max_attempts"        integer NOT NULL DEFAULT 3
        CONSTRAINT "chk_followup_rules_max_attempts_positive"
            CHECK ("max_attempts" > 0),

    "created_at"          timestamptz NOT NULL DEFAULT now(),
    "updated_at"          timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- FK: followup_rules → organizations
DO $$ BEGIN
  ALTER TABLE "followup_rules"
    ADD CONSTRAINT "fk_followup_rules_organization"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- FK: followup_rules → whatsapp_templates
-- ON DELETE RESTRICT: template referenciado por regra não pode ser excluído.
-- Protege integridade do catálogo de templates em uso.
DO $$ BEGIN
  ALTER TABLE "followup_rules"
    ADD CONSTRAINT "fk_followup_rules_template"
    FOREIGN KEY ("template_id") REFERENCES "public"."whatsapp_templates"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Unique: slug único por organização (d1, d3, d7, d15 são únicos por org).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_followup_rules_org_key"
    ON "followup_rules" ("organization_id", "key");
--> statement-breakpoint

-- Índice: query do scheduler — "todas as regras ativas da organização X".
-- Executado periodicamente pelo cron F5-S02 para decidir quais leads recebem jobs.
CREATE INDEX IF NOT EXISTS "idx_followup_rules_active"
    ON "followup_rules" USING btree ("organization_id", "is_active");
--> statement-breakpoint

-- Trigger: atualiza updated_at em todo UPDATE.
CREATE OR REPLACE TRIGGER "trg_followup_rules_updated_at"
  BEFORE UPDATE ON "followup_rules"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 3. followup_jobs — Instâncias agendadas de follow-up por lead/regra
--
-- Cada linha representa uma tentativa de envio programada para um lead
-- específico, sob uma regra específica, em um horário específico.
--
-- Ciclo de vida (status):
--   scheduled        → job criado pelo scheduler, aguardando scheduled_at.
--   triggered        → worker F5-S03 pegou o job (lock otimista via UPDATE).
--   sent             → template enviado. sent_message_id preenchido.
--   failed           → falha de envio. last_error preenchido.
--   cancelled        → cancelado antes do envio (lead atendido, regra off, etc.).
--   customer_replied → lead respondeu antes do envio (webhook inbound WhatsApp).
--
-- Idempotência:
--   unique (lead_id, rule_id, idempotency_key) previne duplicatas em
--   re-execuções do cron. Formato recomendado do idempotency_key:
--   "{YYYY-MM-DD}:{rule_key}" — ex: "2026-05-25:d1".
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "followup_jobs" (
    "id"               uuid    PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

    -- Multi-tenant: todo job pertence a uma organização.
    "organization_id"  uuid    NOT NULL,

    -- Lead alvo do follow-up.
    -- ON DELETE CASCADE: lead excluído (hard delete / LGPD) remove todos os jobs.
    -- Não faz sentido enviar mensagem para lead inexistente.
    "lead_id"          uuid    NOT NULL,

    -- Regra que originou o job.
    -- ON DELETE RESTRICT: regra com jobs ativos não pode ser excluída.
    -- Jobs históricos (sent/failed) mantêm referência para auditoria.
    "rule_id"          uuid    NOT NULL,

    -- Timestamp absoluto em que o worker deve processar o job.
    -- Calculado: now() + followup_rules.wait_hours * interval '1 hour'.
    -- Worker: WHERE status='scheduled' AND scheduled_at <= now()
    "scheduled_at"     timestamptz NOT NULL,

    -- Estado no pipeline de envio.
    "status"           text    NOT NULL DEFAULT 'scheduled'
        CONSTRAINT "chk_followup_jobs_status"
            CHECK ("status" IN (
                'scheduled',
                'triggered',
                'sent',
                'failed',
                'cancelled',
                'customer_replied'
            )),

    -- Número de tentativas realizadas (incluindo falhas).
    -- Scheduler não cria novo job se attempt_count >= followup_rules.max_attempts.
    "attempt_count"    integer NOT NULL DEFAULT 0
        CONSTRAINT "chk_followup_jobs_attempt_count_non_negative"
            CHECK ("attempt_count" >= 0),

    -- Descrição do último erro de envio (status='failed').
    -- Ex: "Meta API 131047: Template temporarily paused".
    -- null quando status != 'failed'.
    "last_error"       text,

    -- WhatsApp Message ID (wamid) retornado pela Meta API após envio bem-sucedido.
    -- Ex: "wamid.HBgLNTUxMTk5OTk5OTkV..."
    -- null até status='sent'. Correlaciona confirmações de entrega via webhooks.
    -- Não é PII por si só (ID opaco da Meta).
    "sent_message_id"  text,

    -- Chave de idempotência para evitar criação duplicada de jobs.
    -- Formato recomendado: "{YYYY-MM-DD}:{rule_key}" (ex: "2026-05-25:d1").
    -- Combinada com (lead_id, rule_id) no unique index abaixo.
    "idempotency_key"  text    NOT NULL,

    "created_at"       timestamptz NOT NULL DEFAULT now(),
    "updated_at"       timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- FK: followup_jobs → organizations
DO $$ BEGIN
  ALTER TABLE "followup_jobs"
    ADD CONSTRAINT "fk_followup_jobs_organization"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- FK: followup_jobs → leads
-- ON DELETE CASCADE: lead excluído remove todos os seus jobs (LGPD: direito ao esquecimento).
DO $$ BEGIN
  ALTER TABLE "followup_jobs"
    ADD CONSTRAINT "fk_followup_jobs_lead"
    FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- FK: followup_jobs → followup_rules
-- ON DELETE RESTRICT: regra com jobs (inclusive históricos) não pode ser excluída.
-- Preserva rastreabilidade de qual regra gerou cada envio.
DO $$ BEGIN
  ALTER TABLE "followup_jobs"
    ADD CONSTRAINT "fk_followup_jobs_rule"
    FOREIGN KEY ("rule_id") REFERENCES "public"."followup_rules"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Unique de idempotência: mesmo lead + regra + ciclo gera exatamente 1 job.
-- Previne duplicatas em re-execuções do cron scheduler sem transação distribuída.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_followup_jobs_lead_rule_idempotency"
    ON "followup_jobs" ("lead_id", "rule_id", "idempotency_key");
--> statement-breakpoint

-- Índice parcial: scanner principal do worker F5-S03.
-- Query: SELECT ... WHERE status='scheduled' AND scheduled_at <= now() LIMIT N FOR UPDATE SKIP LOCKED.
-- Parcial WHERE status='scheduled': exclui jobs em estados terminais (sent/failed/cancelled)
-- que crescem sem limite com o tempo. Mantém o índice enxuto conforme volume aumenta.
-- Crítico para performance em produção — sem este índice o worker faz full table scan.
CREATE INDEX IF NOT EXISTS "idx_followup_jobs_scheduled"
    ON "followup_jobs" USING btree ("status", "scheduled_at")
    WHERE "status" = 'scheduled';
--> statement-breakpoint

-- Índice: histórico de tentativas por lead (UI + auditoria).
-- Suporta: "todas as tentativas de follow-up para o lead X, mais recentes primeiro".
-- Usado pela ficha do lead em F5-S05.
CREATE INDEX IF NOT EXISTS "idx_followup_jobs_lead"
    ON "followup_jobs" USING btree ("lead_id", "created_at" DESC);
--> statement-breakpoint

-- Trigger: atualiza updated_at em todo UPDATE.
CREATE OR REPLACE TRIGGER "trg_followup_jobs_updated_at"
  BEFORE UPDATE ON "followup_jobs"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
