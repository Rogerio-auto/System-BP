-- =============================================================================
-- 0093_push_subscriptions.sql — Destino do Web Push (F27-S05).
--
-- Contexto: docs/24-pwa.md §8 (modelo de dados). Base para o backend de push
-- (VAPID, sender, endpoints subscribe/unsubscribe, fan-out — F27-S06).
--
-- push_subscriptions: uma linha por device/browser que fez opt-in de push no
-- Manager instalado como PWA. Guarda o endpoint do push service (URL única do
-- browser/OS) + as chaves ECDH (p256dh/auth) exigidas pelo protocolo Web Push
-- (RFC 8291) para cifrar o payload.
--
-- Multi-tenant: organization_id NOT NULL desde o dia 1 (§8 CLAUDE.md / PROTOCOL).
-- user_id NOT NULL FK → users ON DELETE CASCADE: a subscription só existe para
-- o usuário notificar SEU PRÓPRIO device; sem o dono, não há para quem
-- entregar o push (mesmo raciocínio de assistant_conversations, 0089).
--
-- Único parcial em endpoint (WHERE deleted_at IS NULL): o endpoint do push
-- service já é globalmente único por subscription ativa do browser/OS — o
-- índice único permite ao endpoint de subscribe fazer UPSERT idempotente
-- (reinstalar o PWA / re-conceder permissão não duplica a linha) sem colidir
-- com endpoints já soft-deletados (opt-out/logout), que podem reviver.
--
-- Índice em user_id: query de fan-out do sender (F27-S06) — "todas as
-- subscriptions ativas do usuário X" ao entregar uma notificação.
--
-- LGPD (doc 24 §9, doc 17 vence): endpoint/p256dh/auth identificam o
-- device/usuário — dado pessoal. pino.redact + payload de push sem PII são
-- responsabilidade do slot de backend (F27-S06). Aqui, a defesa em
-- profundidade é o soft-delete (deleted_at) — hook para deleção no logout,
-- opt-out e exercício do direito do titular, e para o job de limpeza de
-- subscriptions mortas (404/410).
--
-- updated_at: bumped via trigger set_updated_at (reutilizada desde 0000_init,
-- mesmo padrão de assistant_conversations/credit_analyses/followup_rules).
-- =============================================================================

CREATE TABLE IF NOT EXISTS "push_subscriptions" (
    "id"              uuid         PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

    -- Multi-tenant root. Toda subscription pertence a uma organização.
    "organization_id" uuid         NOT NULL,

    -- Usuário dono do device — único que recebe push nesta subscription.
    -- ON DELETE CASCADE (via ALTER TABLE abaixo): sem o dono não há para quem
    -- entregar o push; a subscription não tem razão de existir.
    "user_id"         uuid         NOT NULL,

    -- URL do push service do browser/OS (ex.: FCM, Mozilla autopush) —
    -- identificador único da subscription ativa de um device. Dado pessoal
    -- (doc 24 §9) — nunca em log claro (pino.redact, F27-S06).
    "endpoint"        text         NOT NULL,

    -- Chave pública ECDH do client, exigida pelo protocolo Web Push (RFC 8291)
    -- para cifrar o payload. Dado pessoal — nunca em log claro.
    "p256dh"          text         NOT NULL,

    -- Segredo de autenticação do client, exigido pelo protocolo Web Push.
    -- Dado pessoal — nunca em log claro.
    "auth"            text         NOT NULL,

    -- Rótulo do device (User-Agent do browser) para a UI de gestão de
    -- subscriptions do usuário ("Chrome no Windows", "Safari no iPhone").
    "user_agent"      text,

    "created_at"      timestamptz  NOT NULL DEFAULT now(),

    -- Atualizado automaticamente via trigger trg_push_subscriptions_updated_at
    -- em qualquer UPDATE da linha (ex.: renovação de keys pelo browser).
    "updated_at"      timestamptz  NOT NULL DEFAULT now(),

    -- Soft-delete. NULL = subscription ativa (recebe push). NOT NULL =
    -- opt-out, logout, subscription morta (404/410) ou exercício do direito
    -- do titular (doc 24 §9 / doc 17).
    "deleted_at"      timestamptz
);
--> statement-breakpoint

-- FK: push_subscriptions → organizations
DO $$ BEGIN
  ALTER TABLE "push_subscriptions"
    ADD CONSTRAINT "fk_push_subscriptions_organization"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- FK: push_subscriptions → users (dono do device)
DO $$ BEGIN
  ALTER TABLE "push_subscriptions"
    ADD CONSTRAINT "fk_push_subscriptions_user"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Único parcial: upsert idempotente por endpoint entre subscriptions ATIVAS.
-- Permite ao mesmo endpoint reviver (nova linha) após soft-delete da anterior.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_push_subscriptions_endpoint_active"
    ON "push_subscriptions" ("endpoint")
    WHERE "deleted_at" IS NULL;
--> statement-breakpoint

-- Índice: fan-out do sender — "subscriptions ativas do usuário X" ao entregar
-- uma notificação (F27-S06).
CREATE INDEX IF NOT EXISTS "idx_push_subscriptions_user_id"
    ON "push_subscriptions" USING btree ("user_id");
--> statement-breakpoint

-- Trigger: atualiza updated_at automaticamente em qualquer UPDATE.
-- Reutiliza a função set_updated_at() garantida como idempotente desde
-- 0000_init; redefinida aqui de forma idempotente (mesmo padrão de
-- 0026/0089) para ambientes de teste isolados que não rodaram as migrations
-- anteriores em ordem.
CREATE OR REPLACE FUNCTION set_updated_at()
  RETURNS TRIGGER LANGUAGE plpgsql AS
$$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE TRIGGER "trg_push_subscriptions_updated_at"
  BEFORE UPDATE ON "push_subscriptions"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- Seed idempotente da flag `pwa.enabled` (doc 09-feature-flags.md).
--
-- A flag já consta do catálogo (doc 09) mas pode não estar seedada no banco —
-- sem esta linha, um admin não consegue LIGAR a flag via painel. Nasce
-- `disabled` (default do MVP pós-produção, doc 09) e `visible = false`
-- (doc 09: coluna "UI se disabled" = ✗) — não aparece no painel geral como
-- "Em desenvolvimento" até a fase de PWA ser anunciada.
--
-- ON CONFLICT DO NOTHING: idempotente — não sobrescreve o estado de uma flag
-- já existente (ex.: se um admin já tiver alternado o status manualmente).
-- ---------------------------------------------------------------------------
INSERT INTO "feature_flags" ("key", "status", "visible", "ui_label", "description", "audience")
VALUES (
  'pwa.enabled',
  'disabled',
  false,
  'App instalável (PWA) + notificações push',
  'Habilita o Manager como Progressive Web App instalável (app-shell offline, '
    || 'ícone na tela inicial) e o Web Push em background, plugado no motor de '
    || 'notificações da Fase F24. Gateia UI/API/worker/tool (doc 24-pwa.md §7).',
  '{}'
)
ON CONFLICT ("key") DO NOTHING;
