// =============================================================================
// tutorials/repository.ts — Queries Drizzle para feature_tutorials (F12-S02).
//
// Norma: docs/21-tutoriais-em-video.md §4 e §9.
//
// Padrão de scope:
//   - GET público: filtra is_active = true AND deleted_at IS NULL.
//   - GET admin: filtra apenas deleted_at IS NULL (mostra inativos).
//   - Sem applyCityScope — feature_tutorials é metadado global de produto
//     (organization_id é nullable, NULL = global; consultar norma §4).
//
// Soft-delete:
//   DELETE lógico: SET deleted_at = now(), updated_at = now().
//   O registro permanece na tabela para preservar histórico.
// =============================================================================

import { and, eq, isNull } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { featureTutorials } from '../../db/schema/featureTutorials.js';
import { tutorialEvents } from '../../db/schema/tutorialEvents.js';

import type {
  CreateTutorialBody,
  PatchTutorialBody,
  RecordTutorialEventBody,
  TutorialAdminItem,
  TutorialPublicItem,
} from './schemas.js';

// ---------------------------------------------------------------------------
// Mapeamento de linhas DB → payload de resposta
// ---------------------------------------------------------------------------

type DbRow = typeof featureTutorials.$inferSelect;

function toPublicItem(row: DbRow): TutorialPublicItem {
  return {
    id: row.id,
    featureKey:
      // `as` justificado: featureKey em DB foi validado pelo schema Zod na escrita;
      // o tipo FeatureKey é subset de string já garantido em runtime.
      row.featureKey as TutorialPublicItem['featureKey'],
    title: row.title,
    description: row.description,
    provider:
      // `as` justificado: provider é enum constrained no DB (CHECK constraint);
      // os valores possíveis são 'youtube' | 'vimeo' | 'mp4' — todos válidos no tipo.
      row.provider as TutorialPublicItem['provider'],
    videoRef: row.videoRef,
    videoHash: row.videoHash ?? null,
    articleSlug: row.articleSlug ?? null,
    durationSeconds: row.durationSeconds ?? null,
  };
}

function toAdminItem(row: DbRow): TutorialAdminItem {
  return {
    id: row.id,
    organizationId: row.organizationId ?? null,
    featureKey:
      // `as` justificado: idem toPublicItem — featureKey validado no write.
      row.featureKey as TutorialAdminItem['featureKey'],
    title: row.title,
    description: row.description,
    provider:
      // `as` justificado: idem toPublicItem — provider é enum do DB.
      row.provider as TutorialAdminItem['provider'],
    videoRef: row.videoRef,
    videoHash: row.videoHash ?? null,
    articleSlug: row.articleSlug ?? null,
    durationSeconds: row.durationSeconds ?? null,
    isActive: row.isActive,
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt:
      row.deletedAt !== null && row.deletedAt !== undefined ? row.deletedAt.toISOString() : null,
  };
}

// ---------------------------------------------------------------------------
// Leitura pública
// ---------------------------------------------------------------------------

/**
 * Lista tutoriais ativos (is_active = true, deleted_at IS NULL).
 * Usado por GET /api/help/tutorials — qualquer autenticado.
 * Resultado é cacheável pelo frontend (TanStack Query).
 */
export async function listActiveTutorials(db: Database): Promise<TutorialPublicItem[]> {
  const rows = await db
    .select()
    .from(featureTutorials)
    .where(and(eq(featureTutorials.isActive, true), isNull(featureTutorials.deletedAt)))
    .orderBy(featureTutorials.createdAt);

  return rows.map(toPublicItem);
}

// ---------------------------------------------------------------------------
// Leitura admin
// ---------------------------------------------------------------------------

/**
 * Lista todos os tutoriais não-deletados (inclui inativos).
 * Usado por GET /api/admin/tutorials — requer tutorials:manage.
 */
export async function listAllTutorials(db: Database): Promise<TutorialAdminItem[]> {
  const rows = await db
    .select()
    .from(featureTutorials)
    .where(isNull(featureTutorials.deletedAt))
    .orderBy(featureTutorials.createdAt);

  return rows.map(toAdminItem);
}

/**
 * Busca um tutorial pelo ID (não-deletado).
 * Retorna null se não encontrado ou soft-deletado.
 */
export async function findTutorialById(
  db: Database,
  id: string,
): Promise<TutorialAdminItem | null> {
  const rows = await db
    .select()
    .from(featureTutorials)
    .where(and(eq(featureTutorials.id, id), isNull(featureTutorials.deletedAt)))
    .limit(1);

  const row = rows[0];
  return row !== undefined ? toAdminItem(row) : null;
}

/**
 * Verifica se já existe tutorial ativo com a mesma feature_key.
 * Usado para validar unicidade antes do POST.
 */
export async function findActiveByFeatureKey(
  db: Database,
  featureKey: string,
): Promise<TutorialAdminItem | null> {
  const rows = await db
    .select()
    .from(featureTutorials)
    .where(and(eq(featureTutorials.featureKey, featureKey), isNull(featureTutorials.deletedAt)))
    .limit(1);

  const row = rows[0];
  return row !== undefined ? toAdminItem(row) : null;
}

// ---------------------------------------------------------------------------
// Escrita admin
// ---------------------------------------------------------------------------

/**
 * Cria um novo tutorial.
 *
 * A idempotência de POST é verificada antes desta chamada (via idempotencyKey
 * comparado com featureKey existente — o service não chama esta função se o
 * registro já existe).
 */
export async function createTutorial(
  db: Database,
  input: Omit<CreateTutorialBody, 'idempotencyKey'>,
  createdBy: string,
): Promise<TutorialAdminItem> {
  const rows = await db
    .insert(featureTutorials)
    .values({
      featureKey: input.featureKey,
      title: input.title,
      description: input.description,
      provider: input.provider,
      videoRef: input.videoRef,
      videoHash: input.videoHash ?? null,
      articleSlug: input.articleSlug ?? null,
      durationSeconds: input.durationSeconds ?? null,
      isActive: input.isActive,
      createdBy,
    })
    .returning();

  const row = rows[0];
  if (row === undefined) {
    // Nunca deve ocorrer com Drizzle + Postgres; AppError lançado para satisfazer
    // o contrato de retorno não-null e manter o error handler centralizado.
    // Não lançamos Error puro por convenção do projeto.
    throw new Error('INSERT em feature_tutorials retornou 0 linhas — estado inesperado do DB');
  }
  return toAdminItem(row);
}

/**
 * Atualiza campos de um tutorial existente (PATCH parcial).
 * Seta updated_at = now() explicitamente (sem trigger SQL — convenção do projeto).
 * Retorna null se o tutorial não existe ou está soft-deletado.
 */
export async function updateTutorial(
  db: Database,
  id: string,
  input: PatchTutorialBody,
): Promise<TutorialAdminItem | null> {
  // Construir objeto de atualização apenas com campos presentes no payload.
  // updatedAt é sempre atualizado — convenção app-level (sem trigger SQL).
  const updateValues: Partial<typeof featureTutorials.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (input.title !== undefined) updateValues.title = input.title;
  if (input.description !== undefined) updateValues.description = input.description;
  if (input.provider !== undefined) updateValues.provider = input.provider;
  if (input.videoRef !== undefined) updateValues.videoRef = input.videoRef;
  if (input.isActive !== undefined) updateValues.isActive = input.isActive;

  // Campos nullish: undefined = não alterar; null = remover o valor.
  // 'videoHash' in input é verdadeiro apenas quando o campo foi enviado no body
  // (mesmo que com valor null). Se omitido do body pelo cliente, 'in' é false.
  if ('videoHash' in input && input.videoHash !== undefined) {
    updateValues.videoHash = input.videoHash;
  }
  if ('articleSlug' in input && input.articleSlug !== undefined) {
    updateValues.articleSlug = input.articleSlug;
  }
  if ('durationSeconds' in input && input.durationSeconds !== undefined) {
    updateValues.durationSeconds = input.durationSeconds;
  }

  const rows = await db
    .update(featureTutorials)
    .set(updateValues)
    .where(and(eq(featureTutorials.id, id), isNull(featureTutorials.deletedAt)))
    .returning();

  const row = rows[0];
  return row !== undefined ? toAdminItem(row) : null;
}

/**
 * Soft-delete: seta deleted_at = now() e updated_at = now().
 * Retorna true se o registro existia e foi deletado; false se não encontrado.
 */
export async function softDeleteTutorial(db: Database, id: string): Promise<boolean> {
  const now = new Date();
  const rows = await db
    .update(featureTutorials)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(featureTutorials.id, id), isNull(featureTutorials.deletedAt)))
    .returning({ id: featureTutorials.id });

  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Telemetria de adoção (F12-S07)
// ---------------------------------------------------------------------------

/**
 * Persiste um evento de telemetria de tutorial (opened ou completed).
 *
 * LGPD (doc 17 §9):
 *   - userId é pseudônimo (UUID). Sem PII adicional.
 *   - A tabela não armazena campos de texto livre.
 *   - FK ON DELETE SET NULL anonimiza ao deletar o usuário.
 *
 * Fire-and-forget no route handler — erros são silenciosos para não degradar a UX.
 */
export async function recordTutorialEvent(
  db: Database,
  input: RecordTutorialEventBody,
  userId: string,
): Promise<void> {
  await db.insert(tutorialEvents).values({
    tutorialId: input.tutorialId,
    featureKey: input.featureKey,
    eventType: input.eventType,
    userId,
  });
}
