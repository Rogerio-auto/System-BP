// =============================================================================
// templates/repository.ts — Acesso a dados para whatsapp_templates.
//
// Contexto: F5-S09.
// Todas as operações são org-scoped (multi-tenant).
// =============================================================================
import { and, count, eq, ilike, type SQL } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { whatsappTemplates } from '../../db/schema/whatsappTemplates.js';

import type { TemplateCreate, TemplateListQuery, TemplateUpdate } from './schemas.js';

// ---------------------------------------------------------------------------
// Tipo de transação Drizzle (estrutural mínimo para compatibilidade)
// ---------------------------------------------------------------------------

export interface RepoTx {
  insert: Database['insert'];
  update: Database['update'];
  select: Database['select'];
  delete: Database['delete'];
}

// ---------------------------------------------------------------------------
// listTemplates
// ---------------------------------------------------------------------------

/**
 * Lista paginada de templates filtrados por status/categoria/idioma.
 * Org-scoped.
 */
export async function listTemplates(
  db: Database,
  organizationId: string,
  query: TemplateListQuery,
): Promise<{ data: (typeof whatsappTemplates.$inferSelect)[]; total: number }> {
  const conditions: SQL[] = [eq(whatsappTemplates.organizationId, organizationId)];

  if (query.status) {
    conditions.push(eq(whatsappTemplates.status, query.status));
  }
  if (query.category) {
    conditions.push(eq(whatsappTemplates.category, query.category));
  }
  if (query.language) {
    conditions.push(ilike(whatsappTemplates.language, query.language));
  }

  const where = and(...conditions);
  const offset = (query.page - 1) * query.limit;

  const [rows, countResult] = await Promise.all([
    db.select().from(whatsappTemplates).where(where).limit(query.limit).offset(offset),
    db.select({ total: count() }).from(whatsappTemplates).where(where),
  ]);

  const total = countResult[0]?.total ?? 0;
  return { data: rows, total: Number(total) };
}

// ---------------------------------------------------------------------------
// getTemplateById
// ---------------------------------------------------------------------------

export async function getTemplateById(
  db: Database,
  id: string,
  organizationId: string,
): Promise<typeof whatsappTemplates.$inferSelect | undefined> {
  const rows = await db
    .select()
    .from(whatsappTemplates)
    .where(and(eq(whatsappTemplates.id, id), eq(whatsappTemplates.organizationId, organizationId)))
    .limit(1);
  return rows[0];
}

// ---------------------------------------------------------------------------
// getTemplateByMetaId
// ---------------------------------------------------------------------------

export async function getTemplateByMetaId(
  db: Database,
  metaTemplateId: string,
  organizationId: string,
): Promise<typeof whatsappTemplates.$inferSelect | undefined> {
  const rows = await db
    .select()
    .from(whatsappTemplates)
    .where(
      and(
        eq(whatsappTemplates.metaTemplateId, metaTemplateId),
        eq(whatsappTemplates.organizationId, organizationId),
      ),
    )
    .limit(1);
  return rows[0];
}

// ---------------------------------------------------------------------------
// insertTemplate
// ---------------------------------------------------------------------------

export async function insertTemplate(
  db: Database | RepoTx,
  organizationId: string,
  metaTemplateId: string,
  data: TemplateCreate,
): Promise<typeof whatsappTemplates.$inferSelect> {
  const inserted = await (db as Database)
    .insert(whatsappTemplates)
    .values({
      organizationId,
      metaTemplateId,
      name: data.name,
      category: data.category,
      language: data.language,
      body: data.body,
      variables: data.variables,
      status: 'pending',
    })
    .returning();

  const row = inserted[0];
  if (!row) throw new Error('INSERT whatsapp_templates retornou vazio');
  return row;
}

// ---------------------------------------------------------------------------
// updateTemplateStatus
// ---------------------------------------------------------------------------

export async function updateTemplateStatus(
  db: Database | RepoTx,
  id: string,
  organizationId: string,
  status: 'pending' | 'approved' | 'rejected' | 'paused',
): Promise<typeof whatsappTemplates.$inferSelect | undefined> {
  const updated = await (db as Database)
    .update(whatsappTemplates)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(whatsappTemplates.id, id), eq(whatsappTemplates.organizationId, organizationId)))
    .returning();
  return updated[0];
}

// ---------------------------------------------------------------------------
// updateTemplateStatusByMetaId
// ---------------------------------------------------------------------------

/**
 * Atualiza o status de um template pelo seu ID externo Meta.
 * Usado pelo webhook handler de template_status_update.
 */
export async function updateTemplateStatusByMetaId(
  db: Database | RepoTx,
  metaTemplateId: string,
  organizationId: string,
  status: 'pending' | 'approved' | 'rejected' | 'paused',
): Promise<typeof whatsappTemplates.$inferSelect | undefined> {
  const updated = await (db as Database)
    .update(whatsappTemplates)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(whatsappTemplates.metaTemplateId, metaTemplateId),
        eq(whatsappTemplates.organizationId, organizationId),
      ),
    )
    .returning();
  return updated[0];
}

// ---------------------------------------------------------------------------
// updateTemplateContent (apenas pending/rejected)
// ---------------------------------------------------------------------------

export async function updateTemplateContent(
  db: Database | RepoTx,
  id: string,
  organizationId: string,
  data: TemplateUpdate,
): Promise<typeof whatsappTemplates.$inferSelect | undefined> {
  const patch: Partial<typeof whatsappTemplates.$inferInsert> = { updatedAt: new Date() };
  if (data.body !== undefined) patch.body = data.body;
  if (data.variables !== undefined) patch.variables = data.variables;
  if (data.category !== undefined) patch.category = data.category;
  if (data.language !== undefined) patch.language = data.language;

  const updated = await (db as Database)
    .update(whatsappTemplates)
    .set(patch)
    .where(and(eq(whatsappTemplates.id, id), eq(whatsappTemplates.organizationId, organizationId)))
    .returning();
  return updated[0];
}

// ---------------------------------------------------------------------------
// softDeleteTemplate (status=paused)
// ---------------------------------------------------------------------------

export async function softDeleteTemplate(
  db: Database | RepoTx,
  id: string,
  organizationId: string,
): Promise<typeof whatsappTemplates.$inferSelect | undefined> {
  return updateTemplateStatus(db, id, organizationId, 'paused');
}

// ---------------------------------------------------------------------------
// getAllTemplates (para sync-all)
// ---------------------------------------------------------------------------

export async function getAllTemplates(
  db: Database,
  organizationId: string,
): Promise<(typeof whatsappTemplates.$inferSelect)[]> {
  return db
    .select()
    .from(whatsappTemplates)
    .where(eq(whatsappTemplates.organizationId, organizationId));
}
