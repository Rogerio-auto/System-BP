-- =============================================================================
-- 0094_quick_replies.sql — Biblioteca de respostas rápidas do live chat (F28-S01).
--
-- Contexto: docs/25-respostas-rapidas.md §4/§4.1 (normativo). Base de toda a
-- fase F28 — biblioteca de mensagens pré-definidas (texto/mídia) que o
-- operador dispara no live chat com um clique. NÃO é um recurso da Meta: no
-- envio, a resposta rápida vira uma mensagem `text` ou `media` comum,
-- percorrendo o caminho já existente até a API oficial do WhatsApp (nenhuma
-- rota nova de envio — F28-S03).
--
-- Duas visibilidades:
--   - 'organization' (owner_user_id NULL): curada pela gestão, org-wide.
--   - 'personal' (owner_user_id preenchido): biblioteca própria do operador.
--   Coerência garantida por CHECK (chk_quick_replies_visibility_owner) — não
--   por convenção de aplicação.
--
-- Mídia é inline (mesmo padrão de `messages`) — sem tabela separada. No
-- máximo uma mídia por resposta rápida, com legenda opcional em `body`.
--
-- city_ids (uuid[] DEFAULT '{}'): filtro de CONVENIÊNCIA de exibição, NÃO
-- fronteira de segurança (doc 25 D6) — o live chat é org-wide por design
-- (modules/livechat/repo.ts:165-179). A fronteira real é organization_id.
-- Não aplicar aqui a semântica de applyCityScope.
--
-- Dois únicos parciais de shortcut (doc 25 §4.1) — o atalho pessoal de um
-- operador PODE sombrear um da organização; na resolução (fora deste slot),
-- o pessoal vence (doc 25 §6.2):
--   - uq_quick_replies_shortcut_org_wide:  (organization_id, shortcut)
--     WHERE owner_user_id IS NULL AND deleted_at IS NULL
--   - uq_quick_replies_shortcut_per_owner: (organization_id, owner_user_id, shortcut)
--     WHERE owner_user_id IS NOT NULL AND deleted_at IS NULL
--
-- Soft-delete via deleted_at: toda query de leitura filtra IS NULL. Os
-- únicos parciais também filtram deleted_at IS NULL — permite recriar o
-- mesmo shortcut após exclusão.
--
-- shortcut é citext (case-insensitive) — extension já habilitada em
-- 0000_init.sql. Formato validado por CHECK (chk_quick_replies_shortcut_format).
--
-- updated_at: trigger set_updated_at, redefinida aqui de forma idempotente
-- (mesmo padrão de 0026/0089/0093) para ambientes de teste isolados.
-- =============================================================================

CREATE TABLE IF NOT EXISTS "quick_replies" (
    "id"                uuid         PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

    -- Multi-tenant root — fronteira real de segurança (doc 25 D6).
    "organization_id"   uuid         NOT NULL,

    -- Dono do atalho pessoal. NULL ⇒ visibility='organization' (org-wide).
    -- Preenchido ⇒ visibility='personal'. ON DELETE CASCADE (via ALTER
    -- TABLE abaixo): sem o dono, o atalho pessoal perde sentido.
    "owner_user_id"     uuid,

    "visibility"        text         NOT NULL DEFAULT 'organization',

    -- Slug do atalho digitável no composer (sem a barra). citext: busca e
    -- dedupe case-insensitive.
    "shortcut"          citext       NOT NULL,

    -- Rótulo humano na lista de seleção do composer.
    "title"             text         NOT NULL,

    -- Corpo com variáveis (catálogo fechado — doc 25 §6). Obrigatório se
    -- não houver mídia; funciona como legenda quando há mídia.
    "body"              text,

    -- Agrupador livre na tela de admin (ex.: "Documentos", "Saudações").
    "category"          text,

    -- URL pública estável da mídia (§7 doc 25) — a serialização para a
    -- Meta usa `link`, não `media_id`.
    "media_url"         text,
    "media_mime"        text,
    "media_kind"        text,
    "media_size_bytes"  integer,
    "media_file_name"   text,

    -- Filtro de conveniência de exibição por cidade — vazio = todas.
    -- NÃO é fronteira de segurança (doc 25 D6).
    "city_ids"          uuid[]       NOT NULL DEFAULT '{}',

    "is_active"         boolean      NOT NULL DEFAULT true,

    -- Fixação manual das principais respostas na lista (ordenação).
    "sort_order"        integer      NOT NULL DEFAULT 0,

    -- Telemetria de uso (doc 25 §10).
    "usage_count"       integer      NOT NULL DEFAULT 0,
    "last_used_at"      timestamptz,

    -- ON DELETE SET NULL (via ALTER TABLE abaixo): preserva a resposta
    -- rápida se o criador for removido.
    "created_by"        uuid,

    "created_at"        timestamptz  NOT NULL DEFAULT now(),

    -- Atualizado automaticamente via trigger trg_quick_replies_updated_at.
    "updated_at"        timestamptz  NOT NULL DEFAULT now(),

    -- Soft-delete. NULL = ativa. NOT NULL = removida (não aparece no
    -- composer nem na listagem de admin).
    "deleted_at"        timestamptz,

    -- -------------------------------------------------------------------------
    -- Constraints de integridade (doc 25 §4.1)
    -- -------------------------------------------------------------------------

    -- Coerência: visibility='personal' <=> owner_user_id preenchido.
    CONSTRAINT "chk_quick_replies_visibility_owner"
        CHECK (("visibility" = 'personal') = ("owner_user_id" IS NOT NULL)),

    -- Domínio fechado de visibility.
    CONSTRAINT "chk_quick_replies_visibility_domain"
        CHECK ("visibility" IN ('organization', 'personal')),

    -- Resposta vazia é inválida: precisa de corpo de texto ou mídia.
    CONSTRAINT "chk_quick_replies_body_or_media"
        CHECK ("body" IS NOT NULL OR "media_url" IS NOT NULL),

    -- Mídia é tudo-ou-nada: media_url e media_kind aparecem juntos.
    CONSTRAINT "chk_quick_replies_media_all_or_nothing"
        CHECK (("media_url" IS NULL) = ("media_kind" IS NULL)),

    -- Domínio fechado de media_kind.
    CONSTRAINT "chk_quick_replies_media_kind_domain"
        CHECK ("media_kind" IS NULL OR "media_kind" IN ('image', 'video', 'audio', 'document')),

    -- Formato do atalho: minúsculas/dígitos, começa alfanumérico, até 32 chars.
    CONSTRAINT "chk_quick_replies_shortcut_format"
        CHECK ("shortcut" ~ '^[a-z0-9][a-z0-9_-]{0,31}$')
);
--> statement-breakpoint

-- FK: quick_replies → organizations (fronteira de tenant).
DO $$ BEGIN
  ALTER TABLE "quick_replies"
    ADD CONSTRAINT "fk_quick_replies_organization"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- FK: quick_replies → users (dono do atalho pessoal).
DO $$ BEGIN
  ALTER TABLE "quick_replies"
    ADD CONSTRAINT "fk_quick_replies_owner"
    FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- FK: quick_replies → users (criador — auditoria, sobrevive à remoção do usuário).
DO $$ BEGIN
  ALTER TABLE "quick_replies"
    ADD CONSTRAINT "fk_quick_replies_created_by"
    FOREIGN KEY ("created_by") REFERENCES "public"."users"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Único parcial org-wide: atalho único entre respostas curadas pela
-- organização (owner_user_id IS NULL) ativas.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_quick_replies_shortcut_org_wide"
    ON "quick_replies" ("organization_id", "shortcut")
    WHERE "owner_user_id" IS NULL AND "deleted_at" IS NULL;
--> statement-breakpoint

-- Único parcial por dono: atalho único dentro da biblioteca pessoal de cada
-- operador. Pode legitimamente sombrear um atalho da organização com o
-- mesmo nome — na resolução, o pessoal vence (doc 25 §6.2).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_quick_replies_shortcut_per_owner"
    ON "quick_replies" ("organization_id", "owner_user_id", "shortcut")
    WHERE "owner_user_id" IS NOT NULL AND "deleted_at" IS NULL;
--> statement-breakpoint

-- Índice: listagem de respostas ativas da organização (composer/admin).
CREATE INDEX IF NOT EXISTS "idx_quick_replies_org_active"
    ON "quick_replies" USING btree ("organization_id", "is_active");
--> statement-breakpoint

-- Índice: filtragem por dono (biblioteca pessoal do operador).
CREATE INDEX IF NOT EXISTS "idx_quick_replies_org_owner"
    ON "quick_replies" USING btree ("organization_id", "owner_user_id");
--> statement-breakpoint

-- Índice: busca fuzzy por título (GIN trigram — operator class explícito).
-- Requer pg_trgm (criado em 0000_init.sql). Drizzle não suporta operator
-- class nativo — mesmo padrão de idx_leads_name_trgm (0007).
CREATE INDEX IF NOT EXISTS "idx_quick_replies_title_trgm"
    ON "quick_replies" USING gin ("title" gin_trgm_ops);
--> statement-breakpoint

-- Trigger: atualiza updated_at automaticamente em qualquer UPDATE.
-- Reutiliza a função set_updated_at() garantida como idempotente desde
-- 0000_init; redefinida aqui de forma idempotente (mesmo padrão de
-- 0026/0089/0093) para ambientes de teste isolados que não rodaram as
-- migrations anteriores em ordem.
CREATE OR REPLACE FUNCTION set_updated_at()
  RETURNS TRIGGER LANGUAGE plpgsql AS
$$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE TRIGGER "trg_quick_replies_updated_at"
  BEFORE UPDATE ON "quick_replies"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
