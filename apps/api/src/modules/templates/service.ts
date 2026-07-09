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
import { resolveChannelForSend } from '../../modules/channels/channel-selection.service.js';
import { isFlagEnabled } from '../../modules/featureFlags/service.js';
import {
  AppError,
  ExternalServiceError,
  FeatureDisabledError,
  NotFoundError,
} from '../../shared/errors.js';

import type { MetaTemplateComponent, MetaTemplateRecord } from './metaClient.js';
import { MetaTemplatesClient } from './metaClient.js';
import {
  getAllTemplates,
  getTemplateById,
  insertTemplate,
  listTemplates,
  softDeleteTemplate,
  updateTemplateContent,
  updateTemplateStatus,
  upsertTemplateFromMeta,
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
// Factory: MetaTemplatesClient com credenciais do canal do banco (F20-S06)
// ---------------------------------------------------------------------------

/**
 * Resolve credenciais do canal via tabela `channels` e instancia MetaTemplatesClient.
 *
 * Centraliza a lógica F20-S06 para todos os callers deste service:
 *   createTemplateService, updateTemplateService, syncTemplateService, syncAllService.
 *
 * @param organizationId  Escopo de organização para resolução de canal.
 * @throws ExternalServiceError se nenhum canal ativo, sem WABA ID, ou sem token.
 */
async function buildMetaTemplatesClient(organizationId: string): Promise<MetaTemplatesClient> {
  const resolved = await resolveChannelForSend(db, organizationId, null);

  if (resolved.wabaId === null) {
    throw new ExternalServiceError(
      `Canal WhatsApp "${resolved.channelName}" não possui WABA ID configurado — ` +
        'necessário para gestão de templates. Reconfigure o canal no painel administrativo.',
      { upstreamStatus: 0 },
    );
  }

  return new MetaTemplatesClient({
    accessToken: resolved.accessToken,
    wabaId: resolved.wabaId,
    ...(resolved.metaAppId !== null && resolved.metaAppId !== undefined
      ? { appId: resolved.metaAppId }
      : {}),
  });
}

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
  // DB enum inclui 'video' por completude do contrato Meta; API exclui 'video' (M-2).
  // Parâmetro aceita o tipo DB mais largo; o cast abaixo é seguro porque nenhuma rota
  // de escrita aceita 'video' após M-2, logo rows com headerType='video' não são criados.
  headerType: 'none' | 'text' | 'document' | 'image' | 'video';
  headerText: string | null;
  headerHandle: string | null; // persistido no banco mas NÃO exposto na resposta pública (L-4)
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
    // Cast seguro: API schema exclui 'video' (M-2); nenhuma rota de escrita aceita
    // 'video' como input nesta versão, portanto o valor nunca será 'video' na prática.
    headerType: row.headerType as TemplateHeaderType,
    headerText: row.headerText,
    // headerHandle omitido da resposta pública — token opaco da Meta (L-4)
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Gate: templates.media.enabled
// ---------------------------------------------------------------------------

/**
 * Lança FeatureDisabledError se a flag templates.media.enabled estiver desligada
 * e o headerType solicitado for de mídia (document/image).
 *
 * @param userRoles Roles do actor para avaliação de audience 'internal_only' (L-1).
 *                  Sem roles, flags internal_only nunca liberam para o rollout interno.
 */
async function assertMediaGate(headerType: TemplateHeaderType, userRoles: string[]): Promise<void> {
  if (!(MEDIA_HEADER_TYPES as readonly string[]).includes(headerType)) return;

  const { enabled } = await isFlagEnabled(db, 'templates.media.enabled', userRoles);
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
    const formatMap: Record<string, 'DOCUMENT' | 'IMAGE'> = {
      document: 'DOCUMENT',
      image: 'IMAGE',
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

  // Gate: templates de mídia bloqueados quando flag desabilitada (L-1: passa roles do actor)
  await assertMediaGate(headerType, [actor.role]);

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

  // F20-S06: credenciais resolvidas via canal do banco, não via env vars.
  const metaClient = await buildMetaTemplatesClient(actor.organizationId);

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

  // Determinar o headerType efetivo após o update.
  // Cast de existing.headerType: DB inclui 'video' no enum por completude do contrato Meta,
  // mas a API não aceita 'video' como input (M-2). Rows com headerType='video' não existem
  // em produção nesta versão — cast seguro de boundary DB→API.
  const effectiveHeaderType: TemplateHeaderType =
    data.headerType ?? (existing.headerType as TemplateHeaderType);

  // Gate: aplica somente quando o request está MUDANDO o headerType para mídia (M-3).
  // Usar o tipo herdado do banco bloquearia edições de body/category em templates
  // de mídia já existentes quando a flag estiver off — comportamento incorreto.
  if (data.headerType !== undefined) {
    await assertMediaGate(data.headerType, [actor.role]);
  }

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
  // F20-S06: credenciais resolvidas via canal do banco, não via env vars.
  let headerHandle: string | undefined;
  if (sampleFile && sampleMime) {
    const metaClient = await buildMetaTemplatesClient(actor.organizationId);
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

  // F20-S06: credenciais resolvidas via canal do banco, não via env vars.
  const metaClient = await buildMetaTemplatesClient(actor.organizationId);
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
// Helpers para pull-from-meta
// ---------------------------------------------------------------------------

/** Extrai o texto do componente BODY da lista de componentes Meta. */
function parseBodyFromComponents(components: MetaTemplateComponent[]): string | null {
  const body = components.find((c) => c.type === 'BODY');
  return body?.text ?? null;
}

/** Infere headerType e headerText dos componentes Meta. */
function parseHeaderFromComponents(components: MetaTemplateComponent[]): {
  headerType: 'none' | 'text' | 'document' | 'image';
  headerText: string | null;
} {
  const header = components.find((c) => c.type === 'HEADER');
  if (!header) return { headerType: 'none', headerText: null };

  const fmt = (header.format ?? '').toUpperCase();
  if (fmt === 'TEXT') return { headerType: 'text', headerText: header.text ?? null };
  if (fmt === 'DOCUMENT') return { headerType: 'document', headerText: null };
  if (fmt === 'IMAGE') return { headerType: 'image', headerText: null };
  return { headerType: 'none', headerText: null };
}

/** Mapeia category Meta (uppercase) → local (lowercase). */
function mapMetaCategory(raw: string): 'utility' | 'marketing' | 'authentication' {
  const map: Record<string, 'utility' | 'marketing' | 'authentication'> = {
    UTILITY: 'utility',
    MARKETING: 'marketing',
    AUTHENTICATION: 'authentication',
  };
  return map[raw.toUpperCase()] ?? 'utility';
}

/** Extrai nomes semânticos de variáveis do body ('var1', 'var2'...) baseado em {{N}}. */
function extractVariables(body: string): string[] {
  const matches = body.matchAll(/\{\{(\d+)\}\}/g);
  const indices = new Set<number>();
  for (const m of matches) {
    const n = parseInt(m[1] ?? '0', 10);
    if (n > 0) indices.add(n);
  }
  return Array.from(indices)
    .sort((a, b) => a - b)
    .map((n) => `var${n}`);
}

// ---------------------------------------------------------------------------
// syncAll
// ---------------------------------------------------------------------------

export async function syncAllService(
  actor: ActorContext,
): Promise<{ synced: number; unchanged: number; errors: number }> {
  const templates = await getAllTemplates(db, actor.organizationId);
  // F20-S06: credenciais resolvidas via canal do banco, não via env vars.
  const metaClient = await buildMetaTemplatesClient(actor.organizationId);

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

// ---------------------------------------------------------------------------
// pullFromMeta — importa/sincroniza templates diretamente da WABA Meta
// ---------------------------------------------------------------------------

export async function pullFromMetaService(
  actor: ActorContext,
): Promise<{ imported: number; updated: number; unchanged: number; errors: number }> {
  const metaClient = await buildMetaTemplatesClient(actor.organizationId);
  const metaTemplates: MetaTemplateRecord[] = await metaClient.listTemplates();

  let imported = 0;
  let updated = 0;
  let unchanged = 0;
  let errors = 0;

  const CONCURRENCY = 3;
  const chunks: MetaTemplateRecord[][] = [];
  for (let i = 0; i < metaTemplates.length; i += CONCURRENCY) {
    chunks.push(metaTemplates.slice(i, i + CONCURRENCY));
  }

  for (const chunk of chunks) {
    await Promise.all(
      chunk.map(async (metaTmpl) => {
        try {
          const body = parseBodyFromComponents(metaTmpl.components ?? []);
          if (body === null) {
            errors++;
            return;
          }

          const { headerType, headerText } = parseHeaderFromComponents(metaTmpl.components ?? []);
          const category = mapMetaCategory(metaTmpl.category);
          const status = mapMetaStatus(metaTmpl.status);
          const variables = extractVariables(body);

          const { created, statusChanged, row } = await upsertTemplateFromMeta(
            db,
            actor.organizationId,
            metaTmpl.id,
            {
              name: metaTmpl.name,
              category,
              language: metaTmpl.language,
              body,
              variables,
              status,
              headerType,
              headerText,
            },
          );

          if (created) {
            await auditLog(db, {
              actor: {
                userId: actor.userId,
                role: actor.role,
                ip: actor.ip ?? null,
                userAgent: actor.userAgent ?? null,
              },
              action: 'template.created',
              resource: { type: 'whatsapp_template', id: row.id },
              organizationId: actor.organizationId,
              before: null,
              after: {
                name: metaTmpl.name,
                category,
                language: metaTmpl.language,
                status,
                header_type: headerType,
                metaTemplateId: metaTmpl.id,
                source: 'pull-from-meta',
              },
              correlationId: null,
            });
            imported++;
          } else if (statusChanged) {
            await auditLog(db, {
              actor: {
                userId: actor.userId,
                role: actor.role,
                ip: actor.ip ?? null,
                userAgent: actor.userAgent ?? null,
              },
              action: 'template.synced',
              resource: { type: 'whatsapp_template', id: row.id },
              organizationId: actor.organizationId,
              before: { status: row.status },
              after: { status },
              correlationId: null,
            });
            updated++;
          } else {
            unchanged++;
          }
        } catch (err) {
          logger.error(
            { metaTemplateId: metaTmpl.id, templateName: metaTmpl.name, err },
            'pullFromMeta: falha ao importar template',
          );
          errors++;
        }
      }),
    );
  }

  return { imported, updated, unchanged, errors };
}

// ---------------------------------------------------------------------------
// fetchApprovedTemplatesFromMeta — usado pelo seletor de template do live chat
// ---------------------------------------------------------------------------

export interface ApprovedTemplateItem {
  id: string;
  name: string;
  category: 'utility' | 'marketing' | 'authentication';
  variables: string[];
  body: string;
}

/**
 * Busca templates aprovados diretamente da Meta (WABA) e retorna a lista
 * pronta para o seletor de template do live chat.
 *
 * Como efeito colateral (fire-and-forget), faz upsert no banco local para
 * manter o DB em sincronia sem bloquear a resposta.
 *
 * Usado por GET /api/conversations/:id/templates.
 *
 * @throws ExternalServiceError se o canal não estiver configurado.
 */
export async function fetchApprovedTemplatesFromMeta(
  organizationId: string,
): Promise<ApprovedTemplateItem[]> {
  const metaClient = await buildMetaTemplatesClient(organizationId);
  const metaTemplates = await metaClient.listTemplates();

  const approved = metaTemplates.filter((t) => t.status === 'APPROVED');

  const items: ApprovedTemplateItem[] = approved
    .map((t) => {
      const body = parseBodyFromComponents(t.components ?? []);
      if (body === null) return null;
      return {
        id: t.id,
        name: t.name,
        category: mapMetaCategory(t.category),
        variables: extractVariables(body),
        body,
      };
    })
    .filter((x): x is ApprovedTemplateItem => x !== null)
    .sort((a, b) => a.name.localeCompare(b.name));

  // Upsert no DB em background para manter sincronismo local (fire-and-forget).
  void Promise.all(
    approved.map(async (t) => {
      const body = parseBodyFromComponents(t.components ?? []);
      if (body === null) return;
      const { headerType, headerText } = parseHeaderFromComponents(t.components ?? []);
      try {
        await upsertTemplateFromMeta(db, organizationId, t.id, {
          name: t.name,
          category: mapMetaCategory(t.category),
          language: t.language,
          body,
          variables: extractVariables(body),
          status: 'approved',
          headerType,
          headerText,
        });
      } catch {
        // silent — não pode bloquear a resposta ao atendente
      }
    }),
  );

  return items;
}
