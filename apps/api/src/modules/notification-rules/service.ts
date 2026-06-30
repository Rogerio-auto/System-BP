// =============================================================================
// notification-rules/service.ts — Regras de negócio do módulo (F24-S05).
//
// Responsabilidades:
//   - CRUD com audit na mesma transação.
//   - Derivação de `category` e `trigger_kind` do TRIGGER_CATALOG (nunca do cliente).
//   - B-06: validação de placeholders no update mesmo sem trigger_key no payload.
//   - B-08: mapeamento city_scope (API) ↔ filters jsonb (DB).
//   - Idempotência no POST via Idempotency-Key header (idempotency_keys table).
//   - Endpoint test: resolve destinatários + renderiza preview (sem enviar).
//
// LGPD §8.5:
//   - title_template/body_template: PII indireta após interpolação — não logar.
//   - audit before/after: contém templates — tratados como config (sem PII direta).
//   - Preview de test-fire: placeholders substituídos por valores de exemplo.
// =============================================================================
import crypto from 'node:crypto';

import {
  TRIGGER_CATALOG,
  extractTemplatePlaceholders,
  lookupTrigger,
} from '@elemento/shared-schemas';
import type {
  NotificationRuleCreate,
  NotificationRuleListResponse,
  NotificationRuleResponse,
  NotificationRuleTestResponse,
  NotificationRuleUpdate,
} from '@elemento/shared-schemas';
import { eq } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { idempotencyKeys } from '../../db/schema/idempotencyKeys.js';
import type { NotificationRule } from '../../db/schema/notificationRules.js';
import { auditLog } from '../../lib/audit.js';
import type { AuditActor, AuditTx } from '../../lib/audit.js';
import { AppError, NotFoundError, ValidationError } from '../../shared/errors.js';

import { resolveRuleRecipients } from './recipients.js';
import {
  extractCityScope,
  findNotificationRuleById,
  findNotificationRules,
  insertNotificationRule,
  updateNotificationRule,
  deleteNotificationRule,
} from './repository.js';
import type {
  CreateNotificationRuleInput,
  NotificationRuleListQuery,
  UpdateNotificationRuleInput,
} from './repository.js';

// ---------------------------------------------------------------------------
// ActorContext
// ---------------------------------------------------------------------------

export interface ActorContext {
  userId: string;
  organizationId: string;
  // role é opcional: request.user não expõe o campo (fastify.d.ts).
  // Não hardcodar um role inventado — o actor_user_id é a fonte da verdade de quem agiu.
  role?: string;
  ip?: string | null;
  userAgent?: string | null;
}

function buildAuditActor(actor: ActorContext): AuditActor {
  return {
    userId: actor.userId,
    // AuditActor.role é string (obrigatório no tipo). Quando não disponível no contexto
    // HTTP, usamos 'unknown' — honesto e preferível a um role falso (M1).
    role: actor.role ?? 'unknown',
    ...(actor.ip !== undefined ? { ip: actor.ip } : {}),
    ...(actor.userAgent !== undefined ? { userAgent: actor.userAgent } : {}),
  };
}

// ---------------------------------------------------------------------------
// Erros de domínio
// ---------------------------------------------------------------------------

export class NotificationRuleTriggerNotFoundError extends AppError {
  constructor(triggerKey: string) {
    super(422, 'VALIDATION_ERROR', `trigger_key '${triggerKey}' não existe no TRIGGER_CATALOG`, [
      { code: 'custom', path: ['trigger_key'], message: `Gatilho '${triggerKey}' inválido` },
    ]);
    this.name = 'NotificationRuleTriggerNotFoundError';
  }
}

// ---------------------------------------------------------------------------
// Tipo de transação unificado
// ---------------------------------------------------------------------------

type ServiceTx = AuditTx & Database;

// ---------------------------------------------------------------------------
// Idempotency helpers
// ---------------------------------------------------------------------------

async function checkNotificationRuleIdempotencyKey(
  db: Database,
  key: string,
  organizationId: string,
): Promise<NotificationRuleResponse | null> {
  const rows = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, key)).limit(1);

  if (rows.length === 0) return null;

  // responseBody armazena apenas { rule_id: uuid } — sem PII (LGPD §8.5).
  // `as` justificado: estrutura inserida pelo próprio service com forma conhecida.
  const stored = rows[0]?.responseBody as { rule_id?: string } | null | undefined;
  const ruleId = stored?.rule_id;
  if (!ruleId) return null;

  // B1: buscar dados FRESCOS da regra em vez de retornar o responseBody parcial.
  // O responseBody armazena apenas { rule_id } (sem PII); o response completo
  // é reconstruído via toResponse(rule) para não retornar objeto parcial ao cliente.
  const rule = await findNotificationRuleById(db, organizationId, ruleId);
  if (rule === null) {
    // Regra removida após criação: permite nova criação com a mesma key.
    return null;
  }
  return toResponse(rule);
}

async function persistNotificationRuleIdempotencyKey(
  tx: Database,
  key: string,
  response: NotificationRuleResponse,
): Promise<void> {
  const requestHash = crypto.createHash('sha256').update(key).digest('hex');
  await tx.insert(idempotencyKeys).values({
    key,
    endpoint: 'POST /api/notification-rules',
    requestHash,
    responseStatus: 201,
    // LGPD: armazena apenas { rule_id: uuid } — sem PII bruta.
    responseBody: { rule_id: response.id },
  });
}

// ---------------------------------------------------------------------------
// Mapper: NotificationRule (DB) → NotificationRuleResponse (API)
// ---------------------------------------------------------------------------

function toResponse(rule: NotificationRule): NotificationRuleResponse {
  const trigger = lookupTrigger(rule.triggerKey);

  // Derivar triggerKind e category do catálogo (fonte da verdade).
  // Se o gatilho não for mais encontrado no catálogo (ex: removido em futuras versões),
  // usamos os valores persistidos no DB como fallback defensivo.
  const triggerKind =
    trigger !== undefined
      ? (trigger.kind as 'event' | 'stage_inactivity')
      : (rule.triggerKind as 'event' | 'stage_inactivity');

  const category =
    trigger !== undefined
      ? (trigger.category as
          | 'lifecycle_stalled'
          | 'assignment'
          | 'credit'
          | 'billing'
          | 'handoff'
          | 'system')
      : (rule.category as
          | 'lifecycle_stalled'
          | 'assignment'
          | 'credit'
          | 'billing'
          | 'handoff'
          | 'system');

  const entityType = trigger !== undefined ? trigger.entityType : rule.triggerKey;

  return {
    id: rule.id,
    organization_id: rule.organizationId,
    name: rule.name,
    trigger_key: rule.triggerKey,
    trigger_kind: triggerKind,
    category,
    entity_type: entityType,
    recipient_mode: rule.recipientMode as 'by_role_city' | 'assignee' | 'managers',
    recipient_roles: rule.recipientRoles,
    severity: rule.severity as 'info' | 'warning' | 'critical',
    channels: rule.channels as ('in_app' | 'email')[],
    title_template: rule.titleTemplate,
    body_template: rule.bodyTemplate,
    threshold_hours: rule.thresholdHours ?? null,
    cooldown_hours: rule.cooldownHours,
    enabled: rule.enabled,
    // B-08: extrair city_scope de filters jsonb
    city_scope: extractCityScope(rule.filters),
    created_by: rule.createdBy ?? null,
    created_at: rule.createdAt.toISOString(),
    updated_at: rule.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// B-06: Validação de placeholders (async — usa o DB para buscar trigger_key atual)
// ---------------------------------------------------------------------------

/**
 * Valida placeholders dos templates contra os permitidos pelo gatilho.
 * Usado no update quando trigger_key não está no payload.
 *
 * Lança ValidationError se algum placeholder for inválido.
 */
async function validateUpdatePlaceholders(
  db: Database,
  organizationId: string,
  ruleId: string,
  update: NotificationRuleUpdate,
): Promise<void> {
  // Só validar se templates estão sendo atualizados
  const hasTemplateUpdate =
    update.title_template !== undefined || update.body_template !== undefined;
  if (!hasTemplateUpdate) return;

  // Se trigger_key está no payload, o superRefine do schema já validou
  if (update.trigger_key !== undefined) return;

  // B-06: buscar trigger_key atual do DB
  const currentRule = await findNotificationRuleById(db, organizationId, ruleId);
  if (currentRule === null) return; // será 404 no service — não duplicar erro

  const trigger = lookupTrigger(currentRule.triggerKey);
  if (trigger === undefined) return; // gatilho removido do catálogo — não bloquear

  const allowed = new Set(trigger.placeholders);

  const titleTemplate = update.title_template ?? currentRule.titleTemplate;
  const bodyTemplate = update.body_template ?? currentRule.bodyTemplate;

  const usedPlaceholders = [
    ...extractTemplatePlaceholders(titleTemplate),
    ...extractTemplatePlaceholders(bodyTemplate),
  ];

  const invalid = usedPlaceholders.filter((ph) => !allowed.has(ph));
  if (invalid.length > 0) {
    throw new ValidationError(
      invalid.map((ph) => ({
        code: 'custom' as const,
        path: ['title_template'],
        message: `placeholder '{{${ph}}}' não é permitido para o gatilho '${currentRule.triggerKey}'. Permitidos: ${[...allowed].join(', ')}`,
      })),
      'Placeholder inválido nos templates',
    );
  }
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

/**
 * Lista regras de notificação da organização com paginação.
 */
export async function listRulesService(
  db: Database,
  actor: ActorContext,
  query: NotificationRuleListQuery,
): Promise<NotificationRuleListResponse> {
  const { data, total } = await findNotificationRules(db, actor.organizationId, query);

  return {
    data: data.map(toResponse),
    total,
    page: query.page,
    per_page: query.per_page,
  };
}

/**
 * Retorna detalhe de uma regra de notificação.
 */
export async function getRuleService(
  db: Database,
  actor: ActorContext,
  ruleId: string,
): Promise<NotificationRuleResponse> {
  const rule = await findNotificationRuleById(db, actor.organizationId, ruleId);
  if (rule === null) throw new NotFoundError('Regra de notificação não encontrada');
  return toResponse(rule);
}

/**
 * Cria uma regra de notificação.
 *
 * Fluxo:
 *   1. Verifica idempotency key (fora da tx).
 *   2. Deriva category + triggerKind do TRIGGER_CATALOG.
 *   3. Em transação: insert + auditLog + persistIdempotencyKey.
 *
 * LGPD: audit before=null, after=response (sem PII bruta — templates são config).
 */
export async function createRuleService(
  db: Database,
  actor: ActorContext,
  body: NotificationRuleCreate,
  idempotencyKey: string | undefined,
): Promise<NotificationRuleResponse> {
  // 1. Idempotência — B1: passa organizationId para buscar dados frescos no replay
  if (idempotencyKey !== undefined) {
    const cached = await checkNotificationRuleIdempotencyKey(
      db,
      idempotencyKey,
      actor.organizationId,
    );
    if (cached !== null) return cached;
  }

  // 2. Derivar category + triggerKind do catálogo
  const trigger = lookupTrigger(body.trigger_key);
  if (trigger === undefined) {
    throw new NotificationRuleTriggerNotFoundError(body.trigger_key);
  }

  const rule = await db.transaction(async (tx) => {
    const txDb = tx as unknown as ServiceTx;

    const input: CreateNotificationRuleInput = {
      organizationId: actor.organizationId,
      name: body.name,
      triggerKind: trigger.kind,
      triggerKey: body.trigger_key,
      // category derivada do catálogo (nunca do cliente)
      category: trigger.category,
      recipientMode: body.recipient_mode,
      recipientRoles: body.recipient_roles ?? [],
      severity: body.severity,
      channels: body.channels,
      titleTemplate: body.title_template,
      bodyTemplate: body.body_template,
      cooldownHours: body.cooldown_hours,
      enabled: body.enabled,
      cityScope: body.city_scope ?? null,
      createdBy: actor.userId,
      ...(body.threshold_hours !== undefined ? { thresholdHours: body.threshold_hours } : {}),
    };

    const created = await insertNotificationRule(txDb as unknown as Database, input);

    const response = toResponse(created);

    // Audit log (sem PII — templates são config operacional)
    await auditLog(txDb, {
      organizationId: actor.organizationId,
      actor: buildAuditActor(actor),
      action: 'notification_rule.created',
      resource: { type: 'notification_rule', id: created.id },
      before: null,
      after: { id: created.id, name: created.name, trigger_key: created.triggerKey },
    });

    // Persistir idempotency key na mesma transação
    if (idempotencyKey !== undefined) {
      await persistNotificationRuleIdempotencyKey(
        txDb as unknown as Database,
        idempotencyKey,
        response,
      );
    }

    return created;
  });

  return toResponse(rule);
}

/**
 * Atualiza uma regra de notificação.
 *
 * B-06: quando templates são atualizados sem trigger_key no payload,
 * busca trigger_key atual e valida placeholders.
 */
export async function updateRuleService(
  db: Database,
  actor: ActorContext,
  ruleId: string,
  body: NotificationRuleUpdate,
): Promise<NotificationRuleResponse> {
  // B-06: validar placeholders async antes da transação
  await validateUpdatePlaceholders(db, actor.organizationId, ruleId, body);

  const before = await findNotificationRuleById(db, actor.organizationId, ruleId);
  if (before === null) throw new NotFoundError('Regra de notificação não encontrada');

  // Derivar category + triggerKind se trigger_key está sendo alterado
  let newCategory: string | undefined;
  let newTriggerKind: 'event' | 'stage_inactivity' | undefined;

  if (body.trigger_key !== undefined) {
    const trigger = lookupTrigger(body.trigger_key);
    if (trigger === undefined) {
      throw new NotificationRuleTriggerNotFoundError(body.trigger_key);
    }
    newCategory = trigger.category;
    newTriggerKind = trigger.kind;
  }

  const after = await db.transaction(async (tx) => {
    const txDb = tx as unknown as ServiceTx;

    const input: UpdateNotificationRuleInput = {};

    if (body.name !== undefined) input.name = body.name;
    if (body.trigger_key !== undefined) input.triggerKey = body.trigger_key;
    if (newTriggerKind !== undefined) input.triggerKind = newTriggerKind;
    if (newCategory !== undefined) input.category = newCategory;
    if (body.recipient_mode !== undefined) input.recipientMode = body.recipient_mode;
    if (body.recipient_roles !== undefined) input.recipientRoles = body.recipient_roles;
    if (body.severity !== undefined) input.severity = body.severity;
    if (body.channels !== undefined) input.channels = body.channels;
    if (body.title_template !== undefined) input.titleTemplate = body.title_template;
    if (body.body_template !== undefined) input.bodyTemplate = body.body_template;
    if (body.threshold_hours !== undefined) input.thresholdHours = body.threshold_hours;
    if (body.cooldown_hours !== undefined) input.cooldownHours = body.cooldown_hours;
    if (body.enabled !== undefined) input.enabled = body.enabled;
    // B-08: city_scope → filters
    if (body.city_scope !== undefined) input.cityScope = body.city_scope;

    const updated = await updateNotificationRule(
      txDb as unknown as Database,
      actor.organizationId,
      ruleId,
      input,
    );
    if (updated === null) throw new NotFoundError('Regra de notificação não encontrada');

    // Audit log (sem PII bruta)
    await auditLog(txDb, {
      organizationId: actor.organizationId,
      actor: buildAuditActor(actor),
      action: 'notification_rule.updated',
      resource: { type: 'notification_rule', id: ruleId },
      before: {
        id: before.id,
        name: before.name,
        trigger_key: before.triggerKey,
        enabled: before.enabled,
      },
      after: {
        id: updated.id,
        name: updated.name,
        trigger_key: updated.triggerKey,
        enabled: updated.enabled,
      },
    });

    return updated;
  });

  return toResponse(after);
}

/**
 * Remove uma regra de notificação (hard delete).
 */
export async function deleteRuleService(
  db: Database,
  actor: ActorContext,
  ruleId: string,
): Promise<void> {
  const before = await findNotificationRuleById(db, actor.organizationId, ruleId);
  if (before === null) throw new NotFoundError('Regra de notificação não encontrada');

  await db.transaction(async (tx) => {
    const txDb = tx as unknown as ServiceTx;

    const deleted = await deleteNotificationRule(
      txDb as unknown as Database,
      actor.organizationId,
      ruleId,
    );
    if (deleted === null) throw new NotFoundError('Regra de notificação não encontrada');

    // Audit log
    await auditLog(txDb, {
      organizationId: actor.organizationId,
      actor: buildAuditActor(actor),
      action: 'notification_rule.deleted',
      resource: { type: 'notification_rule', id: ruleId },
      before: { id: before.id, name: before.name, trigger_key: before.triggerKey },
      after: null,
    });
  });
}

// ---------------------------------------------------------------------------
// Test-fire / Preview
// ---------------------------------------------------------------------------

/**
 * Renderiza um template substituindo placeholders por valores de exemplo.
 * Valores de exemplo são descritivos e sem PII.
 */
function renderTemplateWithExamples(template: string, placeholders: readonly string[]): string {
  let rendered = template;
  for (const ph of placeholders) {
    // Usar valor de exemplo genérico para cada placeholder:
    // IDs recebem um UUID fake; outros recebem o nome do placeholder em colchetes.
    const exampleValue = ph.endsWith('_id') ? '00000000-0000-0000-0000-000000000001' : `[${ph}]`;
    rendered = rendered.replaceAll(`{{${ph}}}`, exampleValue);
  }
  return rendered;
}

/**
 * Endpoint test-fire / preview da regra.
 *
 * Resolve destinatários reais da regra e renderiza os templates com dados
 * de exemplo (sem PII de cidadão). Não dispara notificações.
 *
 * Para resolução de destinatários, usa cityId=null (contexto global de preview).
 * Em produção, o cityId viria do contexto do evento.
 */
export async function testRuleService(
  db: Database,
  actor: ActorContext,
  ruleId: string,
): Promise<NotificationRuleTestResponse> {
  const rule = await findNotificationRuleById(db, actor.organizationId, ruleId);
  if (rule === null) throw new NotFoundError('Regra de notificação não encontrada');

  const trigger = lookupTrigger(rule.triggerKey);

  // Resolver destinatários (contexto global — preview sem evento real)
  const recipients = await resolveRuleRecipients(db, {
    organizationId: rule.organizationId,
    recipientMode: rule.recipientMode as 'by_role_city' | 'assignee' | 'managers',
    recipientRoles: rule.recipientRoles,
    channels: rule.channels as ('in_app' | 'email')[],
    cityId: null, // preview: sem cidade específica
    leadId: null, // preview: sem lead específico
  });

  // Amostra de até 5 destinatários para exibição
  const recipientsPreview = recipients.slice(0, 5).map((r) => ({
    user_id: r.userId,
    display_name: r.displayName,
    channels: r.channels,
  }));

  // Renderizar templates com exemplos
  const placeholders = trigger !== undefined ? trigger.placeholders : [];
  const renderedTitle = renderTemplateWithExamples(rule.titleTemplate, placeholders);
  const renderedBody = renderTemplateWithExamples(rule.bodyTemplate, placeholders);

  return {
    rule_id: rule.id,
    recipient_count: recipients.length,
    recipients_preview: recipientsPreview,
    rendered_title: renderedTitle,
    rendered_body: renderedBody,
    tested_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

/**
 * Retorna o catálogo completo de gatilhos.
 * Usado pelo frontend para popular dropdowns de criação/edição de regras.
 */
export function getCatalogService(): typeof TRIGGER_CATALOG {
  return TRIGGER_CATALOG;
}
