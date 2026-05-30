// =============================================================================
// billing/service.ts — Regras de negócio para cobrança (F5-S08).
//
// Responsabilidades:
//   - Validar cross-tenant: template_id e payment_due_id pertencem à org.
//   - Delegar ao repository para queries Drizzle.
//   - Atomicidade completa: mark-paid e renegotiate em transação única (HIGH-02).
//   - City scope: propagado para repository (HIGH-01).
//   - Idempotency-Key: verifica antes de processar, persiste após sucesso (HIGH-03).
//   - Outbox: emite billing.due_paid / billing.due_renegotiated na transação (MEDIUM-02).
//   - Audit log na mesma transação.
//
// RBAC verificado nas rotas — não aqui.
// =============================================================================
import crypto from 'node:crypto';

import type { Database } from '../../db/client.js';
import { idempotencyKeys } from '../../db/schema/idempotencyKeys.js';
import { emit } from '../../events/emit.js';
import type { DrizzleTx } from '../../events/emit.js';
import type { BillingDuePaidData, BillingDueRenegotiatedData } from '../../events/types.js';
import { cancelCollectionJobsOnPayment } from '../../handlers/cancel-collections-on-payment.js';
import { auditLog } from '../../lib/audit.js';
import type { AuditTx } from '../../lib/audit.js';
import { AppError, NotFoundError } from '../../shared/errors.js';

import {
  cancelCollectionJob,
  checkTemplateInOrg,
  createCollectionRule,
  getCollectionRuleById,
  listCollectionJobs,
  listCollectionRules,
  listPaymentDues,
  markPaymentDuePaid,
  renegotiatePaymentDue,
  updateCollectionRule,
} from './repository.js';
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
// Idempotency-key helper — padrão do projeto (F1-S08, ver whatsapp/service.ts)
// ---------------------------------------------------------------------------

/**
 * Tenta recuperar uma resposta previamente cacheada para a chave.
 * Retorna a resposta se existir, null caso contrário.
 * LGPD: response_body armazena apenas { payment_due_id: uuid } — sem PII.
 */
async function checkIdempotencyKey(db: Database, key: string): Promise<PaymentDueResponse | null> {
  const { eq } = await import('drizzle-orm');
  const rows = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, key)).limit(1);

  if (rows.length === 0) return null;

  const cached = rows[0]!.responseBody;
  // `as` justificado: responseBody é JSONB armazenado pelo próprio service
  // com estrutura PaymentDueResponse — sem PII, só IDs e metadados.
  return cached as PaymentDueResponse;
}

/**
 * Persiste a chave de idempotência e a resposta cacheada (dentro da tx).
 * Deve estar na mesma transação que a mutação para atomicidade.
 */
async function persistIdempotencyKey(
  // `as` justificado: Drizzle não exporta tipo público da transação.
  // A interface estrutural mínima compatível é Database para o insert.
  tx: Database,
  key: string,
  endpoint: string,
  response: PaymentDueResponse,
): Promise<void> {
  // requestHash placeholder — billing não faz hash do body (sem body relevante).
  // O campo é obrigatório no schema mas não usado para validação aqui
  // pois o key já é suficientemente único (UUID fornecido pelo caller).
  const requestHash = crypto.createHash('sha256').update(key).digest('hex');

  await tx.insert(idempotencyKeys).values({
    key,
    endpoint,
    requestHash,
    responseStatus: 200,
    // LGPD: armazena apenas { payment_due_id: uuid } — sem PII bruta.
    responseBody: { payment_due_id: response.id },
  });
}

// ---------------------------------------------------------------------------
// PaymentDues service
// ---------------------------------------------------------------------------

export async function listDuesService(
  db: Database,
  organizationId: string,
  cityScopeIds: string[] | null,
  query: PaymentDuesListQuery,
): Promise<PaymentDuesListResponse> {
  return listPaymentDues(db, organizationId, cityScopeIds, query);
}

/**
 * Marca parcela como paga.
 *
 * HIGH-01: cityScopeIds propagado para repository — gestor_regional só pode
 * marcar parcelas de clientes dentro de sua(s) cidade(s).
 *
 * HIGH-02: transação única envolve:
 *   1. SELECT FOR UPDATE + UPDATE payment_due → paid (repository)
 *   2. cancelCollectionJobsOnPayment (handler F5-S07) — passa tx interna
 *   3. auditLog
 *   4. emit billing.due_paid (outbox)
 *   5. persistIdempotencyKey
 *
 * HIGH-03: Idempotency-Key obrigatória. Se chave já existe, retorna resposta
 * cacheada sem reprocessar.
 *
 * MEDIUM-02: emite billing.due_paid no outbox.
 */
export async function markPaidService(
  db: Database,
  organizationId: string,
  dueId: string,
  cityScopeIds: string[] | null,
  actor: { userId: string; ip: string | null },
  idempotencyKey: string,
): Promise<PaymentDueResponse> {
  // HIGH-03: verificar chave antes de processar (fora da tx — leitura rápida)
  const cached = await checkIdempotencyKey(db, idempotencyKey);
  if (cached !== null) {
    return cached;
  }

  let result!: PaymentDueResponse;

  await db.transaction(async (tx) => {
    // `as` justificados: Drizzle não exporta tipo público da transação.
    // Database, DrizzleTx e AuditTx são interfaces estruturais compatíveis.
    const txDb = tx as unknown as Database;
    const txForEmit = tx as unknown as DrizzleTx;
    const txForAudit = tx as unknown as AuditTx;

    // HIGH-01 + HIGH-02: SELECT FOR UPDATE + UPDATE dentro da transação
    result = await markPaymentDuePaid(txDb, organizationId, dueId, cityScopeIds);

    // HIGH-02: cancelar collection_jobs scheduled (handler F5-S07)
    // activeTx passado para que o handler opere na MESMA transação (sem savepoint).
    await cancelCollectionJobsOnPayment(
      txDb,
      {
        paymentDueId: dueId,
        organizationId,
        correlationId: `mark-paid:${dueId}:${actor.userId}`,
      },
      txDb,
    );

    // HIGH-02: audit log na mesma transação
    await auditLog(txForAudit, {
      organizationId,
      actor: { userId: actor.userId, role: 'user', ip: actor.ip },
      action: 'billing.due_marked_paid',
      resource: { type: 'payment_due', id: dueId },
      // LGPD: apenas status — sem PII
      after: { payment_due_id: dueId, status: 'paid' },
      correlationId: null,
    });

    // MEDIUM-02: outbox billing.due_paid na mesma transação
    // Payload: apenas IDs opacos + dados financeiros operacionais (sem PII bruta)
    const amountCents = Math.round(parseFloat(result.amount) * 100);
    const eventData: BillingDuePaidData = {
      payment_due_id: result.id,
      customer_id: result.customer_id,
      amount_cents: amountCents,
      due_date: result.due_date,
    };
    await emit(txForEmit, {
      eventName: 'billing.due_paid',
      aggregateType: 'payment_due',
      aggregateId: dueId,
      organizationId,
      actor: { kind: 'user', id: actor.userId, ip: actor.ip },
      idempotencyKey: `billing.due_paid:${dueId}`,
      data: eventData,
    });

    // HIGH-03: persistir idempotency-key na mesma transação
    // Se a tx fizer rollback, a key também não é gravada.
    await persistIdempotencyKey(
      txDb,
      idempotencyKey,
      'POST /api/billing/payment-dues/:id/mark-paid',
      result,
    );
  });

  return result;
}

/**
 * Marca parcela como renegociada.
 *
 * HIGH-01: cityScopeIds propagado para repository.
 * HIGH-02: transação única envolve UPDATE + cancelJobs + audit + outbox + idempotency.
 * HIGH-03: Idempotency-Key obrigatória.
 * MEDIUM-02: emite billing.due_renegotiated no outbox.
 */
export async function renegotiateService(
  db: Database,
  organizationId: string,
  dueId: string,
  cityScopeIds: string[] | null,
  actor: { userId: string; ip: string | null },
  idempotencyKey: string,
): Promise<PaymentDueResponse> {
  // HIGH-03: verificar chave antes de processar (fora da tx — leitura rápida)
  const cached = await checkIdempotencyKey(db, idempotencyKey);
  if (cached !== null) {
    return cached;
  }

  let result!: PaymentDueResponse;

  await db.transaction(async (tx) => {
    // `as` justificados: Drizzle não exporta tipo público da transação.
    const txDb = tx as unknown as Database;
    const txForEmit = tx as unknown as DrizzleTx;
    const txForAudit = tx as unknown as AuditTx;

    // HIGH-01 + HIGH-02: SELECT FOR UPDATE + UPDATE dentro da transação
    result = await renegotiatePaymentDue(txDb, organizationId, dueId, cityScopeIds);

    // HIGH-02: cancelar collection_jobs scheduled
    // activeTx passado para que o handler opere na MESMA transação (sem savepoint).
    await cancelCollectionJobsOnPayment(
      txDb,
      {
        paymentDueId: dueId,
        organizationId,
        correlationId: `renegotiate:${dueId}:${actor.userId}`,
      },
      txDb,
    );

    // HIGH-02: audit log na mesma transação
    await auditLog(txForAudit, {
      organizationId,
      actor: { userId: actor.userId, role: 'user', ip: actor.ip },
      action: 'billing.due_renegotiated',
      resource: { type: 'payment_due', id: dueId },
      // LGPD: apenas status — sem PII
      after: { payment_due_id: dueId, status: 'renegotiated' },
      correlationId: null,
    });

    // MEDIUM-02: outbox billing.due_renegotiated na mesma transação
    const amountCents = Math.round(parseFloat(result.amount) * 100);
    const eventData: BillingDueRenegotiatedData = {
      payment_due_id: result.id,
      customer_id: result.customer_id,
      amount_cents: amountCents,
      due_date: result.due_date,
    };
    await emit(txForEmit, {
      eventName: 'billing.due_renegotiated',
      aggregateType: 'payment_due',
      aggregateId: dueId,
      organizationId,
      actor: { kind: 'user', id: actor.userId, ip: actor.ip },
      idempotencyKey: `billing.due_renegotiated:${dueId}`,
      data: eventData,
    });

    // HIGH-03: persistir idempotency-key na mesma transação
    await persistIdempotencyKey(
      txDb,
      idempotencyKey,
      'POST /api/billing/payment-dues/:id/renegotiate',
      result,
    );
  });

  return result;
}

// ---------------------------------------------------------------------------
// CollectionRules service
// ---------------------------------------------------------------------------

export async function listRulesService(
  db: Database,
  organizationId: string,
): Promise<CollectionRulesListResponse> {
  return listCollectionRules(db, organizationId);
}

export async function createRuleService(
  db: Database,
  organizationId: string,
  input: CollectionRuleCreate,
): Promise<CollectionRuleResponse> {
  // M-02: validar que template_id pertence à org
  const templateExists = await checkTemplateInOrg(db, organizationId, input.template_id);
  if (!templateExists) {
    throw new NotFoundError('Template não encontrado');
  }
  return createCollectionRule(db, organizationId, input);
}

export async function updateRuleService(
  db: Database,
  organizationId: string,
  ruleId: string,
  input: CollectionRuleUpdate,
): Promise<CollectionRuleResponse> {
  await getCollectionRuleById(db, organizationId, ruleId);

  if (input.template_id !== undefined) {
    const templateExists = await checkTemplateInOrg(db, organizationId, input.template_id);
    if (!templateExists) {
      throw new NotFoundError('Template não encontrado');
    }
  }

  return updateCollectionRule(db, organizationId, ruleId, input);
}

// ---------------------------------------------------------------------------
// CollectionJobs service
// ---------------------------------------------------------------------------

export async function listJobsService(
  db: Database,
  organizationId: string,
  cityScopeIds: string[] | null,
  query: CollectionJobsListQuery,
): Promise<CollectionJobsListResponse> {
  return listCollectionJobs(db, organizationId, cityScopeIds, query);
}

export async function cancelJobService(
  db: Database,
  organizationId: string,
  cityScopeIds: string[] | null,
  jobId: string,
): Promise<CollectionJobResponse> {
  return cancelCollectionJob(db, organizationId, cityScopeIds, jobId);
}

// Re-export AppError/NotFoundError para facilitar uso nos testes
export { AppError, NotFoundError };
