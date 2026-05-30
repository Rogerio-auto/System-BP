// =============================================================================
// followup/repository.ts — Queries Drizzle para follow-up (F5-S05).
//
// Cobre:
//   - CRUD de followup_rules (com city-scope via organization_id)
//   - Listagem paginada de followup_jobs com filtros + JOINs (sem PII)
//   - Cancel de followup_job
//
// LGPD (doc 17):
//   - Jobs listados: apenas lead_id, rule_key, template_key, status.
//   - Sem phone, cpf, email em qualquer query deste repositório.
//   - lead_name: primeiro nome apenas (split em ' ')[0]) — redução de PII.
// =============================================================================
import { and, count, desc, eq, gte, lte, sql } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { followupJobs } from '../../db/schema/followupJobs.js';
import { followupRules } from '../../db/schema/followupRules.js';
import { leads } from '../../db/schema/leads.js';
import { whatsappTemplates } from '../../db/schema/whatsappTemplates.js';
import { NotFoundError } from '../../shared/errors.js';

import type {
  FollowupJobsListQuery,
  FollowupJobsListResponse,
  FollowupJobResponse,
  FollowupRuleCreate,
  FollowupRuleUpdate,
  FollowupRuleResponse,
  FollowupRulesListResponse,
} from './schemas.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToRuleResponse(row: typeof followupRules.$inferSelect): FollowupRuleResponse {
  return {
    id: row.id,
    organization_id: row.organizationId,
    key: row.key,
    name: row.name,
    trigger_type: row.triggerType,
    wait_hours: row.waitHours,
    template_id: row.templateId,
    applies_to_stage: row.appliesToStage ?? null,
    applies_to_outcome: row.appliesToOutcome ?? null,
    is_active: row.isActive,
    max_attempts: row.maxAttempts,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Rules — CRUD
// ---------------------------------------------------------------------------

/**
 * Lista todas as regras de uma organização, ordenadas por wait_hours.
 */
export async function listFollowupRules(
  db: Database,
  organizationId: string,
): Promise<FollowupRulesListResponse> {
  const rows = await db
    .select()
    .from(followupRules)
    .where(eq(followupRules.organizationId, organizationId))
    .orderBy(followupRules.waitHours);

  return {
    data: rows.map(rowToRuleResponse),
    total: rows.length,
  };
}

/**
 * Busca uma regra por ID dentro da organização.
 * Lança NotFoundError se não encontrar.
 */
export async function getFollowupRuleById(
  db: Database,
  organizationId: string,
  ruleId: string,
): Promise<FollowupRuleResponse> {
  const rows = await db
    .select()
    .from(followupRules)
    .where(and(eq(followupRules.id, ruleId), eq(followupRules.organizationId, organizationId)))
    .limit(1);

  if (rows.length === 0) {
    throw new NotFoundError('Régua de follow-up não encontrada');
  }

  return rowToRuleResponse(rows[0]!);
}

/**
 * Cria uma nova regra de follow-up.
 */
export async function createFollowupRule(
  db: Database,
  organizationId: string,
  input: FollowupRuleCreate,
): Promise<FollowupRuleResponse> {
  const rows = await db
    .insert(followupRules)
    .values({
      organizationId,
      key: input.key,
      name: input.name,
      triggerType: input.trigger_type,
      waitHours: input.wait_hours,
      templateId: input.template_id,
      appliesToStage: input.applies_to_stage ?? null,
      appliesToOutcome: input.applies_to_outcome ?? null,
      isActive: input.is_active ?? false,
      maxAttempts: input.max_attempts ?? 3,
    })
    .returning();

  return rowToRuleResponse(rows[0]!);
}

/**
 * Atualiza parcialmente uma regra.
 * Lança NotFoundError se não encontrar.
 */
export async function updateFollowupRule(
  db: Database,
  organizationId: string,
  ruleId: string,
  input: FollowupRuleUpdate,
): Promise<FollowupRuleResponse> {
  const updateData: Partial<typeof followupRules.$inferInsert> & { updatedAt: Date } = {
    updatedAt: new Date(),
  };

  if (input.name !== undefined) updateData.name = input.name;
  if (input.trigger_type !== undefined) updateData.triggerType = input.trigger_type;
  if (input.wait_hours !== undefined) updateData.waitHours = input.wait_hours;
  if (input.template_id !== undefined) updateData.templateId = input.template_id;
  if ('applies_to_stage' in input) updateData.appliesToStage = input.applies_to_stage ?? null;
  if ('applies_to_outcome' in input) updateData.appliesToOutcome = input.applies_to_outcome ?? null;
  if (input.is_active !== undefined) updateData.isActive = input.is_active;
  if (input.max_attempts !== undefined) updateData.maxAttempts = input.max_attempts;

  const rows = await db
    .update(followupRules)
    .set(updateData)
    .where(and(eq(followupRules.id, ruleId), eq(followupRules.organizationId, organizationId)))
    .returning();

  if (rows.length === 0) {
    throw new NotFoundError('Régua de follow-up não encontrada');
  }

  return rowToRuleResponse(rows[0]!);
}

// ---------------------------------------------------------------------------
// Jobs — listagem + cancel
// ---------------------------------------------------------------------------

/**
 * Lista jobs com filtros paginados.
 * JOIN com leads (nome curto — LGPD), followup_rules (rule_key),
 * whatsapp_templates (template_key apenas — sem body).
 *
 * LGPD: apenas campos não-PII são retornados.
 * lead_name: primeiro nome apenas (split ' ')[0].
 */
export async function listFollowupJobs(
  db: Database,
  organizationId: string,
  query: FollowupJobsListQuery,
): Promise<FollowupJobsListResponse> {
  const offset = (query.page - 1) * query.limit;

  // Build conditions
  const conditions = [eq(followupJobs.organizationId, organizationId)];

  if (query.status) {
    // `as` justificado: FollowupJobStatusSchema valida o valor antes.
    conditions.push(eq(followupJobs.status, query.status as typeof followupJobs.status._.data));
  }

  if (query.rule_id) {
    conditions.push(eq(followupJobs.ruleId, query.rule_id));
  }

  if (query.lead_id) {
    conditions.push(eq(followupJobs.leadId, query.lead_id));
  }

  if (query.date_from) {
    conditions.push(gte(followupJobs.scheduledAt, new Date(query.date_from)));
  }

  if (query.date_to) {
    conditions.push(lte(followupJobs.scheduledAt, new Date(query.date_to)));
  }

  const whereClause = and(...conditions);

  // Count total
  const countResult = await db.select({ total: count() }).from(followupJobs).where(whereClause);

  const total = countResult[0]?.total ?? 0;

  // Data query with JOINs
  const rows = await db
    .select({
      id: followupJobs.id,
      organization_id: followupJobs.organizationId,
      lead_id: followupJobs.leadId,
      // LGPD: apenas primeiro nome (split ' ')[0] é exposto
      lead_name: sql<string | null>`split_part(${leads.name}, ' ', 1)`,
      rule_id: followupJobs.ruleId,
      rule_key: followupRules.key,
      template_key: whatsappTemplates.name,
      scheduled_at: followupJobs.scheduledAt,
      status: followupJobs.status,
      attempt_count: followupJobs.attemptCount,
      last_error: followupJobs.lastError,
      sent_message_id: followupJobs.sentMessageId,
      idempotency_key: followupJobs.idempotencyKey,
      created_at: followupJobs.createdAt,
      updated_at: followupJobs.updatedAt,
    })
    .from(followupJobs)
    .leftJoin(leads, eq(followupJobs.leadId, leads.id))
    .leftJoin(followupRules, eq(followupJobs.ruleId, followupRules.id))
    .leftJoin(whatsappTemplates, eq(followupRules.templateId, whatsappTemplates.id))
    .where(whereClause)
    .orderBy(desc(followupJobs.scheduledAt))
    .limit(query.limit)
    .offset(offset);

  const data: FollowupJobResponse[] = rows.map((row) => ({
    id: row.id,
    organization_id: row.organization_id,
    lead_id: row.lead_id,
    lead_name: row.lead_name ?? null,
    rule_id: row.rule_id,
    rule_key: row.rule_key ?? null,
    template_key: row.template_key ?? null,
    scheduled_at: row.scheduled_at.toISOString(),
    status: row.status as FollowupJobResponse['status'],
    attempt_count: row.attempt_count,
    last_error: row.last_error ?? null,
    sent_message_id: row.sent_message_id ?? null,
    idempotency_key: row.idempotency_key,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  }));

  return {
    data,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

/**
 * Cancela um job (somente status 'scheduled').
 * Lança NotFoundError se não encontrar ou se status não permitir cancelamento.
 *
 * Idempotente: job já cancelado retorna o mesmo job sem erro.
 */
export async function cancelFollowupJob(
  db: Database,
  organizationId: string,
  jobId: string,
): Promise<FollowupJobResponse> {
  // Fetch job primeiro para validação de escopo + status
  const existing = await db
    .select({
      id: followupJobs.id,
      status: followupJobs.status,
      organizationId: followupJobs.organizationId,
    })
    .from(followupJobs)
    .where(and(eq(followupJobs.id, jobId), eq(followupJobs.organizationId, organizationId)))
    .limit(1);

  if (existing.length === 0) {
    throw new NotFoundError('Job de follow-up não encontrado');
  }

  const job = existing[0]!;

  // Idempotente — job já cancelado
  if (job.status === 'cancelled') {
    const rows = await db
      .select({
        id: followupJobs.id,
        organization_id: followupJobs.organizationId,
        lead_id: followupJobs.leadId,
        lead_name: sql<string | null>`split_part(${leads.name}, ' ', 1)`,
        rule_id: followupJobs.ruleId,
        rule_key: followupRules.key,
        template_key: whatsappTemplates.name,
        scheduled_at: followupJobs.scheduledAt,
        status: followupJobs.status,
        attempt_count: followupJobs.attemptCount,
        last_error: followupJobs.lastError,
        sent_message_id: followupJobs.sentMessageId,
        idempotency_key: followupJobs.idempotencyKey,
        created_at: followupJobs.createdAt,
        updated_at: followupJobs.updatedAt,
      })
      .from(followupJobs)
      .leftJoin(leads, eq(followupJobs.leadId, leads.id))
      .leftJoin(followupRules, eq(followupJobs.ruleId, followupRules.id))
      .leftJoin(whatsappTemplates, eq(followupRules.templateId, whatsappTemplates.id))
      .where(eq(followupJobs.id, jobId))
      .limit(1);

    return mapJobRow(rows[0]!);
  }

  // Somente jobs 'scheduled' podem ser cancelados manualmente
  if (job.status !== 'scheduled') {
    const { AppError } = await import('../../shared/errors.js');
    throw new AppError(
      409,
      'CONFLICT',
      `Job no status '${job.status}' não pode ser cancelado — apenas 'scheduled' é cancelável`,
    );
  }

  // Atualiza status para 'cancelled'
  const updatedRows = await db
    .update(followupJobs)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(and(eq(followupJobs.id, jobId), eq(followupJobs.organizationId, organizationId)))
    .returning();

  // Busca com JOINs para resposta completa
  const rows = await db
    .select({
      id: followupJobs.id,
      organization_id: followupJobs.organizationId,
      lead_id: followupJobs.leadId,
      lead_name: sql<string | null>`split_part(${leads.name}, ' ', 1)`,
      rule_id: followupJobs.ruleId,
      rule_key: followupRules.key,
      template_key: whatsappTemplates.name,
      scheduled_at: followupJobs.scheduledAt,
      status: followupJobs.status,
      attempt_count: followupJobs.attemptCount,
      last_error: followupJobs.lastError,
      sent_message_id: followupJobs.sentMessageId,
      idempotency_key: followupJobs.idempotencyKey,
      created_at: followupJobs.createdAt,
      updated_at: followupJobs.updatedAt,
    })
    .from(followupJobs)
    .leftJoin(leads, eq(followupJobs.leadId, leads.id))
    .leftJoin(followupRules, eq(followupJobs.ruleId, followupRules.id))
    .leftJoin(whatsappTemplates, eq(followupRules.templateId, whatsappTemplates.id))
    .where(eq(followupJobs.id, updatedRows[0]!.id))
    .limit(1);

  return mapJobRow(rows[0]!);
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

function mapJobRow(row: {
  id: string;
  organization_id: string;
  lead_id: string;
  lead_name: string | null;
  rule_id: string;
  rule_key: string | null;
  template_key: string | null;
  scheduled_at: Date;
  status: string;
  attempt_count: number;
  last_error: string | null;
  sent_message_id: string | null;
  idempotency_key: string;
  created_at: Date;
  updated_at: Date;
}): FollowupJobResponse {
  return {
    id: row.id,
    organization_id: row.organization_id,
    lead_id: row.lead_id,
    lead_name: row.lead_name ?? null,
    rule_id: row.rule_id,
    rule_key: row.rule_key ?? null,
    template_key: row.template_key ?? null,
    scheduled_at: row.scheduled_at.toISOString(),
    status: row.status as FollowupJobResponse['status'],
    attempt_count: row.attempt_count,
    last_error: row.last_error ?? null,
    sent_message_id: row.sent_message_id ?? null,
    idempotency_key: row.idempotency_key,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}
