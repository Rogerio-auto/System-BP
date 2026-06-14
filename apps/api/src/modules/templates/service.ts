// =============================================================================
// templates/service.ts — Lógica de negócio para gestão de templates WhatsApp.
//
// Contexto: F5-S09, F5-S12.
//
// Responsabilidades:
//   - Criar template local + submeter na Meta (atomic: rollback se Meta falhar).
//   - Editar template local (apenas pending/rejected).
//   - Soft delete (status=paused, não remove da Meta).
//   - Sync individual: busca status atual na Meta e atualiza local.
//   - Sync-all: sync batch de todos os templates (gated por flag).
//   - Auditoria em toda mutação (actor + diff, incluindo header_type).
//   - Outbox event `templates.status_changed`.
//
// F5-S12 — header de mídia:
//   - headerType='text' → componente HEADER format=TEXT + text.
//   - headerType in ('document','image','video') → exige amostra (Buffer), chama
//     uploadSampleForTemplate() → persiste header_handle.
//   - Gate: templates.media.enabled (feature flag) bloqueia criação/edição de
//     templates de mídia quando desabilitada.
//   - Template já approved não pode ter headerType alterado (Meta exige resubmissão).
//
// LGPD:
//   - Template body/headerText não contêm PII (validado upstream pelo Zod).
//   - Bytes da amostra nunca são logados.
//   - Audit log não inclui campos sensíveis.
//   - Event outbox não inclui PII — apenas IDs.
// =============================================================================
import { db } from '../../db/client.js';
import { emit } from '../../events/emit.js';
import { auditLog } from '../../lib/audit.js';
import { logger } from '../../lib/logger.js';
import { isFlagEnabled } from '../../modules/featureFlags/service.js';
import { AppError, FeatureDisabledError, NotFoundError } from '../../shared/errors.js';

import type { MetaTemplateComponent } from './metaClient.js';
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
  TemplateHeaderType,
  TemplateListQuery,
  TemplateListResponse,
  TemplateResponse,
  TemplateUpdate,
} from './schemas.js';
import { MEDIA_HEADER_TYPES } from './schemas.js';

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
  headerType: 'none' | 'text' | 'document' | 'image' | 'video';
  headerText: string | null;
  headerHandle: string | null;
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
    headerType: row.headerType,
    headerText: row.headerText,
    headerHandle: row.headerHandle,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Gate: templates.media.enabled
// ---------------------------------------------------------------------------

/**
 * Lança FeatureDisabledError se a flag templates.media.enabled estiver desligada
 * e o headerType solicitado for de mídia (document/image/video).
 */
async function assertMediaGate(headerType: TemplateHeaderType): Promise<void> {
  if (!(MEDIA_HEADER_TYPES as readonly string[]).includes(headerType)) return;

  const { enabled } = await isFlagEnabled(db, 'templates.media.enabled');
  if (!enabled) {
    throw new FeatureDisabledError('templates.media.enabled');
  }
}

// ---------------------------------------------------------------------------
// Helpers — componentes Meta
// ---------------------------------------------------------------------------

/**
 * Monta os componentes do template para o payload Meta.
 * Inclui HEADER quando headerType ≠ 'none'.
 */
function buildMetaComponents(
  data: TemplateCreate | (TemplateUpdate & { body: string }),
  headerHandle: string | null,
): MetaTemplateComponent[] {
  const components: MetaTemplateComponent[] = [];

  const headerType = ('headerType' in data ? data.headerType : undefined) ?? 'none';

  if (headerType === 'text' && 'headerText' in data && data.headerText) {
    components.push({
      type: 'HEADER',
      format: 'TEXT',
      text: data.headerText,
    });
  } else if (
    (MEDIA_HEADER_TYPES as readonly string[]).includes(headerType) &&
    headerHandle !== null
  ) {
    const formatMap: Record<string, 'DOCUMENT' | 'IMAGE' | 'VIDEO'> = {
      document: 'DOCUMENT',
      image: 'IMAGE',
      video: 'VIDEO',
    };
    const format = formatMap[headerType];
    if (format) {
      components.push({
        type: 'HEADER',
        format,
        example: { header_handle: [headerHandle] },
      });
    }
  }

  components.push({ type: 'BODY', text: data.body });
  return components;
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

/**
 * Cria um template local + submete na Meta.
 *
 * @param sampleFile  Buffer da amostra de mídia (obrigatório quando headerType in
 *                    ('document','image','video')). LGPD §8.3: nunca logado.
 * @param sampleMime  MIME type da amostra (ex: 'application/pdf', 'image/jpeg').
 */
export async function createTemplateService(
  actor: ActorContext,
  data: TemplateCreate,
  idempotencyKey: string,
  sampleFile?: Buffer,
  sampleMime?: string,
): Promise<TemplateResponse> {
  const headerType = data.headerType ?? 'none';

  // Gate: templates de mídia bloqueados quando flag desabilitada
  await assertMediaGate(headerType);

  // Validar que mídia forneceu amostra
  if ((MEDIA_HEADER_TYPES as readonly string[]).includes(headerType)) {
    if (!sampleFile || !sampleMime) {
      throw new AppError(
        422,
        'VALIDATION_ERROR',
        `Templates com header de mídia (${headerType}) requerem o campo 'sampleUpload' no multipart.`,
      );
    }
  }

  const metaClient = new MetaTemplatesClient();

  const categoryMap: Record<string, 'UTILITY' | 'MARKETING' | 'AUTHENTICATION'> = {
    utility: 'UTILITY',
    marketing: 'MARKETING',
    authentication: 'AUTHENTICATION',
  };

  // Etapa 1 (pré-transação): upload da amostra de mídia, se necessário.
  // LGPD §8.3: bytes nunca logados; apenas mimeType em contexto de erro.
  let headerHandle: string | null = null;
  if (sampleFile && sampleMime) {
    headerHandle = await metaClient.uploadSampleForTemplate(sampleFile, sampleMime);
  }

  // M-2: submitTemplate antes da transação DB — se o INSERT falhar, compensamos deletando
  // o template fantasma na Meta. Sem compensação, o operador teria de resolver manualmente.
  let metaTemplateId: string | undefined;

  try {
    metaTemplateId = await metaClient.submitTemplate({
      name: data.name,
      category: categoryMap[data.category] ?? 'UTILITY',
      language: data.language,
      components: buildMetaComponents(data, headerHandle),
    });

    // Persistir local em transação com auditoria + outbox
    let insertedRow: Awaited<ReturnType<typeof insertTemplate>>;

    await db.transaction(async (tx) => {
      insertedRow = await insertTemplate(
        tx as Parameters<typeof insertTemplate>[0],
        actor.organizationId,
        metaTemplateId!,
        data,
        headerHandle,
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
          // F5-S12: incluir header_type no diff de auditoria
          header_type: headerType,
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

/**
 * Edita um template local (somente pending/rejected).
 *
 * @param sampleFile  Buffer da amostra de mídia quando alterando para header de mídia.
 *                    LGPD §8.3: nunca logado.
 * @param sampleMime  MIME type da amostra.
 */
export async function updateTemplateService(
  actor: ActorContext,
  id: string,
  data: TemplateUpdate,
  sampleFile?: Buffer,
  sampleMime?: string,
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

  // Determinar o headerType efetivo após o update
  const effectiveHeaderType: TemplateHeaderType = data.headerType ?? existing.headerType;

  // Gate: templates de mídia bloqueados quando flag desabilitada
  await assertMediaGate(effectiveHeaderType);

  // Se estiver mudando para um tipo de mídia e não houver amostra, validar
  if (
    data.headerType !== undefined &&
    (MEDIA_HEADER_TYPES as readonly string[]).includes(data.headerType) &&
    !sampleFile
  ) {
    // Permitir update sem nova amostra somente se o headerType não está mudando
    // (a amostra existente no header_handle ainda é válida).
    // Se está mudando DE outro tipo PARA mídia, amostra é obrigatória.
    if (existing.headerType !== data.headerType) {
      throw new AppError(
        422,
        'VALIDATION_ERROR',
        `Alterar header para mídia (${data.headerType}) requer o campo 'sampleUpload' no multipart.`,
      );
    }
  }

  // Upload da amostra, se fornecida
  let headerHandle: string | undefined;
  if (sampleFile && sampleMime) {
    const metaClient = new MetaTemplatesClient();
    headerHandle = await metaClient.uploadSampleForTemplate(sampleFile, sampleMime);
  }

  let updatedRow: typeof existing | undefined;

  await db.transaction(async (tx) => {
    updatedRow = await updateTemplateContent(
      tx as Parameters<typeof updateTemplateContent>[0],
      id,
      actor.organizationId,
      data,
      headerHandle,
    );
    if (!updatedRow) throw new NotFoundError(`Template ${id} não encontrado`);

    // L-2: audit sem body completo — registra QUE campos mudaram, não o conteúdo.
    // F5-S12: inclui header_type no diff de auditoria.
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
        header_type: existing.headerType,
      },
      after: {
        id,
        body_changed: data.body !== undefined && data.body !== existing.body,
        variables: data.variables ?? existing.variables,
        category: data.category ?? existing.category,
        language: data.language ?? existing.language,
        header_type: effectiveHeaderType,
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
