// =============================================================================
// billing/repository.ts — Queries Drizzle para cobrança (F5-S08).
//
// Cobre:
//   - Listagem paginada de payment_dues com filtros + JOINs (sem PII completa)
//   - Mark paid / renegotiate de payment_due
//   - CRUD de collection_rules (com validação cross-tenant de template)
//   - Listagem paginada de collection_jobs com filtros + JOINs
//   - Cancel de collection_job
//
// LGPD (doc 17):
//   - payment_dues listadas: customer_id, contract_reference, amount, status.
//   - customer_name: primeiro nome apenas (split_part em ' ')[0]) — redução de PII.
//   - Sem CPF, telefone, email em qualquer query deste repositório.
//
// City-scope:
//   - payment_dues filtradas via customers → leads.city_id (gestor_regional).
//   - null = admin global; [] = sem acesso; string[] = cidades permitidas.
// =============================================================================
import { and, count, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { collectionJobs } from '../../db/schema/collectionJobs.js';
import { collectionRules } from '../../db/schema/collectionRules.js';
import { customers } from '../../db/schema/customers.js';
import { leads } from '../../db/schema/leads.js';
import { paymentDues } from '../../db/schema/paymentDues.js';
import { whatsappTemplates } from '../../db/schema/whatsappTemplates.js';
import { AppError, NotFoundError } from '../../shared/errors.js';

import type {
  CollectionJobResponse,
  CollectionJobsListQuery,
  CollectionJobsListResponse,
  CollectionRuleCreate,
  CollectionRuleResponse,
  CollectionRulesListResponse,
  CollectionRuleUpdate,
  PaymentDueResponse,
  PaymentDuesListQuery,
  PaymentDuesListResponse,
} from './schemas.js';

// ---------------------------------------------------------------------------
// City scope helper (padrão: leads/repository.ts §buildCityScopeCondition)
// ---------------------------------------------------------------------------

/**
 * Constrói condição SQL para filtrar customers por cidade permitida
 * via lead (customers → leads → city_id).
 *
 * - null     → acesso global — sem filtro adicional.
 * - []       → sem scope de cidade — retorna condição falsa (1=0).
 * - string[] → WHERE leads.city_id IN (...).
 */
function buildCityScopeCondition(
  cityScopeIds: string[] | null,
): ReturnType<typeof inArray> | ReturnType<typeof sql> | null {
  if (cityScopeIds === null) {
    return null;
  }
  if (cityScopeIds.length === 0) {
    // `as` justificado: sql<boolean> é compatível com SQL condition no Drizzle.
    return sql`1 = 0` as ReturnType<typeof sql>;
  }
  return inArray(leads.cityId, cityScopeIds);
}

// ---------------------------------------------------------------------------
// Template org validation (M-02, padrão do followup)
// ---------------------------------------------------------------------------

/**
 * Verifica se um template WhatsApp pertence à organização.
 * Use NotFoundError (não ForbiddenError) para não confirmar existência cross-tenant.
 */
export async function checkTemplateInOrg(
  db: Database,
  organizationId: string,
  templateId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: whatsappTemplates.id })
    .from(whatsappTemplates)
    .where(
      and(
        eq(whatsappTemplates.id, templateId),
        eq(whatsappTemplates.organizationId, organizationId),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// PaymentDue row → response mapper
// ---------------------------------------------------------------------------

function mapDueRow(row: {
  id: string;
  organization_id: string;
  customer_id: string;
  customer_name: string | null;
  contract_reference: string;
  installment_number: number;
  due_date: string;
  amount: string;
  status: string;
  paid_at: Date | null;
  origin: string;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}): PaymentDueResponse {
  return {
    id: row.id,
    organization_id: row.organization_id,
    customer_id: row.customer_id,
    customer_name: row.customer_name ?? null,
    contract_reference: row.contract_reference,
    installment_number: row.installment_number,
    due_date: row.due_date,
    amount: row.amount,
    status: row.status as PaymentDueResponse['status'],
    paid_at: row.paid_at ? row.paid_at.toISOString() : null,
    origin: row.origin as PaymentDueResponse['origin'],
    created_by: row.created_by ?? null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Payment dues — listagem
// ---------------------------------------------------------------------------

/**
 * Lista parcelas com filtros paginados.
 * JOIN com customers → leads para city-scope RBAC.
 *
 * LGPD: customer_name = primeiro nome (split_part).
 * M-01: cityScopeIds via leads.city_id.
 */
export async function listPaymentDues(
  db: Database,
  organizationId: string,
  cityScopeIds: string[] | null,
  query: PaymentDuesListQuery,
): Promise<PaymentDuesListResponse> {
  const offset = (query.page - 1) * query.limit;

  const conditions = [eq(paymentDues.organizationId, organizationId)];

  const cityScopeCondition = buildCityScopeCondition(cityScopeIds);
  if (cityScopeCondition !== null) {
    conditions.push(cityScopeCondition);
  }

  if (query.status) {
    // `as` justificado: PaymentDueStatusSchema valida o valor antes.
    conditions.push(eq(paymentDues.status, query.status as typeof paymentDues.status._.data));
  }

  if (query.customer_id) {
    conditions.push(eq(paymentDues.customerId, query.customer_id));
  }

  if (query.date_from) {
    conditions.push(gte(paymentDues.dueDate, query.date_from));
  }

  if (query.date_to) {
    conditions.push(lte(paymentDues.dueDate, query.date_to));
  }

  const whereClause = and(...conditions);

  const countResult = await db
    .select({ total: count() })
    .from(paymentDues)
    .leftJoin(customers, eq(paymentDues.customerId, customers.id))
    .leftJoin(leads, eq(customers.primaryLeadId, leads.id))
    .where(whereClause);

  const total = countResult[0]?.total ?? 0;

  const rows = await db
    .select({
      id: paymentDues.id,
      organization_id: paymentDues.organizationId,
      customer_id: paymentDues.customerId,
      // LGPD: apenas primeiro nome
      customer_name: sql<string | null>`split_part(${leads.name}, ' ', 1)`,
      contract_reference: paymentDues.contractReference,
      installment_number: paymentDues.installmentNumber,
      due_date: paymentDues.dueDate,
      amount: paymentDues.amount,
      status: paymentDues.status,
      paid_at: paymentDues.paidAt,
      origin: paymentDues.origin,
      created_by: paymentDues.createdBy,
      created_at: paymentDues.createdAt,
      updated_at: paymentDues.updatedAt,
    })
    .from(paymentDues)
    .leftJoin(customers, eq(paymentDues.customerId, customers.id))
    .leftJoin(leads, eq(customers.primaryLeadId, leads.id))
    .where(whereClause)
    .orderBy(desc(paymentDues.dueDate))
    .limit(query.limit)
    .offset(offset);

  return {
    data: rows.map(mapDueRow),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

// ---------------------------------------------------------------------------
// Payment dues — get by id
// ---------------------------------------------------------------------------

export async function getPaymentDueById(
  db: Database,
  organizationId: string,
  dueId: string,
): Promise<PaymentDueResponse> {
  const rows = await db
    .select({
      id: paymentDues.id,
      organization_id: paymentDues.organizationId,
      customer_id: paymentDues.customerId,
      customer_name: sql<string | null>`split_part(${leads.name}, ' ', 1)`,
      contract_reference: paymentDues.contractReference,
      installment_number: paymentDues.installmentNumber,
      due_date: paymentDues.dueDate,
      amount: paymentDues.amount,
      status: paymentDues.status,
      paid_at: paymentDues.paidAt,
      origin: paymentDues.origin,
      created_by: paymentDues.createdBy,
      created_at: paymentDues.createdAt,
      updated_at: paymentDues.updatedAt,
    })
    .from(paymentDues)
    .leftJoin(customers, eq(paymentDues.customerId, customers.id))
    .leftJoin(leads, eq(customers.primaryLeadId, leads.id))
    .where(and(eq(paymentDues.id, dueId), eq(paymentDues.organizationId, organizationId)))
    .limit(1);

  if (rows.length === 0) {
    throw new NotFoundError('Parcela não encontrada');
  }

  return mapDueRow(rows[0]!);
}

// ---------------------------------------------------------------------------
// Payment dues — mark paid
// ---------------------------------------------------------------------------

/**
 * Marca uma parcela como paga.
 *
 * Deve ser chamada DENTRO de uma transação ativa (HIGH-02 atomicidade).
 * Faz SELECT ... FOR UPDATE para evitar race com workers.
 *
 * cityScopeIds (HIGH-01): valida que a parcela pertence à cidade do gestor.
 * - null     → acesso global.
 * - []       → sem acesso — sempre 404.
 * - string[] → valida que leads.city_id está no escopo.
 *
 * Idempotente: parcela já paga retorna o mesmo registro sem erro.
 * Rejeita parcelas em status terminal (cancelled, renegotiated).
 */
export async function markPaymentDuePaid(
  db: Database,
  organizationId: string,
  dueId: string,
  cityScopeIds: string[] | null,
): Promise<PaymentDueResponse> {
  // SELECT FOR UPDATE — fecha race com collection-sender e outros workers.
  // JOIN customers → leads para validar city scope (HIGH-01).
  const cityScopeCondition = buildCityScopeCondition(cityScopeIds);

  const existingConditions = [
    eq(paymentDues.id, dueId),
    eq(paymentDues.organizationId, organizationId),
  ];
  if (cityScopeCondition !== null) {
    existingConditions.push(cityScopeCondition);
  }

  const existing = await db
    .select({
      id: paymentDues.id,
      status: paymentDues.status,
      paidAt: paymentDues.paidAt,
    })
    .from(paymentDues)
    .leftJoin(customers, eq(paymentDues.customerId, customers.id))
    .leftJoin(leads, eq(customers.primaryLeadId, leads.id))
    .where(and(...existingConditions))
    .for('update')
    .limit(1);

  if (existing.length === 0) {
    throw new NotFoundError('Parcela não encontrada');
  }

  const due = existing[0]!;

  // Idempotente — já paga
  if (due.status === 'paid') {
    return getPaymentDueById(db, organizationId, dueId);
  }

  // Status terminal não pode ser marcado como pago
  if (due.status === 'cancelled' || due.status === 'renegotiated') {
    throw new AppError(
      409,
      'CONFLICT',
      `Parcela no status '${due.status}' não pode ser marcada como paga`,
    );
  }

  await db
    .update(paymentDues)
    .set({
      status: 'paid',
      paidAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(paymentDues.id, dueId), eq(paymentDues.organizationId, organizationId)));

  return getPaymentDueById(db, organizationId, dueId);
}

// ---------------------------------------------------------------------------
// Payment dues — renegotiate
// ---------------------------------------------------------------------------

/**
 * Marca uma parcela como renegociada.
 *
 * Deve ser chamada DENTRO de uma transação ativa (HIGH-02 atomicidade).
 * Faz SELECT ... FOR UPDATE para evitar race com workers.
 *
 * cityScopeIds (HIGH-01): valida que a parcela pertence à cidade do gestor.
 * - null     → acesso global.
 * - []       → sem acesso — sempre 404.
 * - string[] → valida que leads.city_id está no escopo.
 *
 * Idempotente: parcela já renegociada retorna o mesmo registro sem erro.
 * Rejeita parcelas pagas ou canceladas.
 */
export async function renegotiatePaymentDue(
  db: Database,
  organizationId: string,
  dueId: string,
  cityScopeIds: string[] | null,
): Promise<PaymentDueResponse> {
  // SELECT FOR UPDATE — fecha race com collection-sender e outros workers.
  // JOIN customers → leads para validar city scope (HIGH-01).
  const cityScopeCondition = buildCityScopeCondition(cityScopeIds);

  const existingConditions = [
    eq(paymentDues.id, dueId),
    eq(paymentDues.organizationId, organizationId),
  ];
  if (cityScopeCondition !== null) {
    existingConditions.push(cityScopeCondition);
  }

  const existing = await db
    .select({
      id: paymentDues.id,
      status: paymentDues.status,
    })
    .from(paymentDues)
    .leftJoin(customers, eq(paymentDues.customerId, customers.id))
    .leftJoin(leads, eq(customers.primaryLeadId, leads.id))
    .where(and(...existingConditions))
    .for('update')
    .limit(1);

  if (existing.length === 0) {
    throw new NotFoundError('Parcela não encontrada');
  }

  const due = existing[0]!;

  // Idempotente — já renegociada
  if (due.status === 'renegotiated') {
    return getPaymentDueById(db, organizationId, dueId);
  }

  if (due.status === 'paid' || due.status === 'cancelled') {
    throw new AppError(
      409,
      'CONFLICT',
      `Parcela no status '${due.status}' não pode ser renegociada`,
    );
  }

  await db
    .update(paymentDues)
    .set({
      status: 'renegotiated',
      updatedAt: new Date(),
    })
    .where(and(eq(paymentDues.id, dueId), eq(paymentDues.organizationId, organizationId)));

  return getPaymentDueById(db, organizationId, dueId);
}

// ---------------------------------------------------------------------------
// Collection Rules — CRUD
// ---------------------------------------------------------------------------

function rowToRuleResponse(row: typeof collectionRules.$inferSelect): CollectionRuleResponse {
  return {
    id: row.id,
    organization_id: row.organizationId,
    key: row.key,
    name: row.name,
    trigger_type: row.triggerType,
    wait_hours: row.waitHours,
    template_id: row.templateId,
    applies_to_status: row.appliesToStatus ?? null,
    is_active: row.isActive,
    max_attempts: row.maxAttempts,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export async function listCollectionRules(
  db: Database,
  organizationId: string,
): Promise<CollectionRulesListResponse> {
  const rows = await db
    .select()
    .from(collectionRules)
    .where(eq(collectionRules.organizationId, organizationId))
    .orderBy(collectionRules.waitHours);

  return {
    data: rows.map(rowToRuleResponse),
    total: rows.length,
  };
}

export async function getCollectionRuleById(
  db: Database,
  organizationId: string,
  ruleId: string,
): Promise<CollectionRuleResponse> {
  const rows = await db
    .select()
    .from(collectionRules)
    .where(and(eq(collectionRules.id, ruleId), eq(collectionRules.organizationId, organizationId)))
    .limit(1);

  if (rows.length === 0) {
    throw new NotFoundError('Régua de cobrança não encontrada');
  }

  return rowToRuleResponse(rows[0]!);
}

export async function createCollectionRule(
  db: Database,
  organizationId: string,
  input: CollectionRuleCreate,
): Promise<CollectionRuleResponse> {
  const rows = await db
    .insert(collectionRules)
    .values({
      organizationId,
      key: input.key,
      name: input.name,
      triggerType: input.trigger_type,
      waitHours: input.wait_hours,
      templateId: input.template_id,
      appliesToStatus: input.applies_to_status ?? null,
      isActive: input.is_active ?? false,
      maxAttempts: input.max_attempts ?? 3,
    })
    .returning();

  return rowToRuleResponse(rows[0]!);
}

export async function updateCollectionRule(
  db: Database,
  organizationId: string,
  ruleId: string,
  input: CollectionRuleUpdate,
): Promise<CollectionRuleResponse> {
  const updateData: Partial<typeof collectionRules.$inferInsert> & { updatedAt: Date } = {
    updatedAt: new Date(),
  };

  if (input.name !== undefined) updateData.name = input.name;
  if (input.trigger_type !== undefined) updateData.triggerType = input.trigger_type;
  if (input.wait_hours !== undefined) updateData.waitHours = input.wait_hours;
  if (input.template_id !== undefined) updateData.templateId = input.template_id;
  if ('applies_to_status' in input) updateData.appliesToStatus = input.applies_to_status ?? null;
  if (input.is_active !== undefined) updateData.isActive = input.is_active;
  if (input.max_attempts !== undefined) updateData.maxAttempts = input.max_attempts;

  const rows = await db
    .update(collectionRules)
    .set(updateData)
    .where(and(eq(collectionRules.id, ruleId), eq(collectionRules.organizationId, organizationId)))
    .returning();

  if (rows.length === 0) {
    throw new NotFoundError('Régua de cobrança não encontrada');
  }

  return rowToRuleResponse(rows[0]!);
}

// ---------------------------------------------------------------------------
// Collection Jobs — listagem + cancel
// ---------------------------------------------------------------------------

/**
 * Lista jobs com filtros paginados.
 * JOIN com payment_dues, collection_rules, whatsapp_templates, customers → leads.
 *
 * LGPD: customer_name = primeiro nome; sem CPF, phone, email.
 * M-01: cityScopeIds via leads.city_id (via customers).
 */
export async function listCollectionJobs(
  db: Database,
  organizationId: string,
  cityScopeIds: string[] | null,
  query: CollectionJobsListQuery,
): Promise<CollectionJobsListResponse> {
  const offset = (query.page - 1) * query.limit;

  const conditions = [eq(collectionJobs.organizationId, organizationId)];

  const cityScopeCondition = buildCityScopeCondition(cityScopeIds);
  if (cityScopeCondition !== null) {
    conditions.push(cityScopeCondition);
  }

  if (query.status) {
    // `as` justificado: CollectionJobStatusSchema valida o valor antes.
    conditions.push(eq(collectionJobs.status, query.status as typeof collectionJobs.status._.data));
  }

  if (query.rule_id) {
    conditions.push(eq(collectionJobs.ruleId, query.rule_id));
  }

  if (query.payment_due_id) {
    conditions.push(eq(collectionJobs.paymentDueId, query.payment_due_id));
  }

  if (query.date_from) {
    conditions.push(gte(collectionJobs.scheduledAt, new Date(query.date_from)));
  }

  if (query.date_to) {
    conditions.push(lte(collectionJobs.scheduledAt, new Date(query.date_to)));
  }

  const whereClause = and(...conditions);

  const countResult = await db
    .select({ total: count() })
    .from(collectionJobs)
    .leftJoin(paymentDues, eq(collectionJobs.paymentDueId, paymentDues.id))
    .leftJoin(customers, eq(paymentDues.customerId, customers.id))
    .leftJoin(leads, eq(customers.primaryLeadId, leads.id))
    .where(whereClause);

  const total = countResult[0]?.total ?? 0;

  const rows = await db
    .select({
      id: collectionJobs.id,
      organization_id: collectionJobs.organizationId,
      payment_due_id: collectionJobs.paymentDueId,
      // contract_reference: dado financeiro operacional (não PII)
      contract_reference: paymentDues.contractReference,
      // LGPD: apenas primeiro nome
      customer_name: sql<string | null>`split_part(${leads.name}, ' ', 1)`,
      rule_id: collectionJobs.ruleId,
      rule_key: collectionRules.key,
      template_key: whatsappTemplates.name,
      scheduled_at: collectionJobs.scheduledAt,
      status: collectionJobs.status,
      attempt_count: collectionJobs.attemptCount,
      last_error: collectionJobs.lastError,
      sent_message_id: collectionJobs.sentMessageId,
      idempotency_key: collectionJobs.idempotencyKey,
      created_at: collectionJobs.createdAt,
      updated_at: collectionJobs.updatedAt,
    })
    .from(collectionJobs)
    .leftJoin(paymentDues, eq(collectionJobs.paymentDueId, paymentDues.id))
    .leftJoin(customers, eq(paymentDues.customerId, customers.id))
    .leftJoin(leads, eq(customers.primaryLeadId, leads.id))
    .leftJoin(collectionRules, eq(collectionJobs.ruleId, collectionRules.id))
    .leftJoin(whatsappTemplates, eq(collectionRules.templateId, whatsappTemplates.id))
    .where(whereClause)
    .orderBy(desc(collectionJobs.scheduledAt))
    .limit(query.limit)
    .offset(offset);

  return {
    data: rows.map((row) => ({
      id: row.id,
      organization_id: row.organization_id,
      payment_due_id: row.payment_due_id,
      contract_reference: row.contract_reference ?? null,
      customer_name: row.customer_name ?? null,
      rule_id: row.rule_id,
      rule_key: row.rule_key ?? null,
      template_key: row.template_key ?? null,
      scheduled_at: row.scheduled_at.toISOString(),
      status: row.status as CollectionJobResponse['status'],
      attempt_count: row.attempt_count,
      last_error: row.last_error ?? null,
      sent_message_id: row.sent_message_id ?? null,
      idempotency_key: row.idempotency_key,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    })),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

/**
 * Cancela um collection_job (somente status 'scheduled').
 *
 * Idempotente: job já cancelado retorna o mesmo job sem erro.
 * M-01: cityScopeIds valida que o lead do job pertence à cidade permitida.
 */
export async function cancelCollectionJob(
  db: Database,
  organizationId: string,
  cityScopeIds: string[] | null,
  jobId: string,
): Promise<CollectionJobResponse> {
  const existingConditions = [
    eq(collectionJobs.id, jobId),
    eq(collectionJobs.organizationId, organizationId),
  ];

  const cityScopeCondition = buildCityScopeCondition(cityScopeIds);
  if (cityScopeCondition !== null) {
    existingConditions.push(cityScopeCondition);
  }

  const existing = await db
    .select({
      id: collectionJobs.id,
      status: collectionJobs.status,
    })
    .from(collectionJobs)
    .leftJoin(paymentDues, eq(collectionJobs.paymentDueId, paymentDues.id))
    .leftJoin(customers, eq(paymentDues.customerId, customers.id))
    .leftJoin(leads, eq(customers.primaryLeadId, leads.id))
    .where(and(...existingConditions))
    .limit(1);

  if (existing.length === 0) {
    throw new NotFoundError('Job de cobrança não encontrado');
  }

  const job = existing[0]!;

  // Idempotente — job já cancelado
  if (job.status === 'cancelled') {
    return fetchJobById(db, jobId);
  }

  if (job.status !== 'scheduled') {
    throw new AppError(
      409,
      'CONFLICT',
      `Job no status '${job.status}' não pode ser cancelado — apenas 'scheduled' é cancelável`,
    );
  }

  await db
    .update(collectionJobs)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(and(eq(collectionJobs.id, jobId), eq(collectionJobs.organizationId, organizationId)));

  return fetchJobById(db, jobId);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function fetchJobById(db: Database, jobId: string): Promise<CollectionJobResponse> {
  const rows = await db
    .select({
      id: collectionJobs.id,
      organization_id: collectionJobs.organizationId,
      payment_due_id: collectionJobs.paymentDueId,
      contract_reference: paymentDues.contractReference,
      customer_name: sql<string | null>`split_part(${leads.name}, ' ', 1)`,
      rule_id: collectionJobs.ruleId,
      rule_key: collectionRules.key,
      template_key: whatsappTemplates.name,
      scheduled_at: collectionJobs.scheduledAt,
      status: collectionJobs.status,
      attempt_count: collectionJobs.attemptCount,
      last_error: collectionJobs.lastError,
      sent_message_id: collectionJobs.sentMessageId,
      idempotency_key: collectionJobs.idempotencyKey,
      created_at: collectionJobs.createdAt,
      updated_at: collectionJobs.updatedAt,
    })
    .from(collectionJobs)
    .leftJoin(paymentDues, eq(collectionJobs.paymentDueId, paymentDues.id))
    .leftJoin(customers, eq(paymentDues.customerId, customers.id))
    .leftJoin(leads, eq(customers.primaryLeadId, leads.id))
    .leftJoin(collectionRules, eq(collectionJobs.ruleId, collectionRules.id))
    .leftJoin(whatsappTemplates, eq(collectionRules.templateId, whatsappTemplates.id))
    .where(eq(collectionJobs.id, jobId))
    .limit(1);

  return {
    id: rows[0]!.id,
    organization_id: rows[0]!.organization_id,
    payment_due_id: rows[0]!.payment_due_id,
    contract_reference: rows[0]!.contract_reference ?? null,
    customer_name: rows[0]!.customer_name ?? null,
    rule_id: rows[0]!.rule_id,
    rule_key: rows[0]!.rule_key ?? null,
    template_key: rows[0]!.template_key ?? null,
    scheduled_at: rows[0]!.scheduled_at.toISOString(),
    status: rows[0]!.status as CollectionJobResponse['status'],
    attempt_count: rows[0]!.attempt_count,
    last_error: rows[0]!.last_error ?? null,
    sent_message_id: rows[0]!.sent_message_id ?? null,
    idempotency_key: rows[0]!.idempotency_key,
    created_at: rows[0]!.created_at.toISOString(),
    updated_at: rows[0]!.updated_at.toISOString(),
  };
}
