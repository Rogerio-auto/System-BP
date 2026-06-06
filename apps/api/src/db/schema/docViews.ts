// docViews.ts - Visualizacoes de artigos da Central de Ajuda (F10-S12).
//
// LGPD (doc 17 sec 9):
//   - user_id: onDelete SET NULL - Art. 18 VI LGPD.
//
// TODO (hardening): anonimizacao rows viewed_at < NOW() - 12 months.

import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users.js';

export const docViews = pgTable(
  'doc_views',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    articleSlug: text('article_slug').notNull(),
    viewedAt: timestamp('viewed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugTimeIdx: index('idx_doc_views_slug_time').on(t.articleSlug, t.viewedAt.desc()),
  }),
);
