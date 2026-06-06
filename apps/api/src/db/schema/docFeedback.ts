// docFeedback.ts - Feedback de artigos da Central de Ajuda (F10-S12).
//
// LGPD (doc 17 sec 9):
//   - user_id: onDelete SET NULL - Art. 18 VI LGPD.
//   - comment: texto livre com PII potencial. Redact no log, raw no DB.
//
// TODO (hardening): anonimizacao rows created_at < NOW() - 12 months.

import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users.js';

export const docFeedback = pgTable(
  'doc_feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    articleSlug: text('article_slug').notNull(),
    helpful: boolean('helpful').notNull(),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugIdx: index('idx_doc_feedback_slug').on(t.articleSlug, t.createdAt.desc()),
  }),
);
