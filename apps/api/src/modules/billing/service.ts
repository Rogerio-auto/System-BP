// =============================================================================
// billing/service.ts — Regras de negócio para cobrança (F5-S08).
//
// Responsabilidades:
//   - Validar cross-tenant: template_id e payment_due_id pertencem à org.
//   - Delegar ao repository para queries Drizzle.
//   - Chamar cancelCollectionJobsOnPayment ao marcar parcela como paga.
//   - Emitir eventos e audit logs em mutações sensíveis.
//
// RBAC verificado nas rotas — não aqui.
// =============================================================================
import type { Database } from '../../db/client.js';
import { cancelCollectionJobsOnPayment } from '../../handlers/cancel-collections-on-payment.js';
import { auditLog } from '../../lib/audit.js';
import type { AuditTx } from '../../lib/audit.js';
import { NotFoundError } from '../../shared/errors.js';

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
 * 1. Atualiza status + paid_at.
 * 2. Cancela todos os collection_jobs 'scheduled' da parcela (via handler F5-S07).
 * 3. Emite billing.due_paid no outbox.
 * 4. Audit log.
 */
export async function markPaidService(
  db: Database,
  organizationId: string,
  dueId: string,
  actor: { userId: string; ip: string | null },
): Promise<PaymentDueResponse> {
  const due = await markPaymentDuePaid(db, organizationId, dueId);

  // Cancela collection_jobs 'scheduled' da parcela (F5-S07 handler)
  await cancelCollectionJobsOnPayment(db, {
    paymentDueId: dueId,
    organizationId,
    correlationId: `mark-paid:${dueId}:${actor.userId}`,
  });

  // Audit log da marcação
  await db.transaction(async (tx) => {
    const txForAudit = tx as unknown as AuditTx;

    await auditLog(txForAudit, {
      organizationId,
      actor: { userId: actor.userId, role: 'user', ip: actor.ip },
      action: 'billing.due_marked_paid',
      resource: { type: 'payment_due', id: dueId },
      after: { payment_due_id: dueId, status: 'paid' },
      correlationId: null,
    });
  });

  return due;
}

/**
 * Marca parcela como renegociada.
 * Cancela collection_jobs pendentes e emite evento.
 */
export async function renegotiateService(
  db: Database,
  organizationId: string,
  dueId: string,
  actor: { userId: string; ip: string | null },
): Promise<PaymentDueResponse> {
  const due = await renegotiatePaymentDue(db, organizationId, dueId);

  // Cancela collection_jobs 'scheduled' da parcela
  await cancelCollectionJobsOnPayment(db, {
    paymentDueId: dueId,
    organizationId,
    correlationId: `renegotiate:${dueId}:${actor.userId}`,
  });

  await db.transaction(async (tx) => {
    const txForAudit = tx as unknown as AuditTx;

    await auditLog(txForAudit, {
      organizationId,
      actor: { userId: actor.userId, role: 'user', ip: actor.ip },
      action: 'billing.due_renegotiated',
      resource: { type: 'payment_due', id: dueId },
      after: { payment_due_id: dueId, status: 'renegotiated' },
      correlationId: null,
    });
  });

  return due;
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
