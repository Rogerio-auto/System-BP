// =============================================================================
// templates/service.ts — Lógica de negócio para gestão de templates WhatsApp.
//
// Contexto: F5-S09.
//
// Responsabilidades:
//   - Criar template local + submeter na Meta (atomic: rollback se Meta falhar).
//   - Editar template local (apenas pending/rejected).
//   - Soft delete (status=paused, não remove da Meta).
//   - Sync individual: busca status atual na Meta e atualiza local.
//   - Sync-all: sync batch de todos os templates (gated por flag).
//   - Auditoria em toda mutação (actor + diff).
//   - Outbox event `templates.status_changed`.
//
// LGPD:
//   - Template body não contém PII (validado upstream pelo Zod schema).
//   - Audit log não inclui campos sensíveis.
//   - Event outbox não inclui PII — apenas IDs.
// =============================================================================
import { db } from '../../db/client.js';
import { emit } from '../../events/emit.js';
import { auditLog } from '../../lib/audit.js';
import { logger } from '../../lib/logger.js';
import { AppError, NotFoundError } from '../../shared/errors.js';

import { MetaTemplatesClient } from './metaClient.js';
import {
  getAllTemplates,
  getTemplateById,
  insertTemplate,
  listTemplates,
  softDeleteTemplate,
  updateTemplateContent,
  updateTemplateStatus,
} from './repository.js';
import type {
  TemplateCreate,
  TemplateListQuery,
  TemplateListResponse,
  TemplateResponse,
  TemplateUpdate,
} from './schemas.js';

// ---------------------------------------------------------------------------
// Actor context
// ---------------------------------------------------------------------------

export interface ActorContext {
  userId: string;
  organizationId: string;
  role: string;
  ip?: string | null;
  userAgent?: string | null;
}

// ---------------------------------------------------------------------------
// Serialização
// ---------------------------------------------------------------------------

function toResponse(row: {
  id: string;
  organizationId: string;
  metaTemplateId: string;
  name: string;
  category: 'utility' | 'marketing' | 'authentication';
  language: string;
  body: string;
  variables: string[];
  status: 'pending' | 'approved' | 'rejected' | 'paused';
  createdAt: Date;
  updatedAt: Date;
}): TemplateResponse {
  return {
    id: row.id,
    organizationId: row.organizationId,
    metaTemplateId: row.metaTemplateId,
    name: row.name,
    category: row.category,
    language: row.language,
    body: row.body,
    variables: row.variables,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Mapeia status da Meta (uppercase) para status local (lowercase). */
function mapMetaStatus(metaStatus: string): 'pending' | 'approved' | 'rejected' | 'paused' {
  const map: Record<string, 'pending' | 'approved' | 'rejected' | 'paused'> = {
    PENDING: 'pending',
    APPROVED: 'approved',
    REJECTED: 'rejected',
    PAUSED: 'paused',
    DISABLED: 'paused',
    IN_APPEAL: 'pending',
  };
  return map[metaStatus.toUpperCase()] ?? 'pending';
}

// ---------------------------------------------------------------------------
// listTemplates
// ---------------------------------------------------------------------------

export async function listTemplatesService(
  actor: ActorContext,
  query: TemplateListQuery,
): Promise<TemplateListResponse> {
  const { data, total } = await listTemplates(db, actor.organizationId, query);
  const totalPages = Math.ceil(total / query.limit);
  return {
    data: data.map(toResponse),
    total,
    page: query.page,
    limit: query.limit,
    totalPages,
  };
}

// ---------------------------------------------------------------------------
// getTemplate
// ---------------------------------------------------------------------------

export async function getTemplateService(
  actor: ActorContext,
  id: string,
): Promise<TemplateResponse> {
  const row = await getTemplateById(db, id, actor.organizationId);
  if (!row) throw new NotFoundError(`Template ${id} não encontrado`);
  return toResponse(row);
}

// ---------------------------------------------------------------------------
// createTemplate
// ---------------------------------------------------------------------------

export async function createTemplateService(
  actor: ActorContext,
  data: TemplateCreate,
  idempotencyKey: string,
): Promise<TemplateResponse> {
  // Submeter na Meta primeiro para obter o metaTemplateId
  const metaClient = new MetaTemplatesClient();

  // Mapear categoria para o formato esperado pela Meta (uppercase)
  const categoryMap: Record<string, 'UTILITY' | 'MARKETING' | 'AUTHENTICATION'> = {
    utility: 'UTILITY',
    marketing: 'MARKETING',
    authentication: 'AUTHENTICATION',
  };

  // M-2: submitTemplate antes da transação DB — se o INSERT falhar, compensamos deletando
  // o template fantasma na Meta. Sem compensação, o operador teria de resolver manualmente.
  let metaTemplateId: string | undefined;

  try {
    metaTemplateId = await metaClient.submitTemplate({
      name: data.name,
      category: categoryMap[data.category] ?? 'UTILITY',
      language: data.language,
      components: [{ type: 'BODY', text: data.body }],
    });

    // Persistir local em transação com auditoria + outbox
    let insertedRow: Awaited<ReturnType<typeof insertTemplate>>;

    await db.transaction(async (tx) => {
      insertedRow = await insertTemplate(
        tx as Parameters<typeof insertTemplate>[0],
        actor.organizationId,
        metaTemplateId!,
        data,
      );

      await auditLog(tx, {
        actor: {
          userId: actor.userId,
          role: actor.role,
          ip: actor.ip ?? null,
          userAgent: actor.userAgent ?? null,
        },
        action: 'template.created',
        resource: { type: 'whatsapp_template', id: insertedRow.id },
        organizationId: actor.organizationId,
        before: null,
        after: {
          name: data.name,
          category: data.category,
          language: data.language,
          status: 'pending',
          metaTemplateId,
        },
        correlationId: idempotencyKey,
      });

      await emit(tx, {
        eventName: 'templates.status_changed',
        aggregateType: 'whatsapp_template',
        aggregateId: insertedRow.id,
        organizationId: actor.organizationId,
        actor: { kind: 'user', id: actor.userId, ip: actor.ip ?? null },
        idempotencyKey: `templates.status_changed:${insertedRow.id}:created`,
        data: {
          template_id: insertedRow.id,
          previous_status: null,
          new_status: 'pending',
        },
      });
    });

    return toResponse(insertedRow!);
  } catch (e) {
    // M-2 compensação: se o INSERT local falhou mas o submit já ocorreu,
    // tentar deletar o template fantasma na Meta para evitar inconsistência.
    // A deleção usa o nome do template (requisito Meta API).
    if (metaTemplateId !== undefined) {
      await metaClient.deleteTemplate(data.name).catch((deleteErr: unknown) => {
        const errMsg = deleteErr instanceof Error ? deleteErr.message : String(deleteErr);
        logger.error(
          { metaTemplateId, templateName: data.name, err: { message: errMsg } },
          'createTemplate: compensation_failed — template fantasma na Meta requer remoção manual',
        );
      });
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// updateTemplate
// ---------------------------------------------------------------------------

export async function updateTemplateService(
  actor: ActorContext,
  id: string,
  data: TemplateUpdate,
): Promise<TemplateResponse> {
  const existing = await getTemplateById(db, id, actor.organizationId);
  if (!existing) throw new NotFoundError(`Template ${id} não encontrado`);

  if (existing.status !== 'pending' && existing.status !== 'rejected') {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      `Template só pode ser editado quando status é 'pending' ou 'rejected'. Status atual: ${existing.status}`,
    );
  }

  let updatedRow: typeof existing | undefined;

  await db.transaction(async (tx) => {
    updatedRow = await updateTemplateContent(
      tx as Parameters<typeof updateTemplateContent>[0],
      id,
      actor.organizationId,
      data,
    );
    if (!updatedRow) throw new NotFoundError(`Template ${id} não encontrado`);

    // L-2: audit sem body completo — registra QUE campos mudaram, não o conteúdo.
    // Template body pode conter texto de marketing longo; não há necessidade de
    // armazenar o texto completo no audit log para rastreabilidade de mudanças.
    await auditLog(tx, {
      actor: {
        userId: actor.userId,
        role: actor.role,
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
      },
      action: 'template.updated',
      resource: { type: 'whatsapp_template', id },
      organizationId: actor.organizationId,
      before: {
        id,
        body_changed: data.body !== undefined && data.body !== existing.body,
        variables: existing.variables,
        category: existing.category,
        language: existing.language,
      },
      after: {
        id,
        body_changed: data.body !== undefined && data.body !== existing.body,
        variables: data.variables ?? existing.variables,
        category: data.category ?? existing.category,
        language: data.language ?? existing.language,
      },
      correlationId: null,
    });
  });

  return toResponse(updatedRow!);
}

// ---------------------------------------------------------------------------
// deleteTemplate (soft: status=paused)
// ---------------------------------------------------------------------------

export async function deleteTemplateService(
  actor: ActorContext,
  id: string,
): Promise<TemplateResponse> {
  const existing = await getTemplateById(db, id, actor.organizationId);
  if (!existing) throw new NotFoundError(`Template ${id} não encontrado`);

  let updatedRow: typeof existing | undefined;

  await db.transaction(async (tx) => {
    updatedRow = await softDeleteTemplate(
      tx as Parameters<typeof softDeleteTemplate>[0],
      id,
      actor.organizationId,
    );

    await auditLog(tx, {
      actor: {
        userId: actor.userId,
        role: actor.role,
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
      },
      action: 'template.deleted',
      resource: { type: 'whatsapp_template', id },
      organizationId: actor.organizationId,
      before: { status: existing.status },
      after: { status: 'paused' },
      correlationId: null,
    });

    await emit(tx, {
      eventName: 'templates.status_changed',
      aggregateType: 'whatsapp_template',
      aggregateId: id,
      organizationId: actor.organizationId,
      actor: { kind: 'user', id: actor.userId, ip: actor.ip ?? null },
      // M-3: key determinística — (template, ator, ação) → sem replay duplicado em outbox
      idempotencyKey: `templates.status_changed:${id}:deleted:${actor.userId}`,
      data: {
        template_id: id,
        previous_status: existing.status,
        new_status: 'paused',
      },
    });
  });

  return toResponse(updatedRow!);
}

// ---------------------------------------------------------------------------
// syncTemplate (individual)
// ---------------------------------------------------------------------------

export async function syncTemplateService(
  actor: ActorContext,
  id: string,
  idempotencyKey: string,
): Promise<TemplateResponse> {
  const existing = await getTemplateById(db, id, actor.organizationId);
  if (!existing) throw new NotFoundError(`Template ${id} não encontrado`);

  const metaClient = new MetaTemplatesClient();
  const metaRecord = await metaClient.getTemplate(existing.metaTemplateId);
  const newStatus = mapMetaStatus(metaRecord.status);

  let updatedRow: typeof existing | undefined;

  await db.transaction(async (tx) => {
    updatedRow = await updateTemplateStatus(
      tx as Parameters<typeof updateTemplateStatus>[0],
      id,
      actor.organizationId,
      newStatus,
    );

    if (existing.status !== newStatus) {
      await auditLog(tx, {
        actor: {
          userId: actor.userId,
          role: actor.role,
          ip: actor.ip ?? null,
          userAgent: actor.userAgent ?? null,
        },
        action: 'template.synced',
        resource: { type: 'whatsapp_template', id },
        organizationId: actor.organizationId,
        before: { status: existing.status },
        after: { status: newStatus },
        correlationId: idempotencyKey,
      });

      await emit(tx, {
        eventName: 'templates.status_changed',
        aggregateType: 'whatsapp_template',
        aggregateId: id,
        organizationId: actor.organizationId,
        actor: { kind: 'user', id: actor.userId, ip: actor.ip ?? null },
        idempotencyKey: `templates.status_changed:${id}:sync:${idempotencyKey}`,
        data: {
          template_id: id,
          previous_status: existing.status,
          new_status: newStatus,
        },
      });
    }
  });

  return toResponse(updatedRow ?? existing);
}

// ---------------------------------------------------------------------------
// syncAll
// ---------------------------------------------------------------------------

export async function syncAllService(
  actor: ActorContext,
): Promise<{ synced: number; unchanged: number; errors: number }> {
  const templates = await getAllTemplates(db, actor.organizationId);
  const metaClient = new MetaTemplatesClient();

  let synced = 0;
  let unchanged = 0;
  let errors = 0;

  // Semáforo simples em memória — 3 concorrentes máximo para evitar rate-limit
  const CONCURRENCY = 3;
  const chunks: (typeof templates)[] = [];
  for (let i = 0; i < templates.length; i += CONCURRENCY) {
    chunks.push(templates.slice(i, i + CONCURRENCY));
  }

  for (const chunk of chunks) {
    await Promise.all(
      chunk.map(async (tmpl) => {
        try {
          const metaRecord = await metaClient.getTemplate(tmpl.metaTemplateId);
          const newStatus = mapMetaStatus(metaRecord.status);

          if (tmpl.status !== newStatus) {
            await db.transaction(async (tx) => {
              await updateTemplateStatus(
                tx as Parameters<typeof updateTemplateStatus>[0],
                tmpl.id,
                actor.organizationId,
                newStatus,
              );

              await auditLog(tx, {
                actor: {
                  userId: actor.userId,
                  role: actor.role,
                  ip: actor.ip ?? null,
                  userAgent: actor.userAgent ?? null,
                },
                action: 'template.synced',
                resource: { type: 'whatsapp_template', id: tmpl.id },
                organizationId: actor.organizationId,
                before: { status: tmpl.status },
                after: { status: newStatus },
                correlationId: null,
              });

              await emit(tx, {
                eventName: 'templates.status_changed',
                aggregateType: 'whatsapp_template',
                aggregateId: tmpl.id,
                organizationId: actor.organizationId,
                actor: { kind: 'system', id: null, ip: null },
                // M-3: key determinística — (template, ator, ação) → sem replay duplicado em outbox
                idempotencyKey: `templates.status_changed:${tmpl.id}:sync-all:${actor.userId}`,
                data: {
                  template_id: tmpl.id,
                  previous_status: tmpl.status,
                  new_status: newStatus,
                },
              });
            });
            synced++;
          } else {
            unchanged++;
          }
        } catch {
          errors++;
        }
      }),
    );
  }

  return { synced, unchanged, errors };
}
