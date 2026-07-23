// =============================================================================
// quick-replies/service.ts — Regras de negócio de respostas rápidas (F28-S03).
//
// Autorização (doc 25 §5) — decidida AQUI, não só na rota:
//   1. Toda query filtra por organization_id do ator — sem exceção.
//   2. Leitura retorna: visibility='organization' ∪ owner_user_id=actor.userId.
//      Um operador nunca vê a resposta pessoal de outro (repository.ts).
//   3. Escrita em registro com owner_user_id=actor.userId exige `write`.
//   4. Escrita em registro com visibility='organization' (ou transição para/
//      de 'organization') exige `manage`.
//   5. Criar com visibility='organization' exige `manage`. Criar 'personal'
//      exige `write` e FORÇA owner_user_id=actor.userId — o contrato de
//      F28-S02 (quickReplyCreateSchema) deliberadamente não expõe ownerUserId
//      como campo de entrada, então não há nada vindo do body a "ignorar";
//      o valor é sempre derivado do ator.
//   6. Enviar (fora deste slot) exige livechat:message:send.
//
// Notas do security review de F28-S01/S02 endereçadas aqui:
//   1. Guarda pós-interpolação contra token cru — assertBodyInterpolatesSafely.
//   2. mediaUrl restrito ao prefixo de storage da própria organização —
//      assertMediaUrlBelongsToOrg.
//   3. Allowlist de MIME é débito herdado do live chat (fora de escopo) —
//      registrado em comentário, não ampliado aqui.
//
// LGPD (doc 25 §12): audit log nunca carrega `body`; corpo cadastrado é
// validado contra os padrões canônicos de CPF/CNPJ/e-mail/telefone (doc 17
// §8.4) via lib/dlp.ts — RG deliberadamente excluído (doc 25 §12 não o lista;
// alta taxa de falso positivo, doc no próprio lib/dlp.ts).
// =============================================================================
import {
  extractQuickReplyErrorCode,
  interpolateQuickReply,
  parseQuickReplyVariables,
  quickReplyCreateSchema,
  quickReplyUpdateSchema,
} from '@elemento/shared-schemas';
import type {
  QuickReplyCreate,
  QuickReplyListResponse,
  QuickReplyResponse,
  QuickReplyUpdate,
} from '@elemento/shared-schemas';
import type { z } from 'zod';

import type { Database } from '../../db/client.js';
import type { QuickReply } from '../../db/schema/quickReplies.js';
import { auditLog } from '../../lib/audit.js';
import type { AuditActor, AuditTx } from '../../lib/audit.js';
import { redactPii } from '../../lib/dlp.js';
import { makeEnvelope, publish } from '../../lib/queue/index.js';
import { QUEUES } from '../../lib/queue/topology.js';
import { getPublicUrl } from '../../lib/storage/index.js';
import { AppError, ForbiddenError, NotFoundError } from '../../shared/errors.js';

import {
  findActorDisplayNames,
  findQuickReplies,
  findShortcutConflict,
  findVisibleQuickReplyById,
  insertQuickReply,
  reorderQuickReplies,
  softDeleteQuickReplyById,
  updateQuickReplyById,
} from './repository.js';
import type { QuickReplyListQuery, UpdateQuickReplyInput } from './repository.js';

/**
 * Verifica se um erro Postgres é violação de unique constraint (code 23505).
 * Mesmo padrão de credit-products/service.ts.
 */
function isPgUniqueViolation(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;
  const code = 'code' in err ? (err as { code: unknown }).code : undefined;
  return code === '23505';
}

// ---------------------------------------------------------------------------
// Contexto do ator
// ---------------------------------------------------------------------------

export interface ActorContext {
  userId: string;
  organizationId: string;
  permissions: string[];
  /** null = acesso global (admin/gestor_geral); string[] = escopo de cidade. */
  cityScopeIds: string[] | null;
  ip?: string | null;
  userAgent?: string | null;
}

export const READ_PERMISSION = 'livechat:quick_reply:read';
export const WRITE_PERMISSION = 'livechat:quick_reply:write';
export const MANAGE_PERMISSION = 'livechat:quick_reply:manage';

function hasPermission(actor: ActorContext, permission: string): boolean {
  return actor.permissions.includes('*') || actor.permissions.includes(permission);
}

function requirePermission(actor: ActorContext, permission: string): void {
  if (!hasPermission(actor, permission)) {
    throw new ForbiddenError('Acesso negado: permissões insuficientes');
  }
}

// ---------------------------------------------------------------------------
// Códigos de erro estáveis locais (doc 25 — "Contratos de saída" do slot).
// QUICK_REPLY_SHORTCUT_CONFLICT/PII_IN_BODY não fazem parte do superRefine
// do pacote compartilhado (não são erros de forma do Zod) — são regras de
// negócio decididas aqui, com acesso ao banco/ator.
// ---------------------------------------------------------------------------

export const QUICK_REPLY_SHORTCUT_CONFLICT = 'QUICK_REPLY_SHORTCUT_CONFLICT';
export const QUICK_REPLY_PII_IN_BODY = 'QUICK_REPLY_PII_IN_BODY';
export const QUICK_REPLY_BODY_OR_MEDIA_REQUIRED = 'QUICK_REPLY_BODY_OR_MEDIA_REQUIRED';
/** Guarda defensiva pós-interpolação (security review F28-S01/S02, nota 1). */
export const QUICK_REPLY_UNRESOLVED_VARIABLE = 'QUICK_REPLY_UNRESOLVED_VARIABLE';
/** mediaUrl fora do prefixo de storage da organização (security review, nota 2). */
export const QUICK_REPLY_MEDIA_URL_UNTRUSTED = 'QUICK_REPLY_MEDIA_URL_UNTRUSTED';

export class QuickReplyShortcutConflictError extends AppError {
  constructor(shortcut: string) {
    super(409, 'CONFLICT', `O atalho "${shortcut}" já está em uso neste escopo`, {
      code: QUICK_REPLY_SHORTCUT_CONFLICT,
      field: 'shortcut',
    });
    this.name = 'QuickReplyShortcutConflictError';
  }
}

// ---------------------------------------------------------------------------
// Validação manual do body (doc: "use extractQuickReplyErrorCode para mapear
// erros Zod aos códigos estáveis"). O body NÃO é validado automaticamente
// pelo schema Fastify (routes.ts usa attachValidation — ver comentário lá) —
// aqui temos controle total do status HTTP (422 quando há código estável de
// superRefine) e do payload de erro consumido pelo frontend.
// ---------------------------------------------------------------------------

function handleQuickReplyParseFailure(error: z.ZodError): never {
  const stableCode = extractQuickReplyErrorCode(error);
  const firstIssue = error.issues[0];
  const message = firstIssue?.message ?? 'Corpo inválido para resposta rápida';

  // 422 quando é uma regra de negócio do catálogo de variáveis (superRefine);
  // 400 para erro de forma comum (campo ausente, tipo errado, etc.).
  const statusCode = stableCode !== null ? 422 : 400;

  throw new AppError(statusCode, 'VALIDATION_ERROR', message, {
    code: stableCode,
    issues: error.issues,
  });
}

// Duas funções concretas (em vez de uma genérica `z.ZodType<T>`) — evita
// perder o Output com defaults aplicados do ZodEffects retornado por
// .superRefine() e evita overloads (sem precedente no codebase, colide com
// no-redeclare do eslint base).
function parseQuickReplyCreateBody(raw: unknown): QuickReplyCreate {
  const result = quickReplyCreateSchema.safeParse(raw);
  if (!result.success) handleQuickReplyParseFailure(result.error);
  return result.data;
}

function parseQuickReplyUpdateBody(raw: unknown): QuickReplyUpdate {
  const result = quickReplyUpdateSchema.safeParse(raw);
  if (!result.success) handleQuickReplyParseFailure(result.error);
  return result.data;
}

// ---------------------------------------------------------------------------
// LGPD §12 — rejeição de PII bruta no corpo (doc 17 §8.4 — CPF/CNPJ/e-mail/
// telefone; RG excluído deliberadamente, ver cabeçalho do arquivo).
// ---------------------------------------------------------------------------

function assertNoPiiInBody(body: string | null | undefined): void {
  if (body === null || body === undefined || body.length === 0) return;

  const { counts } = redactPii(body);
  const relevantTypes = ['CPF', 'CNPJ', 'EMAIL', 'PHONE'] as const;
  const detected = relevantTypes.filter((type) => (counts[type] ?? 0) > 0);

  if (detected.length > 0) {
    throw new AppError(
      422,
      'VALIDATION_ERROR',
      'O corpo da resposta rápida não pode conter dado pessoal do cidadão (CPF, CNPJ, e-mail ou telefone)',
      { code: QUICK_REPLY_PII_IN_BODY, detected },
    );
  }
}

// ---------------------------------------------------------------------------
// Security review (F28-S01/S02, nota 2) — mediaUrl restrito ao prefixo de
// storage da própria organização (quick-replies/{organizationId}/). Sem
// isso, um cliente poderia apontar a mídia para um host externo qualquer —
// a Meta busca essa URL diretamente no envio (doc 25 §7.4).
// ---------------------------------------------------------------------------

function rejectUntrustedMediaUrl(): never {
  throw new AppError(
    400,
    'VALIDATION_ERROR',
    'mediaUrl deve apontar para o storage de mídia desta organização',
    { code: QUICK_REPLY_MEDIA_URL_UNTRUSTED, field: 'mediaUrl' },
  );
}

function assertMediaUrlBelongsToOrg(organizationId: string, mediaUrl: string): void {
  // Comparação ESTRUTURADA, não `startsWith` sobre string crua: um path como
  // `.../quick-replies/{orgA}/../{orgB}/x.jpg` começa com o prefixo de orgA mas
  // resolve para orgB se qualquer camada a jusante (CDN/proxy/undici) normalizar
  // dot-segments (RFC 3986 §5.2.4). O guard precisa parsear e comparar por segmento.
  const expected = getPublicUrl(`quick-replies/${organizationId}/`);

  let expectedUrl: URL;
  let actualUrl: URL;
  try {
    expectedUrl = new URL(expected);
    actualUrl = new URL(mediaUrl);
  } catch {
    rejectUntrustedMediaUrl();
  }

  // Origin exato (protocolo + host + porta) — bloqueia host externo e userinfo (`@`).
  if (actualUrl.origin !== expectedUrl.origin) rejectUntrustedMediaUrl();

  // Path por segmentos: rejeita `.`/`..`/segmento vazio e exige que os segmentos
  // do prefixo esperado sejam prefixo EXATO dos segmentos do path recebido.
  const actualSegments = actualUrl.pathname.split('/').filter((s) => s.length > 0);
  if (actualSegments.some((s) => s === '.' || s === '..')) rejectUntrustedMediaUrl();

  const expectedSegments = expectedUrl.pathname.split('/').filter((s) => s.length > 0);
  // Precisa haver ao menos um segmento (nome do arquivo) além do prefixo.
  if (actualSegments.length <= expectedSegments.length) rejectUntrustedMediaUrl();
  for (let i = 0; i < expectedSegments.length; i += 1) {
    if (actualSegments[i] !== expectedSegments[i]) rejectUntrustedMediaUrl();
  }
}

// ---------------------------------------------------------------------------
// Security review (F28-S01/S02, nota 1) — guarda defensiva pós-interpolação.
//
// O catálogo (doc 25 §6.1) só exige fallback para {{contato.*}}; variáveis
// {{atendente.*}}/{{organizacao.*}} não exigem porque, em tese, sempre
// resolvem (users.full_name/organizations.name são NOT NULL). Essa garantia
// não pode depender só da constraint do banco — se a interpolação com os
// dados REAIS do próprio ator (o criador/editor) ainda deixar um `{{...}}`
// cru, a operação é bloqueada aqui, na criação/edição, em vez de deixar o
// risco vazar para o momento do envio (fora do escopo deste slot).
// ---------------------------------------------------------------------------

async function assertBodyInterpolatesSafely(
  db: Database,
  actor: ActorContext,
  body: string | null | undefined,
): Promise<void> {
  if (body === null || body === undefined || body.length === 0) return;

  const { agentName, organizationName } = await findActorDisplayNames(
    db,
    actor.organizationId,
    actor.userId,
  );

  const interpolated = interpolateQuickReply(body, {
    now: new Date(),
    // contato.* sempre tem fallback obrigatório (superRefine do schema) —
    // valor de exemplo aqui só evita path de contactName ausente.
    contactName: 'Cidadão',
    agentName: agentName ?? '',
    organizationName: organizationName ?? '',
  });

  // Usa o MESMO parser do contrato compartilhado (casa tokens com espaço/quebra
  // de linha dentro das chaves) — evita um regex ad-hoc paralelo que divergiria
  // da sintaxe canônica e deixaria passar `{{ ... \n ... }}`.
  if (parseQuickReplyVariables(interpolated).length > 0) {
    throw new AppError(
      422,
      'VALIDATION_ERROR',
      'A resposta rápida contém uma variável que não pôde ser resolvida — adicione um fallback (ex: {{atendente.nome|equipe}})',
      { code: QUICK_REPLY_UNRESOLVED_VARIABLE },
    );
  }
}

// ---------------------------------------------------------------------------
// Mapper: QuickReply (DB) → QuickReplyResponse (API)
// ---------------------------------------------------------------------------

function toResponse(row: QuickReply): QuickReplyResponse {
  return {
    id: row.id,
    organizationId: row.organizationId,
    ownerUserId: row.ownerUserId,
    // `as` justificado: CHECK do banco garante domínio fechado ('organization'|'personal').
    visibility: row.visibility as QuickReplyResponse['visibility'],
    shortcut: row.shortcut,
    title: row.title,
    body: row.body,
    category: row.category,
    mediaUrl: row.mediaUrl,
    mediaMime: row.mediaMime,
    // `as` justificado: CHECK do banco garante domínio fechado de media_kind.
    mediaKind: row.mediaKind as QuickReplyResponse['mediaKind'],
    mediaSizeBytes: row.mediaSizeBytes,
    mediaFileName: row.mediaFileName,
    cityIds: row.cityIds,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    usageCount: row.usageCount,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export async function listQuickRepliesService(
  db: Database,
  actor: ActorContext,
  query: QuickReplyListQuery,
): Promise<QuickReplyListResponse> {
  const { data, nextCursor } = await findQuickReplies(
    db,
    actor.organizationId,
    actor.userId,
    actor.cityScopeIds,
    query,
  );

  return {
    data: data.map(toResponse),
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// Get by id
// ---------------------------------------------------------------------------

export async function getQuickReplyService(
  db: Database,
  actor: ActorContext,
  id: string,
): Promise<QuickReplyResponse> {
  const row = await findVisibleQuickReplyById(db, actor.organizationId, actor.userId, id);
  if (row === null) throw new NotFoundError('Resposta rápida não encontrada');
  return toResponse(row);
}

// ---------------------------------------------------------------------------
// Helper: audit actor (role indisponível em request.user — mesma decisão
// documentada em notification-rules/service.ts, M1).
// ---------------------------------------------------------------------------

function buildAuditActor(actor: ActorContext): AuditActor {
  return {
    userId: actor.userId,
    role: 'unknown',
    ip: actor.ip ?? null,
    userAgent: actor.userAgent ?? null,
  };
}

/** Resumo auditável — nunca inclui `body` (doc 25 §12). */
function auditSummary(
  row: Pick<QuickReply, 'id' | 'shortcut' | 'visibility'>,
): Record<string, unknown> {
  return { quickReplyId: row.id, shortcut: row.shortcut, visibility: row.visibility };
}

// ---------------------------------------------------------------------------
// Realtime (doc 25 §9) — publicado APÓS o commit da transação. Payload sem
// body/title/mídia — o cliente só recebe o sinal e invalida a query.
// ---------------------------------------------------------------------------

async function publishQuickReplyChanged(
  actor: ActorContext,
  row: Pick<QuickReply, 'id' | 'visibility' | 'ownerUserId'>,
  action: 'created' | 'updated' | 'deleted' | 'reordered',
): Promise<void> {
  // `as` justificado: CHECK do banco (chk_quick_replies_visibility_domain)
  // garante domínio fechado 'organization'|'personal'.
  const visibility = row.visibility as 'organization' | 'personal';
  const room =
    visibility === 'organization'
      ? `workspace:${actor.organizationId}`
      : `user:${row.ownerUserId ?? actor.userId}`;

  await publish(
    QUEUES.socketRelay,
    makeEnvelope(QUEUES.socketRelay, actor.organizationId, {
      room,
      event: 'quick_reply:changed',
      data: {
        quickReplyId: row.id,
        action,
        visibility,
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createQuickReplyService(
  db: Database,
  actor: ActorContext,
  rawBody: unknown,
): Promise<QuickReplyResponse> {
  const body = parseQuickReplyCreateBody(rawBody);

  // Regra 5 (doc 25 §5): visibility='organization' exige manage; 'personal'
  // exige write e força owner_user_id=actor.userId — o contrato de F28-S02
  // não expõe ownerUserId como campo de entrada, então não há nada a ignorar.
  if (body.visibility === 'organization') {
    requirePermission(actor, MANAGE_PERMISSION);
  } else {
    requirePermission(actor, WRITE_PERMISSION);
  }
  const ownerUserId = body.visibility === 'personal' ? actor.userId : null;

  assertNoPiiInBody(body.body);
  if (body.mediaUrl !== undefined && body.mediaUrl !== null) {
    assertMediaUrlBelongsToOrg(actor.organizationId, body.mediaUrl);
  }
  await assertBodyInterpolatesSafely(db, actor, body.body);

  const conflict = await findShortcutConflict(db, actor.organizationId, ownerUserId, body.shortcut);
  if (conflict) throw new QuickReplyShortcutConflictError(body.shortcut);

  const created = await db.transaction(async (tx) => {
    const txDb = tx as unknown as Database;

    let insertedRow: QuickReply;
    try {
      insertedRow = await insertQuickReply(txDb, {
        organizationId: actor.organizationId,
        ownerUserId,
        visibility: body.visibility,
        shortcut: body.shortcut,
        title: body.title,
        body: body.body ?? null,
        category: body.category ?? null,
        mediaUrl: body.mediaUrl ?? null,
        mediaMime: body.mediaMime ?? null,
        mediaKind: body.mediaKind ?? null,
        mediaSizeBytes: body.mediaSizeBytes ?? null,
        mediaFileName: body.mediaFileName ?? null,
        cityIds: body.cityIds,
        isActive: body.isActive,
        sortOrder: body.sortOrder,
        createdBy: actor.userId,
      });
    } catch (err: unknown) {
      // Race condition: dois POSTs concorrentes com o mesmo atalho no mesmo escopo.
      if (isPgUniqueViolation(err)) throw new QuickReplyShortcutConflictError(body.shortcut);
      throw err;
    }

    await auditLog(tx as unknown as AuditTx, {
      organizationId: actor.organizationId,
      actor: buildAuditActor(actor),
      action: 'quick_reply.created',
      resource: { type: 'quick_reply', id: insertedRow.id },
      before: null,
      after: auditSummary(insertedRow),
    });

    return insertedRow;
  });

  await publishQuickReplyChanged(actor, created, 'created');

  return toResponse(created);
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export async function updateQuickReplyService(
  db: Database,
  actor: ActorContext,
  id: string,
  rawBody: unknown,
): Promise<QuickReplyResponse> {
  const current = await findVisibleQuickReplyById(db, actor.organizationId, actor.userId, id);
  if (current === null) throw new NotFoundError('Resposta rápida não encontrada');

  const body = parseQuickReplyUpdateBody(rawBody);

  const currentVisibility = current.visibility as 'organization' | 'personal';
  const nextVisibility = body.visibility ?? currentVisibility;

  // Regra 3/4 (doc 25 §5): tocar visibility='organization' (atual OU
  // resultante) exige manage; permanecer 'personal' (sempre owner=actor,
  // garantido pelo filtro de visibilidade do repository) exige write.
  const touchesOrgWide = currentVisibility === 'organization' || nextVisibility === 'organization';
  requirePermission(actor, touchesOrgWide ? MANAGE_PERMISSION : WRITE_PERMISSION);

  // owner_user_id só é recalculado quando a visibilidade efetivamente muda de
  // estado — nunca vindo do body (não é campo de entrada do contrato F28-S02).
  const ownerUserId =
    body.visibility !== undefined && body.visibility !== currentVisibility
      ? nextVisibility === 'personal'
        ? actor.userId
        : null
      : undefined;

  // Cross-field "body ou mídia" (doc 25 §4.1) — o schema de update só valida
  // os campos PRESENTES no PATCH; aqui mesclamos com o estado atual do banco
  // (mesma decisão de F24-S05/B-06 para validações que dependem de estado
  // fora do payload).
  const effectiveBody = body.body !== undefined ? body.body : current.body;
  const effectiveMediaUrl = body.mediaUrl !== undefined ? body.mediaUrl : current.mediaUrl;
  if ((effectiveBody === null || effectiveBody.length === 0) && effectiveMediaUrl === null) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Informe um corpo de texto ou anexe uma mídia.', {
      code: QUICK_REPLY_BODY_OR_MEDIA_REQUIRED,
      field: 'body',
    });
  }

  if (body.body !== undefined) {
    assertNoPiiInBody(body.body);
    await assertBodyInterpolatesSafely(db, actor, body.body);
  }
  if (body.mediaUrl !== undefined && body.mediaUrl !== null) {
    assertMediaUrlBelongsToOrg(actor.organizationId, body.mediaUrl);
  }

  const effectiveShortcut = body.shortcut ?? current.shortcut;
  if (body.shortcut !== undefined || ownerUserId !== undefined) {
    const effectiveOwnerUserId = ownerUserId !== undefined ? ownerUserId : current.ownerUserId;
    const conflict = await findShortcutConflict(
      db,
      actor.organizationId,
      effectiveOwnerUserId,
      effectiveShortcut,
      id,
    );
    if (conflict) throw new QuickReplyShortcutConflictError(effectiveShortcut);
  }

  const input: UpdateQuickReplyInput = {
    ...(ownerUserId !== undefined ? { ownerUserId } : {}),
    ...(body.visibility !== undefined ? { visibility: body.visibility } : {}),
    ...(body.shortcut !== undefined ? { shortcut: body.shortcut } : {}),
    ...(body.title !== undefined ? { title: body.title } : {}),
    ...(body.body !== undefined ? { body: body.body } : {}),
    ...(body.category !== undefined ? { category: body.category } : {}),
    ...(body.mediaUrl !== undefined ? { mediaUrl: body.mediaUrl } : {}),
    ...(body.mediaMime !== undefined ? { mediaMime: body.mediaMime } : {}),
    ...(body.mediaKind !== undefined ? { mediaKind: body.mediaKind } : {}),
    ...(body.mediaSizeBytes !== undefined ? { mediaSizeBytes: body.mediaSizeBytes } : {}),
    ...(body.mediaFileName !== undefined ? { mediaFileName: body.mediaFileName } : {}),
    ...(body.cityIds !== undefined ? { cityIds: body.cityIds } : {}),
    ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
    ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
  };

  const updated = await db.transaction(async (tx) => {
    const txDb = tx as unknown as Database;

    let updatedRow: QuickReply | null;
    try {
      updatedRow = await updateQuickReplyById(txDb, actor.organizationId, id, input);
    } catch (err: unknown) {
      if (isPgUniqueViolation(err)) throw new QuickReplyShortcutConflictError(effectiveShortcut);
      throw err;
    }
    if (updatedRow === null) throw new NotFoundError('Resposta rápida não encontrada');

    await auditLog(tx as unknown as AuditTx, {
      organizationId: actor.organizationId,
      actor: buildAuditActor(actor),
      action: 'quick_reply.updated',
      resource: { type: 'quick_reply', id },
      before: auditSummary(current),
      after: auditSummary(updatedRow),
    });

    return updatedRow;
  });

  await publishQuickReplyChanged(actor, updated, 'updated');

  return toResponse(updated);
}

// ---------------------------------------------------------------------------
// Delete (soft)
// ---------------------------------------------------------------------------

export async function deleteQuickReplyService(
  db: Database,
  actor: ActorContext,
  id: string,
): Promise<void> {
  const current = await findVisibleQuickReplyById(db, actor.organizationId, actor.userId, id);
  if (current === null) throw new NotFoundError('Resposta rápida não encontrada');

  const currentVisibility = current.visibility as 'organization' | 'personal';
  requirePermission(
    actor,
    currentVisibility === 'organization' ? MANAGE_PERMISSION : WRITE_PERMISSION,
  );

  await db.transaction(async (tx) => {
    const txDb = tx as unknown as Database;
    const deleted = await softDeleteQuickReplyById(txDb, actor.organizationId, id);
    if (deleted === null) throw new NotFoundError('Resposta rápida não encontrada');

    await auditLog(tx as unknown as AuditTx, {
      organizationId: actor.organizationId,
      actor: buildAuditActor(actor),
      action: 'quick_reply.deleted',
      resource: { type: 'quick_reply', id },
      before: auditSummary(current),
      after: null,
    });
  });

  await publishQuickReplyChanged(actor, current, 'deleted');
}

// ---------------------------------------------------------------------------
// Reorder (doc 25 §5 — exige manage; escopo: org-wide, ver repository.ts)
// ---------------------------------------------------------------------------

export async function reorderQuickRepliesService(
  db: Database,
  actor: ActorContext,
  items: readonly { id: string; sortOrder: number }[],
): Promise<{ updated: number }> {
  requirePermission(actor, MANAGE_PERMISSION);

  const updatedIds = await db.transaction(async (tx) => {
    const txDb = tx as unknown as Database;
    const ids = await reorderQuickReplies(txDb, actor.organizationId, items);

    const requestedIds = new Set(items.map((item) => item.id));
    const missing = [...requestedIds].filter((requestedId) => !ids.includes(requestedId));
    if (missing.length > 0) {
      throw new AppError(
        404,
        'NOT_FOUND',
        'Um ou mais ids não pertencem à biblioteca da organização (ou não existem)',
        { missingIds: missing },
      );
    }

    await auditLog(tx as unknown as AuditTx, {
      organizationId: actor.organizationId,
      actor: buildAuditActor(actor),
      action: 'quick_reply.reordered',
      // Ação em lote — não há um único quick_reply.id central; o recurso
      // auditado é o próprio "batch" de reordenação da organização.
      resource: { type: 'quick_reply_reorder', id: actor.organizationId },
      before: null,
      after: { count: ids.length, quickReplyIds: ids },
    });

    return ids;
  });

  for (const quickReplyId of updatedIds) {
    await publishQuickReplyChanged(
      actor,
      { id: quickReplyId, visibility: 'organization', ownerUserId: null },
      'reordered',
    );
  }

  return { updated: updatedIds.length };
}
