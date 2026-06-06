// help/repository.ts - Queries Drizzle para telemetria (F10-S12).

import { count, desc, gte, sql } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { docFeedback } from '../../db/schema/docFeedback.js';
import { docViews } from '../../db/schema/docViews.js';

import type { PopularItem, RecordFeedbackBodyInput } from './schemas.js';

export async function recordView(db: Database, userId: string, slug: string): Promise<void> {
  await db.insert(docViews).values({ userId, articleSlug: slug });
}

export async function recordFeedback(
  db: Database,
  userId: string,
  input: Pick<RecordFeedbackBodyInput, 'slug' | 'helpful' | 'comment'>,
): Promise<{ id: string }> {
  const rows = await db
    .insert(docFeedback)
    .values({
      userId,
      articleSlug: input.slug,
      helpful: input.helpful,
      comment: input.comment ?? null,
    })
    .returning({ id: docFeedback.id });
  return { id: rows[0]!.id };
}

export async function getPopular(db: Database, limit: number, since: Date): Promise<PopularItem[]> {
  const rows = await db
    .select({
      slug: docViews.articleSlug,
      count: count(docViews.id),
    })
    .from(docViews)
    .where(gte(docViews.viewedAt, since))
    .groupBy(docViews.articleSlug)
    .orderBy(desc(sql<number>`count(${docViews.id})`))
    .limit(limit);
  return rows.map((row) => ({ slug: row.slug, count: Number(row.count) }));
}
