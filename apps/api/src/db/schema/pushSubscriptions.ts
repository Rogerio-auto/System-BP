// =============================================================================
// pushSubscriptions.ts — Destino do Web Push (F27-S05).
//
// Contexto (docs/24-pwa.md §8): uma linha por device/browser que fez opt-in
// de push no Manager instalado como PWA. Guarda o endpoint do push service
// (URL única do browser/OS) + as chaves ECDH (p256dh/auth) exigidas pelo
// protocolo Web Push (RFC 8291) para cifrar o payload entregue pelo sender
// (VAPID, F27-S06).
//
// Multi-tenant:
//   organization_id NOT NULL em toda tabela de domínio (§8 CLAUDE.md).
//
// Dono:
//   user_id NOT NULL FK → users, ON DELETE CASCADE — a subscription só existe
//   para o usuário notificar SEU PRÓPRIO device; sem o dono, não há para quem
//   entregar o push (mesmo raciocínio de assistant_conversations, F6-S24).
//
// updated_at:
//   Bumped via trigger set_updated_at (reutilizada desde 0000_init, mesmo
//   padrão de assistant_conversations/credit_analyses/followup_rules) em
//   qualquer UPDATE da linha (ex.: renovação de keys pelo browser).
//
// LGPD (docs/24-pwa.md §9, docs/17-lgpd-protecao-dados.md vence):
//   - endpoint/p256dh/auth identificam device/usuário — DADO PESSOAL. Nunca
//     em log claro; pino.redact é responsabilidade do slot de backend
//     (F27-S06), que também trata payload de push sem PII e retenção.
//   - deleted_at é o hook de soft-delete para opt-out, logout, subscriptions
//     mortas (404/410) e exercício do direito do titular.
//
// Índices:
//   - Único parcial em endpoint (WHERE deleted_at IS NULL): permite ao
//     endpoint de subscribe fazer UPSERT idempotente sem colidir com
//     endpoints já soft-deletados (que podem reviver após reinstalação).
//   - (user_id): fan-out do sender — "subscriptions ativas do usuário X" ao
//     entregar uma notificação (F27-S06).
// =============================================================================
import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { organizations } from './organizations.js';
import { users } from './users.js';

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /**
     * Multi-tenant root. Toda subscription pertence a uma organização.
     * NOT NULL: garante isolamento multi-tenant desde o dia 1 (§8 CLAUDE.md).
     */
    organizationId: uuid('organization_id').notNull(),

    /**
     * Usuário dono do device — único que recebe push nesta subscription.
     * ON DELETE CASCADE: sem o dono não há para quem entregar o push; a
     * subscription não tem razão de existir.
     */
    userId: uuid('user_id').notNull(),

    /**
     * URL do push service do browser/OS (ex.: FCM, Mozilla autopush) —
     * identificador único da subscription ativa de um device.
     * DADO PESSOAL (doc 24 §9) — nunca em log claro (pino.redact, F27-S06).
     */
    endpoint: text('endpoint').notNull(),

    /**
     * Chave pública ECDH do client, exigida pelo protocolo Web Push
     * (RFC 8291) para cifrar o payload. DADO PESSOAL — nunca em log claro.
     */
    p256dh: text('p256dh').notNull(),

    /**
     * Segredo de autenticação do client, exigido pelo protocolo Web Push.
     * DADO PESSOAL — nunca em log claro.
     */
    auth: text('auth').notNull(),

    /**
     * Rótulo do device (User-Agent do browser) para a UI de gestão de
     * subscriptions do usuário ("Chrome no Windows", "Safari no iPhone").
     */
    userAgent: text('user_agent'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * Atualizado automaticamente via trigger set_updated_at em qualquer
     * UPDATE da linha (ex.: renovação de keys pelo browser).
     */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * Soft-delete. NULL = subscription ativa (recebe push). NOT NULL =
     * opt-out, logout, subscription morta (404/410) ou exercício do direito
     * do titular (doc 24 §9 / doc 17).
     */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    // -------------------------------------------------------------------------
    // Foreign Keys (nomeadas explicitamente, on delete explícito)
    // -------------------------------------------------------------------------

    fkOrg: foreignKey({
      name: 'fk_push_subscriptions_organization',
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete('restrict'),

    fkUser: foreignKey({
      name: 'fk_push_subscriptions_user',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('cascade'),

    // -------------------------------------------------------------------------
    // Índices
    // -------------------------------------------------------------------------

    /**
     * Único parcial: upsert idempotente por endpoint entre subscriptions
     * ATIVAS. Permite ao mesmo endpoint reviver (nova linha) após
     * soft-delete da anterior (reinstalação do PWA / nova permissão).
     */
    uqEndpointActive: uniqueIndex('uq_push_subscriptions_endpoint_active')
      .on(table.endpoint)
      .where(sql`${table.deletedAt} IS NULL`),

    /**
     * Fan-out do sender (F27-S06): "subscriptions ativas do usuário X" ao
     * entregar uma notificação.
     */
    idxUserId: index('idx_push_subscriptions_user_id').on(table.userId),
  }),
);

export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type NewPushSubscription = typeof pushSubscriptions.$inferInsert;
