// =============================================================================
// featureFlags/repository.ts — Queries Drizzle para a tabela feature_flags.
//
// Nota: feature_flags não é multi-tenant (flags são globais de plataforma).
// Não usa applyCityScope — ver schema featureFlags.ts para justificativa.
// =============================================================================
import { eq } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { featureFlags } from '../../db/schema/featureFlags.js';

import type { PatchFeatureFlagBody } from './schemas.js';

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Lista todas as flags (admin). */
export async function listAllFlags(db: Database) {
  return db.select().from(featureFlags).orderBy(featureFlags.key);
}

/** Busca uma flag por key. Retorna undefined se não existir. */
export async function findFlagByKey(db: Database, key: string) {
  const [row] = await db.select().from(featureFlags).where(eq(featureFlags.key, key)).limit(1);
  return row;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Atualiza campos de uma flag existente.
 * Lança se a flag não existir (Postgres não retorna rows em update inexistente).
 *
 * @returns A flag atualizada.
 */
export async function updateFlag(
  db: Database,
  key: string,
  patch: PatchFeatureFlagBody,
  updatedByUserId: string,
) {
  const [updated] = await db
    .update(featureFlags)
    .set({
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.visible !== undefined ? { visible: patch.visible } : {}),
      ...(patch.ui_label !== undefined ? { uiLabel: patch.ui_label } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.audience !== undefined ? { audience: patch.audience } : {}),
      updatedBy: updatedByUserId,
      updatedAt: new Date(),
    })
    .where(eq(featureFlags.key, key))
    .returning();

  return updated;
}
