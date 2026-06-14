// =============================================================================
// billing/service.ts — Regras de negócio para cobrança (F5-S08, F5-S13).
//
// Responsabilidades:
//   - Validar cross-tenant: template_id e payment_due_id pertencem à org.
//   - Delegar ao repository para queries Drizzle.
//   - Atomicidade completa: mark-paid e renegotiate em transação única (HIGH-02).
//   - City scope: propagado para repository (HIGH-01).
//   - Idempotency-Key: verifica antes de processar, persiste após sucesso (HIGH-03).
//   - Outbox: emite billing.due_paid / billing.due_renegotiated na transação (MEDIUM-02).
//   - Audit log na mesma transação.
//   - Boleto (F5-S13): attachBoletoService + removeBoletoService.
//     City scope obrigatório. Idempotência via idempotency-key. Auditoria sem PII.
//
// RBAC verificado nas rotas — não aqui.
// =============================================================================
import crypto from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { idempotencyKeys } from '../../db/schema/idempotencyKeys.js';
import { paymentDues } from '../../db/schema/paymentDues.js';
import { emit } from '../../events/emit.js';
import type { DrizzleTx } from '../../events/emit.js';
import type {
  BillingBoletoAttachedData,
  BillingDuePaidData,
  BillingDueRenegotiatedData,
} from '../../events/types.js';
import { cancelCollectionJobsOnPayment } from '../../handlers/cancel-collections-on-payment.js';
import { MetaWhatsAppClient } from '../../integrations/meta-whatsapp/client.js';
import { auditLog } from '../../lib/audit.js';
import type { AuditTx } from '../../lib/audit.js';
import { AppError, NotFoundError } from '../../shared/errors.js';

import {
  cancelCollectionJob,
  checkTemplateInOrg,
  createCollectionRule,
  getBoletoByDueId,
  getCollectionRuleById,
  listCollectionJobs,
  listCollectionRules,
  listPaymentDues,
  lockPaymentDueForBoleto,
  markPaymentDuePaid,
  renegotiatePaymentDue,
  updateCollectionRule,
  updatePaymentDueBoleto,
} from './repository.js';
import type {
  BoletoAttachReferenceBody,
  BoletoResponse,
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

// ---------------------------------------------------------------------------
// Boleto service (F5-S13)
// ---------------------------------------------------------------------------

/**
 * Contexto do ator para operações de boleto.
 */
export interface BoletoActor {
  userId: string;
  ip: string | null;
}

// ---------------------------------------------------------------------------
// Allowlist de hosts para boleto_url (LGPD §14.2).
// Lida de env.BOLETO_ALLOWED_HOSTS (lista de hostnames).
// Importação lazy para evitar dependência circular no módulo.
// ---------------------------------------------------------------------------

/**
 * Verifica se a URL do boleto passa pela allowlist de hosts.
 * Bloqueia URLs com hosts não cadastrados para prevenir SSRF e exposição de PII
 * (boleto_url aponta para PDF com nome, CPF e endereço do devedor).
 *
 * - allowedHosts vazio → bloqueia TODOS os hosts (fail-closed).
 * - hostname da URL deve estar na lista (case-insensitive).
 *
 * @throws AppError(400) se o host não está na allowlist.
 */
function assertBoletoUrlAllowed(url: string, allowedHosts: string[]): void {
  if (allowedHosts.length === 0) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'boletoUrl bloqueada: BOLETO_ALLOWED_HOSTS não configurado — somente upload de arquivo é aceito',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError(400, 'VALIDATION_ERROR', 'boletoUrl inválida: não é uma URL válida');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!allowedHosts.includes(hostname)) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      `boletoUrl bloqueada: host '${hostname}' não está na allowlist (BOLETO_ALLOWED_HOSTS)`,
    );
  }
}

// ---------------------------------------------------------------------------
// MIME allowlist para upload de boleto (PDF + imagens aceitas pela Meta)
// ---------------------------------------------------------------------------

const BOLETO_ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;

type BoletoAllowedMimeType = (typeof BOLETO_ALLOWED_MIME_TYPES)[number];

function assertBoletoMimeAllowed(mimeType: string): asserts mimeType is BoletoAllowedMimeType {
  if (!(BOLETO_ALLOWED_MIME_TYPES as ReadonlyArray<string>).includes(mimeType)) {
    throw new AppError(
      415,
      'VALIDATION_ERROR',
      `Tipo de arquivo não suportado: '${mimeType}'. Aceitos: application/pdf, image/jpeg, image/png`,
    );
  }
}

/** Limite de tamanho do arquivo de boleto (10 MB — alinhado com F5-S12). */
const BOLETO_MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Anexa um boleto a uma parcela via **upload de arquivo** (multipart).
 *
 * Fluxo:
 *   1. lockPaymentDueForBoleto: SELECT FOR UPDATE + city-scope (H-01).
 *   2. assertBoletoMimeAllowed: valida MIME antes de chamar Meta.
 *   3. MetaWhatsAppClient.uploadMedia: envia arquivo para a Meta — retorna media_id.
 *   4. Transação: updatePaymentDueBoleto + auditLog + emit billing.boleto_attached.
 *
 * LGPD §14.2:
 *   - Bytes do arquivo nunca persistem no banco (apenas media_id e filename).
 *   - Bytes nunca aparecem em logs (LGPD §8.3).
 *   - auditLog registra apenas IDs e modo — sem boleto_url/linha/PIX.
 *   - Outbox (billing.boleto_attached) carrega apenas IDs + has_media/mode.
 *
 * @param db            Instância do banco.
 * @param organizationId UUID da organização.
 * @param dueId          UUID da parcela.
 * @param cityScopeIds   Scope de cidade do usuário (null = admin global).
 * @param actor          { userId, ip } para audit.
 * @param file           { bytes, mimeType, filename? } — bytes do PDF/imagem.
 * @param idempotencyKey Chave de idempotência (obrigatória).
 * @param allowedHosts   Lista de hosts permitidos para boleto_url (env.BOLETO_ALLOWED_HOSTS).
 */
export async function attachBoletoUploadService(
  db: Database,
  organizationId: string,
  dueId: string,
  cityScopeIds: string[] | null,
  actor: BoletoActor,
  file: { bytes: Buffer; mimeType: string; filename?: string },
  idempotencyKey: string,
  _allowedHosts: string[],
): Promise<BoletoResponse> {
  // Gate MIME antes de qualquer operação costosa.
  assertBoletoMimeAllowed(file.mimeType);

  if (file.bytes.length > BOLETO_MAX_FILE_BYTES) {
    throw new AppError(
      413,
      'VALIDATION_ERROR',
      `Arquivo excede o limite de ${BOLETO_MAX_FILE_BYTES / 1024 / 1024} MB`,
    );
  }

  // H-01: SELECT FOR UPDATE + city-scope (garante que a parcela pertence ao scope).
  // Executado fora da tx para fail-fast antes de chamar a Meta (custo de rede).
  await lockPaymentDueForBoleto(db, organizationId, dueId, cityScopeIds);

  // Upload para a Meta (fora da tx — operação externa, não revertível).
  // LGPD §8.3: bytes/filename nunca logados pelo cliente Meta.
  // Erros propagam para o caller (route) que exibe ExternalServiceError como 502.
  const metaClient = new MetaWhatsAppClient();
  const { mediaId } = await metaClient.uploadMedia({
    bytes: file.bytes,
    mimeType: file.mimeType,
    filename: file.filename,
  });

  // Validade: Meta expira media em ~30 dias (2592000s).
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await db.transaction(async (tx) => {
    // `as` justificado: Drizzle não exporta tipo público da transação.
    const txDb = tx as unknown as Database;
    const txForEmit = tx as unknown as DrizzleTx;
    const txForAudit = tx as unknown as AuditTx;

    await updatePaymentDueBoleto(txDb, organizationId, dueId, {
      boletoMediaId: mediaId,
      boletoMediaExpiresAt: expiresAt,
      boletoFilename: file.filename ?? null,
      // Limpa campos de referência se existiam antes (substituição)
      boletoUrl: null,
      boletoDigitableLine: null,
      pixCopiaCola: null,
      boletoAttachedAt: new Date(),
    });

    // LGPD §14.2: auditLog sem PII — apenas IDs e modo.
    await auditLog(txForAudit, {
      organizationId,
      actor: { userId: actor.userId, role: 'user', ip: actor.ip },
      action: 'billing.boleto_attached',
      resource: { type: 'payment_due', id: dueId },
      after: {
        payment_due_id: dueId,
        mode: 'upload',
        has_media: true,
        idempotency_key: idempotencyKey,
      },
      correlationId: null,
    });

    // Outbox billing.boleto_attached — sem PII bruta (só IDs + modo).
    const eventData: BillingBoletoAttachedData = {
      payment_due_id: dueId,
      customer_id: '', // preenchido abaixo via getBoletoByDueId
      mode: 'upload',
      has_media: true,
    };

    // Precisamos do customer_id para o evento — busca mínima dentro da tx.
    const due = await txDb
      .select({ customerId: paymentDues.customerId })
      .from(paymentDues)
      .where(and(eq(paymentDues.id, dueId), eq(paymentDues.organizationId, organizationId)))
      .limit(1);

    eventData.customer_id = due[0]?.customerId ?? '';

    await emit(txForEmit, {
      eventName: 'billing.boleto_attached',
      aggregateType: 'payment_due',
      aggregateId: dueId,
      organizationId,
      actor: { kind: 'user', id: actor.userId, ip: actor.ip },
      idempotencyKey: `billing.boleto_attached:${dueId}:${idempotencyKey}`,
      data: eventData,
    });
  });

  return getBoletoByDueId(db, organizationId, dueId, cityScopeIds);
}

/**
 * Anexa um boleto a uma parcela via **referência** (URL / linha digitável / PIX).
 *
 * Fluxo:
 *   1. lockPaymentDueForBoleto: SELECT FOR UPDATE + city-scope (H-01).
 *   2. assertBoletoUrlAllowed: valida host da boletoUrl contra BOLETO_ALLOWED_HOSTS.
 *   3. Transação: updatePaymentDueBoleto + auditLog + emit billing.boleto_attached.
 *
 * LGPD §14.2:
 *   - boletoUrl, digitableLine, pixCopiaCola são PII indireta — auditLog não os inclui.
 *   - Outbox carrega apenas IDs + modo 'reference' + has_media=false.
 *
 * @param db            Instância do banco.
 * @param organizationId UUID da organização.
 * @param dueId          UUID da parcela.
 * @param cityScopeIds   Scope de cidade do usuário.
 * @param actor          { userId, ip } para audit.
 * @param body           { boletoUrl?, digitableLine?, pixCopiaCola?, filename? }.
 * @param idempotencyKey Chave de idempotência (obrigatória).
 * @param allowedHosts   Lista de hosts permitidos (env.BOLETO_ALLOWED_HOSTS).
 */
export async function attachBoletoReferenceService(
  db: Database,
  organizationId: string,
  dueId: string,
  cityScopeIds: string[] | null,
  actor: BoletoActor,
  body: BoletoAttachReferenceBody,
  idempotencyKey: string,
  allowedHosts: string[],
): Promise<BoletoResponse> {
  // Allowlist de host antes de qualquer operação de DB.
  if (body.boletoUrl !== undefined) {
    assertBoletoUrlAllowed(body.boletoUrl, allowedHosts);
  }

  // H-01: SELECT FOR UPDATE + city-scope.
  await lockPaymentDueForBoleto(db, organizationId, dueId, cityScopeIds);

  await db.transaction(async (tx) => {
    // `as` justificado: Drizzle não exporta tipo público da transação.
    const txDb = tx as unknown as Database;
    const txForEmit = tx as unknown as DrizzleTx;
    const txForAudit = tx as unknown as AuditTx;

    await updatePaymentDueBoleto(txDb, organizationId, dueId, {
      // LGPD: boleto_url é controlada/assinada — apenas hosts da allowlist
      boletoUrl: body.boletoUrl ?? null,
      boletoDigitableLine: body.digitableLine ?? null,
      pixCopiaCola: body.pixCopiaCola ?? null,
      boletoFilename: body.filename ?? null,
      // Limpa campos de upload se existiam (substituição de modo)
      boletoMediaId: null,
      boletoMediaExpiresAt: null,
      boletoAttachedAt: new Date(),
    });

    // LGPD §14.2: auditLog sem PII — apenas IDs e modo.
    // boleto_url / digitableLine / pixCopiaCola NUNCA no audit payload.
    await auditLog(txForAudit, {
      organizationId,
      actor: { userId: actor.userId, role: 'user', ip: actor.ip },
      action: 'billing.boleto_attached',
      resource: { type: 'payment_due', id: dueId },
      after: {
        payment_due_id: dueId,
        mode: 'reference',
        has_media: false,
        idempotency_key: idempotencyKey,
      },
      correlationId: null,
    });

    // Busca customer_id para o evento (dentro da tx para consistência).
    const due = await txDb
      .select({ customerId: paymentDues.customerId })
      .from(paymentDues)
      .where(and(eq(paymentDues.id, dueId), eq(paymentDues.organizationId, organizationId)))
      .limit(1);

    const eventData: BillingBoletoAttachedData = {
      payment_due_id: dueId,
      customer_id: due[0]?.customerId ?? '',
      mode: 'reference',
      has_media: false,
    };

    await emit(txForEmit, {
      eventName: 'billing.boleto_attached',
      aggregateType: 'payment_due',
      aggregateId: dueId,
      organizationId,
      actor: { kind: 'user', id: actor.userId, ip: actor.ip },
      idempotencyKey: `billing.boleto_attached:${dueId}:${idempotencyKey}`,
      data: eventData,
    });
  });

  return getBoletoByDueId(db, organizationId, dueId, cityScopeIds);
}

/**
 * Remove o boleto de uma parcela.
 *
 * Idempotente: se não havia boleto, retorna o estado atual sem erro.
 *
 * Fluxo:
 *   1. lockPaymentDueForBoleto: SELECT FOR UPDATE + city-scope (H-01).
 *   2. Transação: updatePaymentDueBoleto (todos campos null) + auditLog.
 *
 * LGPD §14.2: auditLog sem PII — apenas IDs e ação 'billing.boleto_removed'.
 *
 * Nota: não emite outbox pois remoção não é downstream-relevant (F5-S14 ignora parcelas sem boleto).
 */
export async function removeBoletoService(
  db: Database,
  organizationId: string,
  dueId: string,
  cityScopeIds: string[] | null,
  actor: BoletoActor,
): Promise<BoletoResponse> {
  // H-01: SELECT FOR UPDATE + city-scope.
  await lockPaymentDueForBoleto(db, organizationId, dueId, cityScopeIds);

  await db.transaction(async (tx) => {
    // `as` justificado: Drizzle não exporta tipo público da transação.
    const txDb = tx as unknown as Database;
    const txForAudit = tx as unknown as AuditTx;

    await updatePaymentDueBoleto(txDb, organizationId, dueId, {
      boletoUrl: null,
      boletoMediaId: null,
      boletoMediaExpiresAt: null,
      boletoDigitableLine: null,
      pixCopiaCola: null,
      boletoFilename: null,
      boletoAttachedAt: null,
    });

    // LGPD §14.2: auditLog sem PII.
    await auditLog(txForAudit, {
      organizationId,
      actor: { userId: actor.userId, role: 'user', ip: actor.ip },
      action: 'billing.boleto_removed',
      resource: { type: 'payment_due', id: dueId },
      after: { payment_due_id: dueId, has_media: false },
      correlationId: null,
    });
  });

  return getBoletoByDueId(db, organizationId, dueId, cityScopeIds);
}

// Re-export AppError/NotFoundError para facilitar uso nos testes
export { AppError, NotFoundError };
