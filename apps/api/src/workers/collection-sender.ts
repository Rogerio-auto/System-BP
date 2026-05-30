// =============================================================================
// workers/collection-sender.ts — Worker de envio de cobranças via Meta WhatsApp (F5-S07).
//
// Processo Node.js SEPARADO. Iniciado via: pnpm --filter @elemento/api worker:collection:sender
//
// Responsabilidade:
//   Para cada tick, busca lote de collection_jobs com status='scheduled' e
//   scheduled_at <= now(). Para cada job:
//     1. Carrega contexto: regra, template, parcela, customer e lead (via customer).
//     2. Skip se payment_due.status='paid' → atualiza job para 'paid_before_send'.
//     3. Verifica consentimento LGPD: customer.consent_revoked_at IS NULL.
//     4. Renderiza variáveis do template.
//     5. Chama Meta WhatsApp Cloud API via MetaWhatsAppClient (REUSA F5-S03).
//     6. Atualiza job: status='sent', sent_message_id=wamid.
//     7. Emite outbox 'billing.collection_sent' + auditLog na mesma transação.
//
// Em caso de erro:
//     - attempt_count++ + last_error
//     - Se attempt_count >= rule.max_attempts: status='failed' (terminal)
//     - Backoff exponencial: scheduled_at = now() + exponential_backoff(attempt_count)
//     - Emite outbox 'billing.collection_failed'
//
// Flag-gating em 2 camadas:
//   Camada 1 — billing.enabled=disabled:
//     Worker sai cedo. Nenhuma query de jobs executada.
//   Camada 2 — billing.sender.enabled=disabled:
//     Lógica roda completa (identifica jobs, renderiza variáveis), mas NÃO
//     chama a Meta API. Loga dry_run=true para auditoria.
//
// LGPD §8.3/§8.5:
//   - Template category='utility' — base legal: Art. 7º V (execução de contrato).
//   - Telefone NUNCA em logs — MetaWhatsAppClient usa `to_hash` internamente.
//   - Outbox sem PII bruta: payloads carregam apenas IDs opacos + template_key + wamid.
//   - Consentimento verificado antes de qualquer chamada à Meta.
//   - Audit log por envio.
// =============================================================================

import { and, eq, lte } from 'drizzle-orm';

import { env } from '../config/env.js';
import { db as defaultDb } from '../db/client.js';
import type { Database } from '../db/client.js';
import {
  collectionJobs,
  collectionRules,
  customers,
  leads,
  paymentDues,
  whatsappTemplates,
} from '../db/schema/index.js';
import type { CollectionJob, CollectionRule } from '../db/schema/index.js';
import type { WhatsappTemplate } from '../db/schema/index.js';
import { emit } from '../events/emit.js';
import type { DrizzleTx } from '../events/emit.js';
import type {
  CollectionCancelledData,
  CollectionFailedData,
  CollectionSentData,
} from '../events/types.js';
import { MetaWhatsAppClient } from '../integrations/meta-whatsapp/client.js';
import type { SendTemplateParams } from '../integrations/meta-whatsapp/types.js';
import { auditLog } from '../lib/audit.js';
import type { AuditTx } from '../lib/audit.js';
import { isFlagEnabled } from '../modules/featureFlags/service.js';
import { ExternalServiceError } from '../shared/errors.js';

import { createWorkerRuntime } from './_runtime.js';

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

const WORKER_NAME = 'collection-sender';

/** Tamanho do lote por tick. */
const BATCH_SIZE = 50;

/** Default do tick em ms. */
const DEFAULT_TICK_MS = 30_000;

/** Base do backoff exponencial (ms). */
const BACKOFF_BASE_MS = 5 * 60 * 1000; // 5 minutos

/** Cap máximo do backoff (ms). */
const BACKOFF_MAX_MS = 24 * 60 * 60 * 1000; // 24 horas

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

/**
 * Contexto completo para processar um collection_job.
 * Carregado via queries separadas a partir do job.
 *
 * LGPD: phoneE164 e name são carregados apenas para renderização —
 * nunca logados diretamente. Logs usam apenas IDs.
 */
export interface CollectionJobContext {
  job: CollectionJob;
  rule: CollectionRule;
  template: WhatsappTemplate;
  due: {
    id: string;
    organizationId: string;
    contractReference: string;
    installmentNumber: number;
    dueDate: string;
    amount: string;
    status: string;
    customerId: string;
  };
  /** null se customer não encontrado (situação de erro). */
  customer: {
    id: string;
    organizationId: string;
    primaryLeadId: string;
    consentRevokedAt: Date | null;
  } | null;
  /** null se lead não encontrado. */
  lead: {
    id: string;
    name: string;
    phoneE164: string;
    deletedAt: Date | null;
    status: string;
  } | null;
}

export interface CollectionJobTickResult {
  jobId: string;
  paymentDueId: string;
  templateKey: string;
  outcome: 'sent' | 'dry_run' | 'skipped' | 'failed' | 'consent_blocked' | 'paid_before_send';
  wamid?: string;
  error?: string;
  attemptCount: number;
  terminal: boolean;
}

// ---------------------------------------------------------------------------
// Logger interface mínima
// ---------------------------------------------------------------------------

export interface SenderLogger {
  info(obj: object, msg?: string): void;
  debug(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

// ---------------------------------------------------------------------------
// Backoff exponencial
// ---------------------------------------------------------------------------

/**
 * Calcula o delay de backoff para re-agendar após falha.
 * delay = min(base * 2^(attemptCount - 1), maxMs)
 */
export function calcCollectionJobBackoff(attemptCount: number): number {
  const exponential = BACKOFF_BASE_MS * Math.pow(2, attemptCount - 1);
  return Math.min(exponential, BACKOFF_MAX_MS);
}

// ---------------------------------------------------------------------------
// Renderização de variáveis do template
// ---------------------------------------------------------------------------

/**
 * Renderiza as variáveis do template de cobrança a partir do contexto.
 *
 * Variáveis suportadas (doc 07 §3 — templates de cobrança):
 *   customer_name      → lead.name
 *   installment_number → due.installmentNumber
 *   amount             → due.amount formatado em BRL
 *   due_date           → due.dueDate formatado em pt-BR
 *   contract_reference → due.contractReference
 *
 * LGPD: valores não são logados em nível info.
 */
export function renderCollectionTemplateVariables(
  variables: string[],
  ctx: CollectionJobContext,
): Array<{ type: 'text'; text: string }> {
  const formatBrl = (value: string): string => {
    const num = parseFloat(value);
    if (!Number.isFinite(num)) return value;
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
    }).format(num);
  };

  const formatDate = (dateStr: string): string => {
    // dateStr é 'YYYY-MM-DD' (tipo date do Postgres)
    const [year, month, day] = dateStr.split('-');
    // Validação defensiva: se o split não produzir 3 partes, retornar como está
    if (year === undefined || month === undefined || day === undefined) return dateStr;
    return `${day}/${month}/${year}`;
  };

  return variables.map((varName) => {
    let text: string;

    switch (varName) {
      case 'customer_name':
        text = ctx.lead !== null ? ctx.lead.name : '';
        break;
      case 'installment_number':
        text = String(ctx.due.installmentNumber);
        break;
      case 'amount':
        text = formatBrl(ctx.due.amount);
        break;
      case 'due_date':
        text = formatDate(ctx.due.dueDate);
        break;
      case 'contract_reference':
        text = ctx.due.contractReference;
        break;
      default:
        // Variável não mapeada — string vazia.
        text = '';
    }

    return { type: 'text' as const, text };
  });
}

// ---------------------------------------------------------------------------
// Construção do payload de envio
// ---------------------------------------------------------------------------

/**
 * Monta os parâmetros para MetaWhatsAppClient.sendTemplate().
 */
export function buildCollectionSendParams(ctx: CollectionJobContext): SendTemplateParams {
  const parameters = renderCollectionTemplateVariables(ctx.template.variables, ctx);

  // lead.phoneE164 é garantido por validação prévia em processCollectionJob()
  // O caller verifica ctx.lead !== null antes de chamar esta função.
  const phoneE164 = ctx.lead !== null ? ctx.lead.phoneE164 : '';

  return {
    to: phoneE164,
    templateName: ctx.template.name,
    language: ctx.template.language,
    components: parameters.length > 0 ? [{ type: 'body', parameters }] : [],
  };
}

// ---------------------------------------------------------------------------
// Carregamento de contexto
// ---------------------------------------------------------------------------

/**
 * Carrega o contexto completo para um collection_job.
 *
 * LGPD: name e phoneE164 do lead são carregados apenas para renderização.
 * Nunca logados diretamente — apenas IDs em logs.
 *
 * Retorna null se regra, template ou parcela não forem encontrados.
 */
export async function loadCollectionJobContext(
  database: Database,
  job: CollectionJob,
): Promise<CollectionJobContext | null> {
  // 1. Carregar regra + template em join
  const ruleRows = await database
    .select({
      rule: collectionRules,
      template: whatsappTemplates,
    })
    .from(collectionRules)
    .innerJoin(whatsappTemplates, eq(collectionRules.templateId, whatsappTemplates.id))
    .where(eq(collectionRules.id, job.ruleId))
    .limit(1);

  const ruleRow = ruleRows[0];
  if (ruleRow === undefined) return null;

  // 2. Carregar parcela
  const dueRows = await database
    .select({
      id: paymentDues.id,
      organizationId: paymentDues.organizationId,
      contractReference: paymentDues.contractReference,
      installmentNumber: paymentDues.installmentNumber,
      dueDate: paymentDues.dueDate,
      amount: paymentDues.amount,
      status: paymentDues.status,
      customerId: paymentDues.customerId,
    })
    .from(paymentDues)
    .where(eq(paymentDues.id, job.paymentDueId))
    .limit(1);

  const dueData = dueRows[0];
  if (dueData === undefined) return null;

  // 3. Carregar customer (para consentimento LGPD)
  const customerRows = await database
    .select({
      id: customers.id,
      organizationId: customers.organizationId,
      primaryLeadId: customers.primaryLeadId,
      consentRevokedAt: customers.consentRevokedAt,
    })
    .from(customers)
    .where(eq(customers.id, dueData.customerId))
    .limit(1);

  const customerData = customerRows[0] ?? null;

  // 4. Carregar lead (para telefone e nome do template)
  // Lead obtido via customer.primaryLeadId — o lead original do cliente
  let leadData: CollectionJobContext['lead'] = null;
  if (customerData !== null) {
    const leadRows = await database
      .select({
        id: leads.id,
        name: leads.name,
        phoneE164: leads.phoneE164,
        deletedAt: leads.deletedAt,
        status: leads.status,
      })
      .from(leads)
      .where(eq(leads.id, customerData.primaryLeadId))
      .limit(1);

    const rawLead = leadRows[0];
    if (rawLead !== undefined) {
      leadData = rawLead;
    }
  }

  return {
    job,
    rule: ruleRow.rule,
    template: ruleRow.template,
    due: dueData,
    customer: customerData,
    lead: leadData,
  };
}

// ---------------------------------------------------------------------------
// Processamento de um job
// ---------------------------------------------------------------------------

/**
 * Processa um único collection_job.
 *
 * @param database    Instância Drizzle (injetável para testes).
 * @param metaClient  Cliente Meta (injetável para testes). null = dry-run forçado.
 * @param job         Job a processar.
 * @param dryRun      Se true, não chama Meta API.
 * @param logger      Logger do worker.
 */
export async function processCollectionJob(
  database: Database,
  metaClient: MetaWhatsAppClient | null,
  job: CollectionJob,
  dryRun: boolean,
  logger: SenderLogger,
): Promise<CollectionJobTickResult> {
  // -------------------------------------------------------------------------
  // 1. Carregar contexto
  // -------------------------------------------------------------------------
  const ctx = await loadCollectionJobContext(database, job);

  if (ctx === null) {
    await database
      .update(collectionJobs)
      .set({
        status: 'failed',
        attemptCount: job.attemptCount + 1,
        lastError: 'Contexto não encontrado: regra, template ou parcela removidos',
        updatedAt: new Date(),
      })
      .where(eq(collectionJobs.id, job.id));

    logger.warn(
      { event: 'collection_sender.job_context_missing', job_id: job.id },
      `job ${job.id}: contexto não encontrado — marcado como failed`,
    );

    return {
      jobId: job.id,
      paymentDueId: job.paymentDueId,
      templateKey: 'unknown',
      outcome: 'failed',
      error: 'contexto_missing',
      attemptCount: job.attemptCount + 1,
      terminal: true,
    };
  }

  // -------------------------------------------------------------------------
  // 2. Skip se parcela já foi paga (paid_before_send)
  // -------------------------------------------------------------------------
  if (ctx.due.status === 'paid') {
    await database
      .update(collectionJobs)
      .set({
        status: 'paid_before_send',
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(collectionJobs.id, job.id));

    // Emitir billing.collection_cancelled com razão 'paid_before_send
    await database.transaction(async (tx) => {
      const txForEmit = tx as unknown as DrizzleTx;
      const txForAudit = tx as unknown as AuditTx;

      const cancelledData: CollectionCancelledData = {
        collection_job_id: job.id,
        payment_due_id: job.paymentDueId,
        rule_id: job.ruleId,
        reason: 'paid_before_send',
      };

      await emit(txForEmit, {
        eventName: 'billing.collection_cancelled',
        aggregateType: 'collection_job',
        aggregateId: job.id,
        organizationId: job.organizationId,
        actor: { kind: 'worker', id: null, ip: null },
        idempotencyKey: `billing.collection_cancelled:${job.id}:paid_before_send`,
        data: cancelledData,
      });

      await auditLog(txForAudit, {
        organizationId: job.organizationId,
        actor: null,
        action: 'billing.collection_skipped_paid',
        resource: { type: 'collection_job', id: job.id },
        after: {
          job_id: job.id,
          // LGPD: apenas IDs opacos — sem número de contrato ou valor no log
          payment_due_id: job.paymentDueId,
          rule_id: job.ruleId,
          reason: 'paid_before_send',
        },
      });
    });

    logger.info(
      {
        event: 'collection_sender.job_paid_before_send',
        job_id: job.id,
        // LGPD: payment_due_id é ID opaco — sem PII
        payment_due_id: job.paymentDueId,
      },
      `job ${job.id}: parcela paga antes do envio — job marcado paid_before_send`,
    );

    return {
      jobId: job.id,
      paymentDueId: job.paymentDueId,
      templateKey: ctx.template.name,
      outcome: 'paid_before_send',
      attemptCount: job.attemptCount,
      terminal: true,
    };
  }

  // -------------------------------------------------------------------------
  // 3. Verificar consentimento LGPD (doc 17)
  // -------------------------------------------------------------------------
  if (ctx.customer !== null && ctx.customer.consentRevokedAt !== null) {
    await database
      .update(collectionJobs)
      .set({
        status: 'cancelled',
        lastError: 'Consentimento revogado pelo titular',
        updatedAt: new Date(),
      })
      .where(eq(collectionJobs.id, job.id));

    logger.info(
      {
        event: 'collection_sender.job_consent_blocked',
        job_id: job.id,
        // LGPD: apenas customer_id opaco — sem PII
        customer_id: ctx.due.customerId,
      },
      `job ${job.id}: consentimento revogado — job cancelado (LGPD)`,
    );

    return {
      jobId: job.id,
      paymentDueId: job.paymentDueId,
      templateKey: ctx.template.name,
      outcome: 'consent_blocked',
      attemptCount: job.attemptCount,
      terminal: true,
    };
  }

  // -------------------------------------------------------------------------
  // 4. Verificar lead disponível (customer pode não ter lead ainda — edge case)
  // -------------------------------------------------------------------------
  if (ctx.lead === null) {
    await database
      .update(collectionJobs)
      .set({
        status: 'failed',
        attemptCount: job.attemptCount + 1,
        lastError: 'Lead do customer não encontrado — não é possível enviar template',
        updatedAt: new Date(),
      })
      .where(eq(collectionJobs.id, job.id));

    logger.warn(
      { event: 'collection_sender.job_lead_missing', job_id: job.id },
      `job ${job.id}: lead do customer não encontrado — marcado como failed`,
    );

    return {
      jobId: job.id,
      paymentDueId: job.paymentDueId,
      templateKey: ctx.template.name,
      outcome: 'failed',
      error: 'lead_missing',
      attemptCount: job.attemptCount + 1,
      terminal: true,
    };
  }

  // -------------------------------------------------------------------------
  // 5. Verificar lead ativo (soft-delete)
  // -------------------------------------------------------------------------
  if (ctx.lead.deletedAt !== null) {
    await database
      .update(collectionJobs)
      .set({
        status: 'cancelled',
        lastError: 'Lead removido (soft-delete)',
        updatedAt: new Date(),
      })
      .where(eq(collectionJobs.id, job.id));

    logger.info(
      { event: 'collection_sender.job_skipped_deleted_lead', job_id: job.id },
      `job ${job.id}: lead deletado — job cancelado`,
    );

    return {
      jobId: job.id,
      paymentDueId: job.paymentDueId,
      templateKey: ctx.template.name,
      outcome: 'skipped',
      attemptCount: job.attemptCount,
      terminal: true,
    };
  }

  // -------------------------------------------------------------------------
  // 6. Validar template aprovado
  // -------------------------------------------------------------------------
  if (ctx.template.status !== 'approved') {
    const newAttemptCount = job.attemptCount + 1;
    const errorMsg = `Template ${ctx.template.name} não está aprovado (status: ${ctx.template.status})`;

    await database
      .update(collectionJobs)
      .set({
        status: 'failed',
        attemptCount: newAttemptCount,
        lastError: errorMsg,
        updatedAt: new Date(),
      })
      .where(eq(collectionJobs.id, job.id));

    return {
      jobId: job.id,
      paymentDueId: job.paymentDueId,
      templateKey: ctx.template.name,
      outcome: 'failed',
      error: errorMsg,
      attemptCount: newAttemptCount,
      terminal: true,
    };
  }

  // -------------------------------------------------------------------------
  // 7. Lock otimista: marcar job como 'triggered'
  // UPDATE WHERE status='scheduled' falha silenciosamente se já processado.
  // -------------------------------------------------------------------------
  const lockResult = await database
    .update(collectionJobs)
    .set({ status: 'triggered', updatedAt: new Date() })
    .where(and(eq(collectionJobs.id, job.id), eq(collectionJobs.status, 'scheduled')))
    .returning({ id: collectionJobs.id });

  if (lockResult.length === 0) {
    logger.debug(
      { event: 'collection_sender.job_lock_missed', job_id: job.id },
      `job ${job.id}: lock não obtido — processado por outra instância`,
    );

    return {
      jobId: job.id,
      paymentDueId: job.paymentDueId,
      templateKey: ctx.template.name,
      outcome: 'skipped',
      attemptCount: job.attemptCount,
      terminal: false,
    };
  }

  // -------------------------------------------------------------------------
  // 8. Renderizar variáveis e montar payload
  // -------------------------------------------------------------------------
  const sendParams = buildCollectionSendParams(ctx);
  const newAttemptCount = job.attemptCount + 1;

  // -------------------------------------------------------------------------
  // 9. Dry-run: logar sem chamar API
  // LGPD: não logar `to` (phoneE164) — apenas template_name.
  // -------------------------------------------------------------------------
  if (dryRun || metaClient === null) {
    logger.info(
      {
        event: 'collection_sender.dry_run',
        job_id: job.id,
        // LGPD: payment_due_id é ID opaco
        payment_due_id: job.paymentDueId,
        template_name: sendParams.templateName,
        language: sendParams.language,
        component_count: sendParams.components.length,
        dry_run: true,
      },
      `dry-run: job ${job.id} — template ${sendParams.templateName} composto mas não enviado`,
    );

    // Reverter para scheduled com cooldown para evitar log spam.
    await database
      .update(collectionJobs)
      .set({
        status: 'scheduled',
        scheduledAt: new Date(Date.now() + DEFAULT_TICK_MS),
        updatedAt: new Date(),
      })
      .where(eq(collectionJobs.id, job.id));

    return {
      jobId: job.id,
      paymentDueId: job.paymentDueId,
      templateKey: ctx.template.name,
      outcome: 'dry_run',
      attemptCount: job.attemptCount,
      terminal: false,
    };
  }

  // -------------------------------------------------------------------------
  // 10. Envio real via Meta WhatsApp Cloud API
  // -------------------------------------------------------------------------
  let wamid: string;
  try {
    const result = await metaClient.sendTemplate(sendParams);
    wamid = result.wamid;
  } catch (err: unknown) {
    const errorMsg =
      err instanceof ExternalServiceError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Erro desconhecido na Meta API';

    const isTerminal = newAttemptCount >= ctx.rule.maxAttempts;
    const nextScheduledAt = isTerminal
      ? null
      : new Date(Date.now() + calcCollectionJobBackoff(newAttemptCount));

    await database.transaction(async (tx) => {
      // Justificativa dos casts: Drizzle não exporta NodePgTransaction como tipo público.
      // DrizzleTx e AuditTx são interfaces estruturais compatíveis com a transação.
      const txForEmit = tx as unknown as DrizzleTx;
      const txForAudit = tx as unknown as AuditTx;

      await tx
        .update(collectionJobs)
        .set({
          status: isTerminal ? 'failed' : 'scheduled',
          attemptCount: newAttemptCount,
          lastError: errorMsg.slice(0, 1000),
          ...(nextScheduledAt !== null ? { scheduledAt: nextScheduledAt } : {}),
          updatedAt: new Date(),
        })
        .where(eq(collectionJobs.id, job.id));

      const failedData: CollectionFailedData = {
        collection_job_id: job.id,
        payment_due_id: job.paymentDueId,
        rule_id: job.ruleId,
        last_error: errorMsg.slice(0, 500),
        attempt_count: newAttemptCount,
        terminal: isTerminal,
      };

      await emit(txForEmit, {
        eventName: 'billing.collection_failed',
        aggregateType: 'collection_job',
        aggregateId: job.id,
        organizationId: job.organizationId,
        actor: { kind: 'worker', id: null, ip: null },
        idempotencyKey: `billing.collection_failed:${job.id}:${String(newAttemptCount)}`,
        data: failedData,
      });

      await auditLog(txForAudit, {
        organizationId: job.organizationId,
        actor: null,
        action: 'billing.collection_send_failed',
        resource: { type: 'collection_job', id: job.id },
        after: {
          job_id: job.id,
          // LGPD: apenas IDs opacos
          payment_due_id: job.paymentDueId,
          template_name: ctx.template.name,
          attempt_count: newAttemptCount,
          terminal: isTerminal,
          error_truncated: errorMsg.slice(0, 200),
        },
      });
    });

    logger.error(
      {
        event: 'collection_sender.job_failed',
        job_id: job.id,
        // LGPD: payment_due_id é ID opaco
        payment_due_id: job.paymentDueId,
        template_name: ctx.template.name,
        attempt_count: newAttemptCount,
        terminal: isTerminal,
        err: {
          message: err instanceof Error ? err.message : String(err),
          code: err instanceof ExternalServiceError ? err.code : undefined,
          upstreamStatus: (err as { details?: { upstreamStatus?: number } } | null)?.details
            ?.upstreamStatus,
          meta_code: (err as { details?: { meta_error_code?: number } } | null)?.details
            ?.meta_error_code,
        },
      },
      `job ${job.id}: falha no envio (tentativa ${String(newAttemptCount)}/${String(ctx.rule.maxAttempts)})`,
    );

    return {
      jobId: job.id,
      paymentDueId: job.paymentDueId,
      templateKey: ctx.template.name,
      outcome: 'failed',
      error: errorMsg,
      attemptCount: newAttemptCount,
      terminal: isTerminal,
    };
  }

  // -------------------------------------------------------------------------
  // 11. Sucesso — atualizar job + outbox + auditLog em transação atômica
  // -------------------------------------------------------------------------
  await database.transaction(async (tx) => {
    // Justificativa dos casts: ver comentário acima.
    const txForEmit = tx as unknown as DrizzleTx;
    const txForAudit = tx as unknown as AuditTx;

    await tx
      .update(collectionJobs)
      .set({
        status: 'sent',
        attemptCount: newAttemptCount,
        sentMessageId: wamid,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(collectionJobs.id, job.id));

    const sentData: CollectionSentData = {
      collection_job_id: job.id,
      payment_due_id: job.paymentDueId,
      rule_id: job.ruleId,
      template_key: ctx.template.name,
      wamid,
      attempt_count: newAttemptCount,
    };

    await emit(txForEmit, {
      eventName: 'billing.collection_sent',
      aggregateType: 'collection_job',
      aggregateId: job.id,
      organizationId: job.organizationId,
      actor: { kind: 'worker', id: null, ip: null },
      // Idempotência: wamid é único por envio.
      idempotencyKey: `billing.collection_sent:${job.id}:${wamid}`,
      data: sentData,
    });

    await auditLog(txForAudit, {
      organizationId: job.organizationId,
      actor: null,
      action: 'billing.collection_sent',
      resource: { type: 'collection_job', id: job.id },
      after: {
        job_id: job.id,
        // LGPD: apenas IDs opacos + wamid (não é PII)
        payment_due_id: job.paymentDueId,
        template_name: ctx.template.name,
        wamid,
        attempt_count: newAttemptCount,
      },
    });
  });

  logger.info(
    {
      event: 'collection_sender.job_sent',
      job_id: job.id,
      payment_due_id: job.paymentDueId,
      template_name: ctx.template.name,
      wamid,
      attempt_count: newAttemptCount,
    },
    `job ${job.id}: template ${ctx.template.name} enviado (wamid: ${wamid})`,
  );

  return {
    jobId: job.id,
    paymentDueId: job.paymentDueId,
    templateKey: ctx.template.name,
    outcome: 'sent',
    wamid,
    attemptCount: newAttemptCount,
    terminal: false,
  };
}

// ---------------------------------------------------------------------------
// Tick principal
// ---------------------------------------------------------------------------

/**
 * Executa um tick do collection-sender:
 *   1. Verifica flag billing.enabled → sai cedo se disabled.
 *   2. Verifica flag billing.sender.enabled → define dryRun.
 *   3. Busca lote de jobs scheduled + scheduled_at <= now().
 *   4. Para cada job: chama processCollectionJob().
 *   5. Loga resultado estruturado por tick.
 *
 * @param database    Instância Drizzle (injetável para testes).
 * @param metaClient  Cliente Meta (injetável para testes).
 * @param logger      Logger do worker.
 */
export async function runCollectionSenderTick(
  database: Database,
  metaClient: MetaWhatsAppClient | null,
  logger: SenderLogger,
): Promise<CollectionJobTickResult[]> {
  // -------------------------------------------------------------------------
  // Camada 1: billing.enabled — gate total.
  // -------------------------------------------------------------------------
  const { enabled: billingEnabled } = await isFlagEnabled(database, 'billing.enabled');
  if (!billingEnabled) {
    logger.debug(
      { event: 'collection_sender.skipped', flag: 'billing.enabled' },
      'billing.enabled=disabled — tick ignorado',
    );
    return [];
  }

  // -------------------------------------------------------------------------
  // Camada 2: billing.sender.enabled — gate de envio real (dry-run).
  // -------------------------------------------------------------------------
  const { enabled: senderEnabled } = await isFlagEnabled(database, 'billing.sender.enabled');
  const dryRun = !senderEnabled;

  if (dryRun) {
    logger.info(
      { event: 'collection_sender.dry_run_mode', flag: 'billing.sender.enabled' },
      'billing.sender.enabled=disabled — tick em dry-run (sem chamadas à Meta API)',
    );
  }

  // -------------------------------------------------------------------------
  // Buscar lote de jobs agendados prontos para envio
  // -------------------------------------------------------------------------
  const now = new Date();
  const batch = await database
    .select()
    .from(collectionJobs)
    .where(and(eq(collectionJobs.status, 'scheduled'), lte(collectionJobs.scheduledAt, now)))
    .limit(BATCH_SIZE);

  if (batch.length === 0) {
    logger.debug(
      { event: 'collection_sender.no_jobs' },
      'nenhum collection_job agendado para este tick',
    );
    return [];
  }

  logger.info(
    { event: 'collection_sender.batch_loaded', batch_size: batch.length, dry_run: dryRun },
    `lote de ${String(batch.length)} jobs de cobrança carregado`,
  );

  // -------------------------------------------------------------------------
  // Processar cada job do lote
  // -------------------------------------------------------------------------
  const results: CollectionJobTickResult[] = [];

  for (const job of batch) {
    try {
      const result = await processCollectionJob(
        database,
        dryRun ? null : metaClient,
        job,
        dryRun,
        logger,
      );
      results.push(result);
    } catch (err: unknown) {
      logger.error(
        {
          event: 'collection_sender.job_unexpected_error',
          job_id: job.id,
          payment_due_id: job.paymentDueId,
          err: {
            message: err instanceof Error ? err.message : String(err),
            code: err instanceof ExternalServiceError ? err.code : undefined,
            upstreamStatus: (err as { details?: { upstreamStatus?: number } } | null)?.details
              ?.upstreamStatus,
            meta_code: (err as { details?: { meta_error_code?: number } } | null)?.details
              ?.meta_error_code,
          },
        },
        `erro inesperado ao processar collection_job ${job.id}`,
      );

      try {
        await database
          .update(collectionJobs)
          .set({
            status: 'failed',
            attemptCount: job.attemptCount + 1,
            lastError: err instanceof Error ? err.message.slice(0, 1000) : 'Erro inesperado',
            updatedAt: new Date(),
          })
          .where(eq(collectionJobs.id, job.id));
      } catch {
        // Ignorar falha no fallback
      }

      results.push({
        jobId: job.id,
        paymentDueId: job.paymentDueId,
        templateKey: 'unknown',
        outcome: 'failed',
        error: 'unexpected_error',
        attemptCount: job.attemptCount + 1,
        terminal: true,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Log de resumo do tick
  // -------------------------------------------------------------------------
  const sent = results.filter((r) => r.outcome === 'sent').length;
  const dryRunCount = results.filter((r) => r.outcome === 'dry_run').length;
  const skipped = results.filter((r) => r.outcome === 'skipped').length;
  const failed = results.filter((r) => r.outcome === 'failed').length;
  const consentBlocked = results.filter((r) => r.outcome === 'consent_blocked').length;
  const paidBeforeSend = results.filter((r) => r.outcome === 'paid_before_send').length;

  logger.info(
    {
      event: 'collection_sender.tick_complete',
      total: results.length,
      sent,
      dry_run: dryRunCount,
      skipped,
      failed,
      consent_blocked: consentBlocked,
      paid_before_send: paidBeforeSend,
      is_dry_run: dryRun,
    },
    `tick concluído: ${String(results.length)} jobs — ${String(sent)} enviados, ${String(paidBeforeSend)} pagos, ${String(failed)} falhas`,
  );

  return results;
}

// ---------------------------------------------------------------------------
// Main — loop periódico
// ---------------------------------------------------------------------------

const runtime = createWorkerRuntime(WORKER_NAME);

export { runtime as _workerRuntime };

async function main(): Promise<void> {
  const tickMs = env.FOLLOWUP_SENDER_TICK_MS ?? DEFAULT_TICK_MS;

  let metaClient: MetaWhatsAppClient | null = null;
  try {
    metaClient = new MetaWhatsAppClient();
    runtime.logger.info(
      { event: 'collection_sender.meta_client_ready' },
      'cliente Meta WhatsApp inicializado (collection-sender)',
    );
  } catch (err: unknown) {
    runtime.logger.warn(
      {
        event: 'collection_sender.meta_client_unavailable',
        err: { message: err instanceof Error ? err.message : String(err) },
      },
      'META_WHATSAPP_ACCESS_TOKEN ou META_WHATSAPP_PHONE_NUMBER_ID ausente — worker em modo degradado (dry-run forçado)',
    );
  }

  runtime.logger.info({ tick_ms: tickMs }, 'collection-sender iniciado');

  while (!runtime.isShuttingDown()) {
    try {
      await runCollectionSenderTick(defaultDb, metaClient, runtime.logger);
    } catch (err: unknown) {
      runtime.logger.error(
        {
          err: {
            message: err instanceof Error ? err.message : String(err),
            code: err instanceof ExternalServiceError ? err.code : undefined,
            upstreamStatus: (err as { details?: { upstreamStatus?: number } } | null)?.details
              ?.upstreamStatus,
          },
        },
        'collection-sender: erro inesperado no tick',
      );
    }
    await sleep(tickMs);
  }
}

if (process.argv[1] !== undefined && process.argv[1].includes('collection-sender')) {
  main().catch((err: unknown) => {
    runtime.logger.fatal(
      { err: { message: err instanceof Error ? err.message : String(err) } },
      'collection-sender: falha fatal',
    );
    process.exit(1);
  });
}
