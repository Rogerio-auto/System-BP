// =============================================================================
// tutorialEvents.ts — Tabela de telemetria de adoção de tutoriais (F12-S07).
//
// Registra dois tipos de evento:
//   tutorial_opened    — drawer de ajuda aberto para um tutorial específico.
//   tutorial_completed — vídeo assistido até >90% (via onEnded do player).
//
// LGPD (doc 17 §9):
//   - user_id: FK ON DELETE SET NULL (Art. 18 VI LGPD — direito de exclusão).
//     Ao deletar o usuário, o evento é preservado para analytics (sem PII) mas
//     o vínculo de identidade é removido (user_id = NULL).
//   - Nenhum campo de PII armazenado além de user_id (pseudônimo por UUID).
//   - Sem campos de texto livre — feature_key e event_type são enums fechados.
//   - Retenção: TODO hardening — anonimizar rows > 12 meses (padrão doc_views).
//
// Multi-tenant:
//   - organization_id é NULL por design. Tutorial events são globais do produto
//     (tutorial = metadado global; quem assistiu é o usuário da org, não a org).
//     Sem applyCityScope — analytics agregado cross-org no MVP.
//
// Índices:
//   - idx_tutorial_events_tutorial_at: queries de "quantos viram este tutorial"
//   - idx_tutorial_events_user_at:     queries de "quais tutoriais este usuário abriu"
//   - idx_tutorial_events_type_at:     queries agregadas por tipo de evento
//
// A tabela NÃO tem FK para feature_tutorials.id intencionalmente:
//   Soft-delete de um tutorial não apaga o histórico de telemetria.
//   Referência por tutorial_id (UUID) é suficiente para joins.
// =============================================================================

import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users.js';

// ---------------------------------------------------------------------------
// Tipos de evento
// ---------------------------------------------------------------------------

/**
 * Tipo de evento de telemetria de tutorial.
 * tutorial_opened    — drawer aberto pelo usuário (click no ⓘ).
 * tutorial_completed — vídeo assistido até o fim (onEnded do player).
 */
export type TutorialEventType = 'tutorial_opened' | 'tutorial_completed';

// ---------------------------------------------------------------------------
// Tabela
// ---------------------------------------------------------------------------

export const tutorialEvents = pgTable(
  'tutorial_events',
  {
    /** PK UUID. */
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * ID do tutorial assistido.
     * Sem FK — soft-delete de feature_tutorials não deve apagar o histórico.
     * O UUID é suficiente para correlacionar com feature_tutorials.id em joins.
     */
    tutorialId: uuid('tutorial_id').notNull(),

    /**
     * Chave da funcionalidade associada ao tutorial.
     * Desnormalizado para facilitar queries agregadas sem join em feature_tutorials.
     * Ex: "crm.lead.create"
     */
    featureKey: text('feature_key').notNull(),

    /**
     * Tipo de evento.
     * tutorial_opened    — drawer aberto.
     * tutorial_completed — vídeo assistido até o fim (>90% via onEnded).
     */
    eventType: text('event_type', {
      enum: ['tutorial_opened', 'tutorial_completed'],
    })
      .notNull()
      .$type<TutorialEventType>(),

    /**
     * Usuário que gerou o evento.
     * FK ON DELETE SET NULL — remoção do usuário anonimiza o evento (LGPD Art. 18 VI).
     * null = evento anonimizado após deleção do usuário.
     */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),

    /**
     * Timestamp do evento.
     * Gravado pelo servidor (não confiamos no cliente) para garantir auditabilidade.
     */
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Queries: "quantos abriram/completaram este tutorial"
    idxTutorialAt: index('idx_tutorial_events_tutorial_at').on(
      table.tutorialId,
      table.occurredAt.desc(),
    ),
    // Queries: "quais tutoriais este usuário assistiu" (pós-anonimização: NULL)
    idxUserAt: index('idx_tutorial_events_user_at').on(table.userId, table.occurredAt.desc()),
    // Queries agregadas por tipo: "total de completed nas últimas 30 dias"
    idxTypeAt: index('idx_tutorial_events_type_at').on(table.eventType, table.occurredAt.desc()),
  }),
);

// ---------------------------------------------------------------------------
// Tipos Drizzle exportados
// ---------------------------------------------------------------------------

export type TutorialEvent = typeof tutorialEvents.$inferSelect;
export type NewTutorialEvent = typeof tutorialEvents.$inferInsert;
