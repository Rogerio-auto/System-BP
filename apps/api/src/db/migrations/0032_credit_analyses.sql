-- =============================================================================
-- 0032_credit_analyses.sql — Schema de análise de crédito e pareceres.
--
-- Contexto: F4-S01.
-- Dependências:
--   - 0000_init          (pgcrypto, gen_random_uuid, set_updated_at function)
--   - 0001_bent_mac_gargan (organizations)
--   - 0007_leads_core    (leads, customers)
--   - 0016_credit_core   (credit_simulations)
--   - 0001/users         (users)
--
-- Tabelas criadas (em ordem de dependência):
--   1. credit_analyses         — cabeçalho de cada análise (1 por lead ativo)
--   2. credit_analysis_versions — pareceres versionados e imutáveis
--
-- Dependência circular resolvida em duas etapas:
--   a) credit_analyses criada SEM a FK para credit_analysis_versions.
--   b) credit_analysis_versions criada COM FK para credit_analyses.
--   c) ALTER TABLE adiciona a FK de current_version_id APÓS ambas existirem.
--
-- Triggers:
--   - trg_credit_analyses_updated_at          (set_updated_at)
--   - trg_prevent_credit_analysis_version_upd (imutabilidade de versões)
--
-- LGPD (label: lgpd-impact):
--   - Base legal: Art. 7º V (execução de contrato) + Art. 20 §1º (decisão
--     automatizada com revisão humana obrigatória).
--   - lead_id e customer_id apontam para entidades com PII — não logar.
--   - parecer_text pode mencionar nome e cidade; NÃO deve carregar CPF/RG bruto.
--     Validação DLP (regex defensiva) implementada no service layer (F4-S02).
--   - attachments: somente metadados { storage_key, filename, mime_type,
--     size_bytes, sha256 }. Nunca URLs assinadas. Conteúdo em object storage.
--   - internal_score: jamais expor para o lead/cliente; gated por feature flag.
--   - Retenção: 5 anos após encerramento (Art. 20 §1º). Job de purga: F1-S25.
--   - IA NUNCA toma decisão de crédito (origin IN ('manual','import') apenas).
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. credit_analyses — cabeçalho da análise de crédito
--
-- Uma linha por análise ativa por lead/org. O unique parcial garante que
-- não exista mais de uma análise ativa (não cancelada) por lead dentro de
-- uma organização. Análises canceladas não contam — permitem reabertura.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "credit_analyses" (
    "id"                    uuid          PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

    -- Multi-tenant: denormalizado para city-scope sem JOIN.
    "organization_id"       uuid          NOT NULL,

    -- Lead que originou a análise.
    -- RESTRIÇÃO LGPD: não logar este campo em contextos sem RBAC.
    "lead_id"               uuid          NOT NULL,

    -- Cliente identificado (CPF obtido) associado à análise.
    -- null = análise iniciada antes da identificação formal do cliente.
    -- RESTRIÇÃO LGPD: não logar; campo aponta para entidade com PII.
    "customer_id"           uuid,

    -- Simulação que originou esta análise (rastreabilidade completa).
    -- null = análise iniciada sem simulação prévia (ex: importação).
    "simulation_id"         uuid,

    -- Versão (parecer) atualmente vigente desta análise.
    -- null = análise recém-criada, ainda sem parecer inserido.
    -- FK adicionada via ALTER TABLE na etapa 3 (dependência circular).
    "current_version_id"    uuid,

    -- Status agregado atual. Espelha o status da versão vigente para queries
    -- diretas sem JOIN. Transições:
    --   em_analise → pendente → aprovado | recusado | cancelado
    -- Qualquer transição insere nova versão e atualiza este campo atomicamente.
    "status"                text          NOT NULL
        CONSTRAINT "chk_credit_analyses_status"
            CHECK ("status" IN ('em_analise', 'pendente', 'aprovado', 'recusado', 'cancelado')),

    -- Valor aprovado em reais. Preenchido somente quando status = 'aprovado'.
    -- null em qualquer outro status — service layer valida essa invariante.
    "approved_amount"       numeric(14,2),

    -- Prazo aprovado em meses. null quando status != 'aprovado'.
    "approved_term_months"  integer,

    -- Taxa mensal aprovada (decimal, ex: 0.025 = 2,5%). null quando não aprovado.
    -- AVISO: armazenar como decimal, não como percentual.
    "approved_rate_monthly" numeric(8,6),

    -- Score interno de risco (0-100). null = não calculado ou flag desativada.
    -- RESTRITO: gated por feature flag 'credit_analysis.internal_score.enabled'.
    -- NUNCA expor para o cliente/lead — apenas analistas com permissão específica.
    "internal_score"        numeric(6,2),

    -- Analista humano responsável. null = não atribuído.
    -- Toda análise deve ter analista antes de emitir parecer final (validado app).
    "analyst_user_id"       uuid,

    -- Origem da análise.
    -- 'manual' = criado por analista via UI.
    -- 'import' = importado via planilha (F4-S06).
    -- SEM 'ai': IA NUNCA toma decisão de crédito (requisito Art. 20 LGPD).
    "origin"                text          NOT NULL DEFAULT 'manual'
        CONSTRAINT "chk_credit_analyses_origin"
            CHECK ("origin" IN ('manual', 'import')),

    "created_at"            timestamptz   NOT NULL DEFAULT now(),

    -- Atualizado automaticamente via trigger trg_credit_analyses_updated_at.
    "updated_at"            timestamptz   NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- FK: credit_analyses → organizations
DO $$ BEGIN
  ALTER TABLE "credit_analyses"
    ADD CONSTRAINT "fk_credit_analyses_organization"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- FK: credit_analyses → leads
DO $$ BEGIN
  ALTER TABLE "credit_analyses"
    ADD CONSTRAINT "fk_credit_analyses_lead"
    FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- FK: credit_analyses → customers (nullable)
DO $$ BEGIN
  ALTER TABLE "credit_analyses"
    ADD CONSTRAINT "fk_credit_analyses_customer"
    FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- FK: credit_analyses → credit_simulations (nullable)
DO $$ BEGIN
  ALTER TABLE "credit_analyses"
    ADD CONSTRAINT "fk_credit_analyses_simulation"
    FOREIGN KEY ("simulation_id") REFERENCES "public"."credit_simulations"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- FK: credit_analyses → users (analista, nullable)
DO $$ BEGIN
  ALTER TABLE "credit_analyses"
    ADD CONSTRAINT "fk_credit_analyses_analyst"
    FOREIGN KEY ("analyst_user_id") REFERENCES "public"."users"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Unique parcial: 1 análise ativa por lead/org.
-- WHERE status != 'cancelado': análises canceladas não contam para o limite,
-- permitindo reabertura de processo para o mesmo lead.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_credit_analyses_org_lead_active"
    ON "credit_analyses" ("organization_id", "lead_id")
    WHERE "status" != 'cancelado';
--> statement-breakpoint

-- Índice: filtros de board por status (fila de trabalho do analista).
CREATE INDEX IF NOT EXISTS "idx_credit_analyses_org_status"
    ON "credit_analyses" USING btree ("organization_id", "status");
--> statement-breakpoint

-- Índice: histórico de análises por lead em ordem cronológica.
CREATE INDEX IF NOT EXISTS "idx_credit_analyses_lead"
    ON "credit_analyses" USING btree ("lead_id", "created_at" DESC);
--> statement-breakpoint

-- Índice: carga de trabalho por analista.
CREATE INDEX IF NOT EXISTS "idx_credit_analyses_analyst"
    ON "credit_analyses" USING btree ("analyst_user_id");
--> statement-breakpoint

-- Trigger: atualiza updated_at automaticamente em qualquer UPDATE.
-- Reutiliza a função set_updated_at() garantida como idempotente desde 0000_init.
CREATE OR REPLACE FUNCTION set_updated_at()
  RETURNS TRIGGER LANGUAGE plpgsql AS
$$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "trg_credit_analyses_updated_at"
  BEFORE UPDATE ON "credit_analyses"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 2. credit_analysis_versions — pareceres versionados e imutáveis
--
-- Cada linha é um snapshot do parecer do analista em um momento específico.
-- NUNCA recebe UPDATE após inserção — trigger abaixo garante em profundidade.
--
-- Para "editar" um parecer:
--   1. INSERT nova versão (version = MAX(version)+1 para esta analysis_id).
--   2. UPDATE credit_analyses SET current_version_id = novo_id, status = novo_status
--   (mesma transação — garantia de consistência).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "credit_analysis_versions" (
    "id"             uuid         PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

    -- Análise de crédito à qual esta versão pertence.
    "analysis_id"    uuid         NOT NULL,

    -- Número sequencial da versão (1, 2, 3...) dentro desta análise.
    -- Calculado pelo service: SELECT COALESCE(MAX(version),0)+1 em transação.
    "version"        integer      NOT NULL,

    -- Snapshot do status da análise no momento deste parecer.
    -- Permite reconstruir histórico completo de transições sem JOIN.
    "status"         text         NOT NULL
        CONSTRAINT "chk_credit_analysis_versions_status"
            CHECK ("status" IN ('em_analise', 'pendente', 'aprovado', 'recusado', 'cancelado')),

    -- Texto livre do parecer do analista.
    -- RESTRIÇÃO LGPD: NÃO deve conter CPF, RG ou identificadores diretos em
    -- forma bruta. Validação DLP (regex defensiva) implementada no service
    -- layer no slot F4-S02 antes de persistir.
    -- Pode conter: nome do solicitante, cidade, número do contrato, justificativa.
    "parecer_text"   text         NOT NULL,

    -- Lista de pendências documentais ou informações faltantes.
    -- Schema: Array<{ tipo: string; descricao: string; prazo?: string }>.
    -- Validação de schema realizada no service layer (Zod).
    "pendencias"     jsonb        NOT NULL DEFAULT '[]',

    -- Metadados de anexos. Schema: Array<{ storage_key, filename, mime_type,
    -- size_bytes, sha256 }>. NUNCA armazenar URLs assinadas ou conteúdo binário.
    -- Conteúdo vive em object storage com criptografia at-rest (slot futuro).
    "attachments"    jsonb        NOT NULL DEFAULT '[]',

    -- Analista responsável pelo parecer. Obrigatório.
    -- ON DELETE RESTRICT: preserva vínculo de responsabilidade (Art. 20 §1º LGPD).
    -- Usuário com pareceres emitidos deve ser desativado, não deletado.
    "author_user_id" uuid         NOT NULL,

    -- Sem updated_at — versões são imutáveis após inserção.
    -- Trigger prevent_credit_analysis_version_update garante em profundidade.
    "created_at"     timestamptz  NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- FK: credit_analysis_versions → credit_analyses
DO $$ BEGIN
  ALTER TABLE "credit_analysis_versions"
    ADD CONSTRAINT "fk_credit_analysis_versions_analysis"
    FOREIGN KEY ("analysis_id") REFERENCES "public"."credit_analyses"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- FK: credit_analysis_versions → users (autor do parecer)
DO $$ BEGIN
  ALTER TABLE "credit_analysis_versions"
    ADD CONSTRAINT "fk_credit_analysis_versions_author"
    FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Unique: versão única por análise — evita gap/duplicata de versão.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_credit_analysis_versions_analysis_version"
    ON "credit_analysis_versions" ("analysis_id", "version");
--> statement-breakpoint

-- Índice: histórico completo de uma análise (mais recente primeiro).
-- Uso: timeline de auditoria, exibição de pareceres anteriores.
CREATE INDEX IF NOT EXISTS "idx_credit_analysis_versions_analysis"
    ON "credit_analysis_versions" USING btree ("analysis_id", "version" DESC);
--> statement-breakpoint

-- Trigger de imutabilidade: impede UPDATE em qualquer linha de versões.
-- Defesa em profundidade — service layer NÃO expõe rota UPDATE, mas o trigger
-- protege contra scripts de manutenção acidentais ou acesso direto ao banco.
CREATE OR REPLACE FUNCTION prevent_credit_analysis_version_update()
  RETURNS TRIGGER LANGUAGE plpgsql AS
$$
BEGIN
  RAISE EXCEPTION
    'credit_analysis_versions é imutável. Para editar, insira nova versão e atualize credit_analyses.current_version_id. (version=%, analysis_id=%)',
    OLD.version, OLD.analysis_id;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "trg_prevent_credit_analysis_version_upd"
  BEFORE UPDATE ON "credit_analysis_versions"
  FOR EACH ROW EXECUTE FUNCTION prevent_credit_analysis_version_update();
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 3. Resolução da dependência circular:
--    credit_analyses.current_version_id → credit_analysis_versions.id
--
-- Esta FK não pôde ser criada na etapa 1 porque credit_analysis_versions
-- ainda não existia. Adicionada aqui após ambas as tabelas existirem.
-- ON DELETE SET NULL: versão deletada (edge case administrativo) não destrói
-- o cabeçalho da análise — status deve ser revisado manualmente.
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE "credit_analyses"
    ADD CONSTRAINT "fk_credit_analyses_current_version"
    FOREIGN KEY ("current_version_id") REFERENCES "public"."credit_analysis_versions"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Índice parcial: análises com versão vigente (maioria das análises ativas).
-- Exclui análises sem versão (recém-criadas) para manter índice enxuto.
CREATE INDEX IF NOT EXISTS "idx_credit_analyses_current_version"
    ON "credit_analyses" USING btree ("current_version_id")
    WHERE "current_version_id" IS NOT NULL;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 4. Alteração em leads: FK física para credit_analyses
--
-- leads.last_analysis_id era uuid sem FK física para evitar dependência circular
-- no CREATE TABLE inicial (leads.ts). Adicionada aqui como ALTER TABLE após
-- credit_analyses existir.
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE "leads"
    ADD COLUMN IF NOT EXISTS "last_analysis_id" uuid;
EXCEPTION WHEN others THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "leads"
    ADD CONSTRAINT "fk_leads_last_analysis"
    FOREIGN KEY ("last_analysis_id") REFERENCES "public"."credit_analyses"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Índice parcial: leads com análise associada.
CREATE INDEX IF NOT EXISTS "idx_leads_last_analysis"
    ON "leads" USING btree ("last_analysis_id")
    WHERE "last_analysis_id" IS NOT NULL;
