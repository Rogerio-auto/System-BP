-- =============================================================================
-- 0036_collection.sql — Schema da régua de cobrança escalonada.
--
-- Contexto: F5-S06.
-- Dependências:
--   - 0000_init             (pgcrypto, gen_random_uuid, set_updated_at function)
--   - 0001_bent_mac_gargan  (organizations)
--   - 0007_leads_core       (leads, customers via 0016_credit_core)
--   - 0016_credit_core      (customers)
--   - 0034_followup_and_templates (whatsapp_templates — reutilizados na régua de cobrança)
--
-- Tabelas criadas (em ordem de dependência):
--   1. payment_dues      — parcelas a vencer/vencidas por customer/contrato
--   2. collection_rules  — regras temporais relativas à due_date (D-3, D+0, D+7, D+15...)
--   3. collection_jobs   — instâncias agendadas de cobrança por parcela/regra
--
-- Gating obrigatório (triple-gate — zero disparo acidental em produção):
--   Nenhuma mensagem de cobrança é enviada sem que as 3 condições sejam verdadeiras:
--     1. feature_flags.billing.enabled = 'enabled'
--     2. feature_flags.billing.scheduler.enabled = 'enabled'
--     3. collection_rules.is_active = true (por regra)
--   is_active default false: schema pode ser deployado em produção sem ativar cobrança.
--   Ativação requer decisão explícita do cliente (Banco do Povo / SEDEC-RO).
--
-- Triggers:
--   - trg_payment_dues_updated_at    (set_updated_at)
--   - trg_collection_rules_updated_at (set_updated_at)
--   - trg_collection_jobs_updated_at  (set_updated_at)
--
-- Índices notáveis:
--   - idx_payment_dues_status_due: parcial WHERE status IN ('pending','overdue') —
--     scanner do scheduler. Exclui parcelas terminais (paid/cancelled) que crescem
--     sem limite com o tempo.
--   - idx_collection_jobs_scheduled: parcial WHERE status='scheduled' —
--     scanner de alta frequência do worker. Performance crítica em carteira grande.
--
-- LGPD (doc 17 §14.2 — Art. 7º V — execução de contrato):
--   - Base legal: execução de contrato (Art. 7º V LGPD). Dados financeiros necessários
--     para cumprimento de obrigação contratual e regulatória.
--   - Nenhum CPF armazenado nesta migration — vínculo via customer_id (que tem PII cifrada).
--   - contract_reference: dado financeiro operacional, não PII estrito.
--   - Retenção: payment_dues mantidos 5 anos após status='paid'/'renegotiated'
--     (legislação fiscal — Lei 9.430/1996 e Decreto 3.048/1999).
--   - collection_jobs: jobs em estados terminais purgados após 90 dias
--     (job de purga futuro — ver docs/17-lgpd-protecao-dados.md §9).
--   - Outbox payloads desta migration carregam apenas IDs — sem PII bruta.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. payment_dues — Parcelas a vencer/vencidas por customer/contrato
--
-- Representa cada parcela de um contrato de crédito do Banco do Povo.
-- Entidade central da régua de cobrança — todo collection_job referencia
-- uma payment_due específica.
--
-- Ciclo de vida (status):
--   pending       → dentro do prazo, aguardando vencimento.
--   overdue       → vencida (due_date < today) sem pagamento registrado.
--   paid          → pagamento confirmado — paid_at preenchido.
--   renegotiated  → parcela renegociada — substituída por nova(s).
--   cancelled     → cancelada (rescisão, erro de importação, etc.).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "payment_dues" (
    "id"                  uuid          PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

    -- Multi-tenant: toda parcela pertence a uma organização.
    "organization_id"     uuid          NOT NULL,

    -- Cliente titular desta parcela (customers = lead convertido).
    -- ON DELETE RESTRICT: customer com parcelas não pode ser excluído.
    -- Preserva histórico de cobrança para auditoria fiscal (5 anos).
    "customer_id"         uuid          NOT NULL,

    -- Número identificador do contrato de crédito (dado financeiro operacional).
    -- Não contém CPF — vinculação com titular via customer_id.
    -- Ex: "BP-2026-00123", "2026/0045". Importado do sistema legado.
    "contract_reference"  text          NOT NULL,

    -- Número sequencial da parcela dentro do contrato (1 = primeira parcela).
    -- Unique (contract_reference, installment_number): chave de negócio para dedupe.
    -- Check: deve ser >= 1.
    "installment_number"  integer       NOT NULL
        CONSTRAINT "chk_payment_dues_installment_positive"
            CHECK ("installment_number" > 0),

    -- Data de vencimento (tipo date — sem hora, sem timezone).
    -- Vencimento é por data fiscal, não por momento exato.
    -- Scheduler calcula scheduled_at = due_date::timestamptz + wait_hours * interval '1 hour'.
    "due_date"            date          NOT NULL,

    -- Valor da parcela em reais. numeric(14,2): precisão exata, nunca float.
    -- Suporta até R$ 999.999.999.999,99. Check: deve ser positivo.
    "amount"              numeric(14,2) NOT NULL
        CONSTRAINT "chk_payment_dues_amount_positive"
            CHECK ("amount" > 0),

    -- Estado no ciclo de cobrança.
    -- O scheduler cria collection_jobs apenas para status IN ('pending', 'overdue').
    "status"              text          NOT NULL DEFAULT 'pending'
        CONSTRAINT "chk_payment_dues_status"
            CHECK ("status" IN ('pending', 'overdue', 'paid', 'renegotiated', 'cancelled')),

    -- Timestamp do registro de pagamento. null até status='paid'.
    -- Imutável após preenchido (auditoria financeira — não pode ser alterado retroativamente).
    "paid_at"             timestamptz,

    -- Origem do registro.
    -- 'manual': cadastrado por agente via UI (F5-S08).
    -- 'import': importado via planilha/API em lote (F5-S07 ou ETL legado).
    "origin"              text          NOT NULL
        CONSTRAINT "chk_payment_dues_origin"
            CHECK ("origin" IN ('manual', 'import')),

    -- Usuário que criou o registro. null para importações automáticas sem usuário.
    -- FK ON DELETE SET NULL: usuário excluído não invalida a parcela.
    "created_by"          uuid,

    "created_at"          timestamptz   NOT NULL DEFAULT now(),
    "updated_at"          timestamptz   NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- FK: payment_dues → organizations
DO $$ BEGIN
  ALTER TABLE "payment_dues"
    ADD CONSTRAINT "fk_payment_dues_organization"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- FK: payment_dues → customers
-- ON DELETE RESTRICT: customer com parcelas não pode ser excluído.
-- Garante integridade do histórico de cobrança para auditoria fiscal.
DO $$ BEGIN
  ALTER TABLE "payment_dues"
    ADD CONSTRAINT "fk_payment_dues_customer"
    FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- FK: payment_dues → users (created_by)
-- ON DELETE SET NULL: usuário excluído não invalida a parcela.
-- A rastreabilidade de criador é perdida, mas o registro persiste.
DO $$ BEGIN
  ALTER TABLE "payment_dues"
    ADD CONSTRAINT "fk_payment_dues_created_by"
    FOREIGN KEY ("created_by") REFERENCES "public"."users"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Unique: chave de negócio para dedupe de importação.
-- Mesmo contrato não pode ter duas parcelas de mesmo número.
-- Sem WHERE: inclui cancelled/renegotiated para evitar reutilização de números.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_payment_dues_contract_installment"
    ON "payment_dues" ("contract_reference", "installment_number");
--> statement-breakpoint

-- Índice parcial: scanner do scheduler de cobrança (F5-S07).
-- Query: SELECT ... WHERE status IN ('pending','overdue') AND due_date <= <threshold>.
-- Parcial: exclui paid/renegotiated/cancelled que crescem sem limite com o tempo.
-- Mantém o índice enxuto — crítico para performance em carteira grande de crédito.
CREATE INDEX IF NOT EXISTS "idx_payment_dues_status_due"
    ON "payment_dues" USING btree ("status", "due_date")
    WHERE "status" IN ('pending', 'overdue');
--> statement-breakpoint

-- Índice: histórico de parcelas por cliente, mais próximas do vencimento primeiro.
-- Query: "todas as parcelas do customer X ordenadas por due_date desc".
-- Suporta: ficha do cliente (F5-S08), relatório de inadimplência.
CREATE INDEX IF NOT EXISTS "idx_payment_dues_customer"
    ON "payment_dues" USING btree ("customer_id", "due_date" DESC);
--> statement-breakpoint

-- Trigger: atualiza updated_at em todo UPDATE.
CREATE TRIGGER "trg_payment_dues_updated_at"
  BEFORE UPDATE ON "payment_dues"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 2. collection_rules — Catálogo de regras da régua de cobrança escalonada
--
-- Espelho de followup_rules, adaptado para cobrança de parcelas.
-- Trigger relativo à due_date (não ao stage de inatividade do lead).
-- wait_hours pode ser negativo (dias antes) ou positivo (dias depois).
--
-- Exemplos:
--   D-3:  trigger_type='days_before_due', wait_hours=-72,  applies_to_status='pending'
--   D+0:  trigger_type='days_after_due',  wait_hours=0,    applies_to_status='overdue'
--   D+7:  trigger_type='days_after_due',  wait_hours=168,  applies_to_status='overdue'
--   D+15: trigger_type='days_after_due',  wait_hours=360,  applies_to_status='overdue'
--
-- Triple-gate de segurança (zero disparo sem todas as condições):
--   1. billing.enabled = 'enabled'
--   2. billing.scheduler.enabled = 'enabled'
--   3. is_active = true (esta regra)
-- is_active default false: regras cadastradas não disparam sem ativação explícita.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "collection_rules" (
    "id"                  uuid    PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

    -- Multi-tenant: toda regra pertence a uma organização.
    "organization_id"     uuid    NOT NULL,

    -- Slug único por organização. Ex: "d-3", "d0", "d7", "d15".
    -- Usado em idempotency_key dos collection_jobs.
    "key"                 text    NOT NULL,

    -- Nome descritivo para UI. Ex: "Aviso D-3", "Cobrança D+7".
    "name"                text    NOT NULL,

    -- Tipo de gatilho relativo à due_date da parcela.
    -- 'days_before_due' → antes do vencimento (wait_hours negativo ou zero, lembrete preventivo).
    -- 'days_after_due'  → após o vencimento  (wait_hours positivo ou zero, cobrança de inadimplência).
    "trigger_type"        text    NOT NULL
        CONSTRAINT "chk_collection_rules_trigger_type"
            CHECK ("trigger_type" IN ('days_before_due', 'days_after_due')),

    -- Offset em horas relativo à due_date.
    -- Negativo = antes: -72 (D-3 dias). Zero = no dia. Positivo = depois: 168 (D+7), 360 (D+15).
    -- scheduled_at = due_date::timestamptz + wait_hours * interval '1 hour'.
    -- Diferente de followup_rules.wait_hours (sempre positivo):
    -- aqui o sinal é semanticamente relevante para dias antes do vencimento.
    "wait_hours"          integer NOT NULL,

    -- Template WhatsApp a enviar quando esta regra disparar.
    -- ON DELETE RESTRICT: template referenciado por regra não pode ser excluído.
    -- Worker valida template.status='approved' antes de enviar.
    "template_id"         uuid    NOT NULL,

    -- Filtro por status da parcela (payment_dues.status).
    -- null = aplica-se a qualquer status.
    -- 'pending'  → regras D-3: só lembra parcelas ainda não vencidas.
    -- 'overdue'  → regras D+7/D+15: só cobra inadimplentes.
    "applies_to_status"   text
        CONSTRAINT "chk_collection_rules_applies_to_status"
            CHECK ("applies_to_status" IS NULL OR
                   "applies_to_status" IN ('pending', 'overdue', 'paid', 'renegotiated', 'cancelled')),

    -- Controle de ativação (gate operacional por regra).
    -- false (default): regra cadastrada mas INATIVA — nenhum job criado.
    -- true: scheduler cria collection_jobs conforme trigger.
    "is_active"           boolean NOT NULL DEFAULT false,

    -- Máximo de tentativas de envio por parcela/regra.
    -- Default: 3. Check: deve ser >= 1.
    "max_attempts"        integer NOT NULL DEFAULT 3
        CONSTRAINT "chk_collection_rules_max_attempts_positive"
            CHECK ("max_attempts" > 0),

    "created_at"          timestamptz NOT NULL DEFAULT now(),
    "updated_at"          timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- FK: collection_rules → organizations
DO $$ BEGIN
  ALTER TABLE "collection_rules"
    ADD CONSTRAINT "fk_collection_rules_organization"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- FK: collection_rules → whatsapp_templates
-- ON DELETE RESTRICT: template em uso por regra não pode ser excluído.
DO $$ BEGIN
  ALTER TABLE "collection_rules"
    ADD CONSTRAINT "fk_collection_rules_template"
    FOREIGN KEY ("template_id") REFERENCES "public"."whatsapp_templates"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Unique: slug único por organização (d-3, d0, d7, d15 são únicos por org).
-- Permite referenciar regras pelo key em código e em idempotency_key.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_collection_rules_org_key"
    ON "collection_rules" ("organization_id", "key");
--> statement-breakpoint

-- Índice: query do scheduler — "todas as regras de cobrança ativas da org X".
-- Executado periodicamente pelo cron F5-S07 para decidir quais parcelas recebem jobs.
CREATE INDEX IF NOT EXISTS "idx_collection_rules_active"
    ON "collection_rules" USING btree ("organization_id", "is_active");
--> statement-breakpoint

-- Trigger: atualiza updated_at em todo UPDATE.
CREATE TRIGGER "trg_collection_rules_updated_at"
  BEFORE UPDATE ON "collection_rules"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 3. collection_jobs — Instâncias agendadas de cobrança por parcela/regra
--
-- Espelho de followup_jobs, adaptado para cobrança:
--   - payment_due_id em vez de lead_id.
--   - rule_id aponta para collection_rules.
--   - status inclui 'paid_before_send' (parcela paga antes do envio).
--
-- Ciclo de vida (status):
--   scheduled       → aguardando scheduled_at.
--   triggered       → worker pegou para processar (lock otimista SKIP LOCKED).
--   sent            → enviado com sucesso. sent_message_id preenchido.
--   failed          → falha de envio. last_error preenchido.
--   cancelled       → cancelado (billing flag off, regra desativada, contrato encerrado).
--   paid_before_send→ parcela paga antes do scheduled_at — envio cancelado graciosamente.
--
-- Idempotência:
--   unique (payment_due_id, rule_id, idempotency_key) garante exatamente 1 job
--   por parcela + regra + ciclo. Ex: "2026-06-15:d7".
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "collection_jobs" (
    "id"               uuid    PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

    -- Multi-tenant: todo job pertence a uma organização.
    "organization_id"  uuid    NOT NULL,

    -- Parcela alvo deste job de cobrança.
    -- ON DELETE CASCADE: parcela excluída (renegociação em massa, LGPD) remove todos os jobs.
    "payment_due_id"   uuid    NOT NULL,

    -- Regra de cobrança que originou o job.
    -- ON DELETE RESTRICT: regra com jobs (inclusive históricos) não pode ser excluída.
    -- Preserva rastreabilidade de qual regra gerou cada envio (auditoria regulatória).
    "rule_id"          uuid    NOT NULL,

    -- Timestamp absoluto em que o worker deve processar o job.
    -- scheduled_at = payment_dues.due_date::timestamptz + collection_rules.wait_hours * interval '1 hour'
    "scheduled_at"     timestamptz NOT NULL,

    -- Estado no pipeline de envio.
    "status"           text    NOT NULL DEFAULT 'scheduled'
        CONSTRAINT "chk_collection_jobs_status"
            CHECK ("status" IN (
                'scheduled',
                'triggered',
                'sent',
                'failed',
                'cancelled',
                'paid_before_send'
            )),

    -- Número de tentativas realizadas (incluindo falhas). Check: >= 0.
    "attempt_count"    integer NOT NULL DEFAULT 0
        CONSTRAINT "chk_collection_jobs_attempt_count_non_negative"
            CHECK ("attempt_count" >= 0),

    -- Descrição do último erro de envio (status='failed').
    -- null quando status != 'failed'.
    "last_error"       text,

    -- WhatsApp Message ID (wamid) após envio bem-sucedido. null até status='sent'.
    "sent_message_id"  text,

    -- Chave de idempotência: "{due_date}:{rule_key}". Ex: "2026-06-15:d7".
    -- Combinada com (payment_due_id, rule_id) no unique index.
    "idempotency_key"  text    NOT NULL,

    "created_at"       timestamptz NOT NULL DEFAULT now(),
    "updated_at"       timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- FK: collection_jobs → organizations
DO $$ BEGIN
  ALTER TABLE "collection_jobs"
    ADD CONSTRAINT "fk_collection_jobs_organization"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- FK: collection_jobs → payment_dues
-- ON DELETE CASCADE: parcela excluída remove todos os seus jobs pendentes.
-- Evita jobs órfãos tentando cobrar parcelas inexistentes.
DO $$ BEGIN
  ALTER TABLE "collection_jobs"
    ADD CONSTRAINT "fk_collection_jobs_payment_due"
    FOREIGN KEY ("payment_due_id") REFERENCES "public"."payment_dues"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- FK: collection_jobs → collection_rules
-- ON DELETE RESTRICT: regra com jobs não pode ser excluída.
-- Preserva rastreabilidade de qual regra originou cada tentativa de cobrança.
DO $$ BEGIN
  ALTER TABLE "collection_jobs"
    ADD CONSTRAINT "fk_collection_jobs_rule"
    FOREIGN KEY ("rule_id") REFERENCES "public"."collection_rules"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Unique de idempotência: mesma parcela + regra + ciclo gera exatamente 1 job.
-- Previne duplicatas em re-execuções do cron sem transação distribuída.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_collection_jobs_due_rule_idempotency"
    ON "collection_jobs" ("payment_due_id", "rule_id", "idempotency_key");
--> statement-breakpoint

-- Índice parcial: scanner principal do worker de cobrança (F5-S07).
-- Query: SELECT ... WHERE status='scheduled' AND scheduled_at <= now() FOR UPDATE SKIP LOCKED.
-- Parcial WHERE status='scheduled': exclui jobs em estados terminais que crescem sem limite.
-- Crítico para performance — sem este índice o worker faz full table scan.
CREATE INDEX IF NOT EXISTS "idx_collection_jobs_scheduled"
    ON "collection_jobs" USING btree ("status", "scheduled_at")
    WHERE "status" = 'scheduled';
--> statement-breakpoint

-- Índice: histórico de tentativas por parcela (UI + auditoria).
-- Suporta: "todas as tentativas de cobrança para a parcela X, mais recentes primeiro".
CREATE INDEX IF NOT EXISTS "idx_collection_jobs_payment_due"
    ON "collection_jobs" USING btree ("payment_due_id", "created_at" DESC);
--> statement-breakpoint

-- Trigger: atualiza updated_at em todo UPDATE.
CREATE TRIGGER "trg_collection_jobs_updated_at"
  BEFORE UPDATE ON "collection_jobs"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
