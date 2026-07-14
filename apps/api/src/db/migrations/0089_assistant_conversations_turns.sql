-- =============================================================================
-- 0089_assistant_conversations_turns.sql — Histórico persistente do copiloto
-- interno: conversas + turnos, SEM PII de cliente em repouso (F6-S24).
--
-- Contexto: docs/anexos/lgpd/dpia-historico-copiloto.md ("nível A — referência
-- + hidratação viva"). Dá à barra lateral do copiloto interno a capacidade de
-- reabrir e continuar conversas anteriores, sem criar um novo repositório de
-- dados pessoais: persiste só o esqueleto da conversa e referências de
-- entidade; o dado sensível é rebuscado ao vivo na leitura (F6-S27), com o
-- RBAC + escopo de cidade do usuário no momento.
--
-- Dependências:
--   - 0000_init            (pgcrypto, gen_random_uuid, set_updated_at function)
--   - 0001_bent_mac_gargan  (organizations, users)
--
-- Tabelas criadas (em ordem de dependência):
--   1. assistant_conversations — esqueleto da conversa (dono, título por
--      intenção, timestamps, soft-delete).
--   2. assistant_turns         — pergunta higienizada + narrativa sem PII +
--      blocos de dado de cliente referenciados por entidade (nunca o valor
--      hidratado).
--
-- Fase (dark até o parecer do DPO — F6-S23):
--   Este slot (F6-S24) só cria o schema. A flag `assistant.history.enabled`
--   (F6-S25) mantém a escrita como no-op enquanto desligada — tabela vazia
--   não trata dado pessoal. Ligar a flag em produção exige o parecer do DPO
--   oficial registrado no DPIA §6 (o portão incide sobre a ATIVAÇÃO da flag,
--   não sobre a construção do schema — nota revisada do DPIA em 2026-07-14).
--
-- Triggers:
--   - trg_assistant_conversations_updated_at (set_updated_at, reutilizada
--     desde 0000_init) — bump automático em qualquer UPDATE da conversa,
--     inclusive o "touch" que o service layer faz ao anexar um novo turno.
--
-- Invariante central do DPIA (LGPD, defesa em profundidade):
--   assistant_turns.blocks só pode conter `{ type, ref }` por elemento —
--   NUNCA a chave `value` (o dado hidratado: nome, CPF, telefone, cidade,
--   valores do lead — sempre efêmero, nunca gravado). A função
--   assistant_turns_blocks_no_value(jsonb) e o CHECK que a usa garantem essa
--   regra como FATO DO BANCO, não só como convenção do service layer (F6-S25):
--   se o código um dia esquecer de descartar `value` antes do INSERT, a
--   escrita falha em vez de vazar PII em repouso.
--
-- LGPD (label: lgpd-impact — ver DPIA §4 "medidas e salvaguardas"):
--   - assistant_conversations.title: derivado da INTENÇÃO do pedido
--     (ex.: "Análise do funil de Ariquemes"), NUNCA o nome de um titular.
--   - assistant_turns.question_sanitized: pergunta após DLP de CPF/telefone
--     + mascaramento de nome (vai além do DLP padrão do gateway).
--   - assistant_turns.narrative: comentário/estrutura da resposta, sem PII.
--   - assistant_turns.blocks: só referência de entidade (`lead_id` opaco),
--     nunca o dado hidratado — CHECK abaixo.
--   - Escopo privado: cada conversa só é legível pelo usuário dono
--     (organization_id, user_id) — aplicado pelo repository de leitura (F6-S27).
--   - Retenção: 90 dias com job de purga (DPIA §4.6 / doc 17 §6.1) — o
--     soft-delete (deleted_at) é o hook para esse job (slot futuro).
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 0. assistant_turns_blocks_no_value — validador do invariante "sem value"
--
-- Recebe o jsonb de `assistant_turns.blocks` e retorna true somente se:
--   (a) for um array jsonb; e
--   (b) NENHUM elemento do array tiver a chave `value`.
-- Usada pelo CHECK da tabela assistant_turns (definida abaixo). Marcada
-- IMMUTABLE: depende só do argumento, sem estado externo, mesmo padrão de
-- outras funções puramente jsonb do core do Postgres que ela usa
-- (jsonb_typeof, jsonb_array_elements).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION assistant_turns_blocks_no_value(blocks jsonb)
  RETURNS boolean
  LANGUAGE plpgsql
  IMMUTABLE AS
$$
DECLARE
  el jsonb;
BEGIN
  IF jsonb_typeof(blocks) IS DISTINCT FROM 'array' THEN
    RETURN false;
  END IF;

  FOR el IN SELECT * FROM jsonb_array_elements(blocks)
  LOOP
    IF el ? 'value' THEN
      RETURN false;
    END IF;
  END LOOP;

  RETURN true;
END;
$$;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 1. assistant_conversations — esqueleto da conversa reaberta pela sidebar
--
-- Uma linha por conversa. Dona de user_id; visível só para ele (escopo
-- privado, DPIA §4.5). Título é derivado da intenção do pedido, nunca do
-- nome de um titular.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "assistant_conversations" (
    "id"              uuid         PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

    -- Multi-tenant root. Toda conversa pertence a uma organização.
    "organization_id" uuid         NOT NULL,

    -- Usuário dono da conversa — único que pode listar/reabrir.
    -- ON DELETE CASCADE (via ALTER TABLE abaixo): a conversa só existe para o
    -- usuário retomar sua própria consulta; sem o dono, não há para quem
    -- mostrá-la na sidebar (diferente de assistant_queries, log de auditoria
    -- que usa SET NULL para preservar o registro sem o ator humano).
    "user_id"         uuid         NOT NULL,

    -- Título curto da sidebar, derivado da INTENÇÃO do pedido.
    -- Ex.: "Análise do funil de Ariquemes", "Cobranças em atraso".
    -- PROIBIDO conter o nome de um titular (DPIA §3 risco R4). Geração e
    -- sanitização são responsabilidade do service layer (F6-S25) — não há
    -- CHECK aqui porque não existe padrão regex estável para validar
    -- "ausência de nome próprio" no banco.
    "title"           text         NOT NULL,

    "created_at"      timestamptz  NOT NULL DEFAULT now(),

    -- Atualizado automaticamente via trigger trg_assistant_conversations_updated_at
    -- em qualquer UPDATE da linha — inclusive o "touch" ao anexar um novo turno.
    -- Base da ordenação da sidebar (mais recente primeiro).
    "updated_at"      timestamptz  NOT NULL DEFAULT now(),

    -- Soft-delete. NULL = ativa (aparece na sidebar). NOT NULL = removida
    -- pelo usuário ou purgada pelo job de retenção de 90 dias (DPIA §4.6).
    "deleted_at"      timestamptz
);
--> statement-breakpoint

-- FK: assistant_conversations → organizations
DO $$ BEGIN
  ALTER TABLE "assistant_conversations"
    ADD CONSTRAINT "fk_assistant_conversations_organization"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- FK: assistant_conversations → users (dono)
DO $$ BEGIN
  ALTER TABLE "assistant_conversations"
    ADD CONSTRAINT "fk_assistant_conversations_user"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Índice: query principal da sidebar — conversas ATIVAS do usuário X na org Y,
-- ordenadas por atualização (mais recente primeiro). Parcial sobre
-- deleted_at IS NULL — mantém o índice pequeno e alinhado ao filtro real da
-- query (a sidebar nunca lista conversas soft-deletadas). org_id na frente
-- garante isolamento multi-tenant nas varreduras.
CREATE INDEX IF NOT EXISTS "idx_assistant_conversations_org_user_updated_at"
    ON "assistant_conversations" USING btree ("organization_id", "user_id", "updated_at")
    WHERE "deleted_at" IS NULL;
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

CREATE OR REPLACE TRIGGER "trg_assistant_conversations_updated_at"
  BEFORE UPDATE ON "assistant_conversations"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 2. assistant_turns — pergunta+resposta higienizadas de uma conversa
--
-- Uma linha por turno. Append-only (sem updated_at — imutável após criação,
-- mesmo padrão de assistant_queries e credit_analysis_versions). Sem
-- organization_id nesta tabela: escopo transitivo via
-- conversation_id → assistant_conversations.organization_id (mesmo padrão de
-- messages/lead_history — tabelas-filho não duplicam a raiz multi-tenant).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "assistant_turns" (
    "id"                  uuid         PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

    -- Conversa a que este turno pertence.
    "conversation_id"     uuid         NOT NULL,

    -- Pergunta do usuário APÓS higienização: DLP de CPF/telefone + nome
    -- mascarado (DPIA §4.3, risco R3). NUNCA a pergunta bruta.
    -- Higienização é responsabilidade do service layer (F6-S25).
    "question_sanitized"  text         NOT NULL,

    -- Comentário/estrutura da resposta do copiloto, SEM PII de cliente.
    -- Mesmo campo `narrative` do contrato F6-S20/F6-S21 (LangGraph), repassado
    -- como veio — a DLP do agente já garante ausência de PII aqui.
    "narrative"           text         NOT NULL,

    -- Blocos de dado de cliente da resposta, SÓ como referência de entidade.
    -- Formato por elemento: { type: string, ref: { kind: 'lead' | 'none',
    -- lead_id: uuid | null } } — NUNCA `value` (dado hidratado, efêmero).
    -- CHECK chk_assistant_turns_blocks_no_value (abaixo) é a defesa em
    -- profundidade contra vazamento de PII em repouso.
    "blocks"              jsonb        NOT NULL DEFAULT '[]',

    -- Fontes de dado consultadas para montar a resposta (rótulos, não PII).
    -- Formato: string[] — mesmo campo `sources` do contrato F6-S21.
    "sources"             jsonb        NOT NULL DEFAULT '[]',

    -- Sem updated_at — turno é imutável após criação (append-only).
    "created_at"          timestamptz  NOT NULL DEFAULT now(),

    -- Invariante central do DPIA: nenhum elemento de `blocks` pode conter a
    -- chave `value`. Ver comentário da função assistant_turns_blocks_no_value
    -- no topo desta migration.
    CONSTRAINT "chk_assistant_turns_blocks_no_value"
        CHECK (assistant_turns_blocks_no_value("blocks"))
);
--> statement-breakpoint

-- FK: assistant_turns → assistant_conversations
DO $$ BEGIN
  ALTER TABLE "assistant_turns"
    ADD CONSTRAINT "fk_assistant_turns_conversation"
    FOREIGN KEY ("conversation_id") REFERENCES "public"."assistant_conversations"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Índice: turnos de uma conversa em ordem cronológica — query de abertura da
-- conversa reaberta pela sidebar.
CREATE INDEX IF NOT EXISTS "idx_assistant_turns_conversation_created_at"
    ON "assistant_turns" USING btree ("conversation_id", "created_at");
