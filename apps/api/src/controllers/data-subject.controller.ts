// =============================================================================
// controllers/data-subject.controller.ts — LGPD direitos do titular (F1-S25).
//
// Endpoints (rota base /api/v1/data-subject):
//   POST /confirm              — confirmação de tratamento (Art. 19 §1)
//   POST /access-request       — acesso a dados (agenda export job)
//   POST /portability-request  — portabilidade (alias de access com format=portable)
//   POST /consent/revoke       — revogação de consentimento (Art. 8 §5)
//   POST /anonymize-request    — anonimização (agenda, estado pending_dpo_review)
//   POST /delete-request       — eliminação física (apenas se base legal = consentimento revogado)
//   POST /review-decision/:analysis_id — revisão de decisão automatizada (Art. 20)
//
// Segurança:
//   - Desafio do titular: cpf_hash + OTP (TTL 10min, single-use) + matching de dados.
//   - Rate-limit: 3/h por CPF (configurado nas routes via @fastify/rate-limit key fn).
//   - Idempotência por request_id (unique constraint em data_subject_requests).
//   - Zod em todas as bordas (via fastify-type-provider-zod).
//   - auditLog() em toda solicitação e ação.
//   - Eventos via outbox (sem PII no payload).
//
// LGPD §14.2:
//   - Finalidade: atender direitos do titular (Art. 18 LGPD).
//   - Base legal: obrigação legal (Art. 7 II LGPD).
//   - PII mascarada em logs (pino.redact).
//   - Outbox sem PII bruta.
//   - RBAC: nenhum — o titular se autentica via desafio próprio.
//   - Rate limit: 3/h por CPF.
//   - Audit log: toda solicitação e ação.
// =============================================================================
import { createHash, timingSafeEqual } from 'node:crypto';
import { randomInt } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import { db } from '../db/client.js';
import { customers } from '../db/schema/customers.js';
import { dataSubjectRequests } from '../db/schema/data_subject.js';
import { emit } from '../events/emit.js';
import { auditLog } from '../lib/audit.js';
import { ConflictError, UnauthorizedError } from '../shared/errors.js';

// ---------------------------------------------------------------------------
// In-memory OTP store (MVP — produção deve usar Redis ou tabela otp_challenges)
// TODO: migrar para tabela otp_challenges em F2 para suportar multi-instância.
// ---------------------------------------------------------------------------

interface OtpEntry {
  otp: string;
  expiresAt: number;
  used: boolean;
  cpfHash: string;
}

const otpStore = new Map<string, OtpEntry>();

/** TTL do OTP em ms (10 minutos). */
const OTP_TTL_MS = 10 * 60 * 1000;

/**
 * Gera OTP de 6 dígitos e armazena no store em memória.
 * Em produção: substituir por envio via WhatsApp/email + tabela persistente.
 */
export function generateOtp(cpfHash: string): string {
  const otp = String(randomInt(100000, 999999));
  otpStore.set(cpfHash, {
    otp,
    expiresAt: Date.now() + OTP_TTL_MS,
    used: false,
    cpfHash,
  });
  return otp;
}

/**
 * Verifica OTP do titular.
 * Single-use: marca como used após verificação bem-sucedida.
 * TTL: rejeita se expirado.
 * Timing-safe: usa timingSafeEqual para resistência a timing attacks.
 *
 * @returns true se válido e não usado.
 */
export function verifyOtp(cpfHash: string, otp: string): boolean {
  const entry = otpStore.get(cpfHash);
  if (!entry) return false;
  if (entry.used) return false;
  if (Date.now() > entry.expiresAt) {
    otpStore.delete(cpfHash);
    return false;
  }
  const expected = Buffer.from(entry.otp, 'utf8');
  const provided = Buffer.from(otp.slice(0, 6).padEnd(6, ' '), 'utf8');
  if (expected.length !== provided.length) return false;
  if (!timingSafeEqual(expected, provided)) return false;
  // Mark as used (single-use)
  entry.used = true;
  return true;
}

// ---------------------------------------------------------------------------
// verifyDataSubjectChallenge
// ---------------------------------------------------------------------------

/**
 * Verifica o desafio de identidade do titular:
 *   1. Busca customer pelo cpf_hash (document_hash).
 *   2. Verifica OTP (single-use, TTL 10min).
 *   3. (Opcional) Matching de dados conhecidos (nome parcial ou data de nascimento).
 *
 * @throws UnauthorizedError se o desafio falhar.
 * @returns { customerId, organizationId, channel } se bem-sucedido.
 */
export async function verifyDataSubjectChallenge(params: {
  cpfHash: string;
  otp: string;
  organizationId: string;
}): Promise<{ customerId: string; organizationId: string; channel: 'whatsapp' | 'email' }> {
  // Verificar OTP primeiro (timing-safe)
  const otpValid = verifyOtp(params.cpfHash, params.otp);
  if (!otpValid) {
    throw new UnauthorizedError('OTP inválido, expirado ou já utilizado');
  }

  // Buscar customer pelo document_hash
  const customerRows = await db
    .select()
    .from(customers)
    .where(
      and(
        eq(customers.organizationId, params.organizationId),
        eq(customers.documentHash, params.cpfHash),
      ),
    );

  const customer = customerRows[0];
  if (!customer) {
    // Não revelar se o titular existe ou não (privacidade por design)
    throw new UnauthorizedError('Verificação de identidade falhou');
  }

  // Determinar canal de entrega (WhatsApp se disponível, email como fallback)
  // TODO: checar opt-in de WhatsApp no customer/lead quando o módulo estiver disponível.
  // Por ora, usar email como fallback seguro.
  const channel = 'email' as const;

  return {
    customerId: customer.id,
    organizationId: customer.organizationId,
    channel,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function systemActor() {
  return {
    audit: null as null, // sistema (não é usuário interno)
    event: { kind: 'system' as const, id: null, ip: null },
  };
}

// ---------------------------------------------------------------------------
// POST /confirm — confirmação de tratamento (Art. 19 §1)
// ---------------------------------------------------------------------------

export interface ConfirmBody {
  organization_id: string;
  cpf_hash: string;
  otp: string;
  request_id: string;
}

export async function confirmController(
  body: ConfirmBody,
  ip: string | null,
): Promise<{ request_id: string; status: string; message: string }> {
  const { customerId, organizationId, channel } = await verifyDataSubjectChallenge({
    cpfHash: body.cpf_hash,
    otp: body.otp,
    organizationId: body.organization_id,
  });

  // Idempotência: se já existe, retornar o existente
  const existing = await db
    .select()
    .from(dataSubjectRequests)
    .where(eq(dataSubjectRequests.requestId, body.request_id));

  if (existing[0]) {
    return {
      request_id: body.request_id,
      status: existing[0].status,
      message: 'Solicitação já registrada anteriormente.',
    };
  }

  await db.transaction(async (tx) => {
    const req = await tx
      .insert(dataSubjectRequests)
      .values({
        organizationId,
        customerId,
        documentHash: body.cpf_hash,
        requestId: body.request_id,
        type: 'confirmation',
        status: 'fulfilled', // confirmação é instantânea
        channel,
        payloadMeta: { ip_hash: ip ? createHash('sha256').update(ip).digest('hex') : null },
        fulfilledAt: new Date(),
      })
      .returning();

    await auditLog(tx, {
      organizationId,
      actor: null,
      action: 'lgpd.confirmation_requested',
      resource: { type: 'data_subject_request', id: req[0]?.id ?? body.request_id },
      after: { request_id: body.request_id, type: 'confirmation', customer_id: customerId },
      correlationId: null,
    });
  });

  return {
    request_id: body.request_id,
    status: 'fulfilled',
    message: 'Confirmamos que tratamos seus dados pessoais conforme a LGPD.',
  };
}

// ---------------------------------------------------------------------------
// POST /access-request
// ---------------------------------------------------------------------------

export interface AccessRequestBody {
  organization_id: string;
  cpf_hash: string;
  otp: string;
  request_id: string;
}

export async function accessRequestController(
  body: AccessRequestBody,
  ip: string | null,
): Promise<{ request_id: string; status: string; message: string }> {
  const { customerId, organizationId, channel } = await verifyDataSubjectChallenge({
    cpfHash: body.cpf_hash,
    otp: body.otp,
    organizationId: body.organization_id,
  });

  // Idempotência
  const existing = await db
    .select()
    .from(dataSubjectRequests)
    .where(eq(dataSubjectRequests.requestId, body.request_id));
  if (existing[0]) {
    return {
      request_id: body.request_id,
      status: existing[0].status,
      message: 'Solicitação já registrada. O export será entregue no canal verificado.',
    };
  }

  let requestDbId = '';
  await db.transaction(async (tx) => {
    const req = await tx
      .insert(dataSubjectRequests)
      .values({
        organizationId,
        customerId,
        documentHash: body.cpf_hash,
        requestId: body.request_id,
        type: 'access',
        status: 'received',
        channel,
        payloadMeta: { ip_hash: ip ? createHash('sha256').update(ip).digest('hex') : null },
      })
      .returning();

    requestDbId = req[0]?.id ?? '';

    await auditLog(tx, {
      organizationId,
      actor: null,
      action: 'lgpd.access_requested',
      resource: { type: 'data_subject_request', id: requestDbId },
      after: { request_id: body.request_id, type: 'access', customer_id: customerId },
      correlationId: null,
    });

    await emit(tx, {
      eventName: 'data_subject.access_requested',
      aggregateType: 'data_subject_request',
      aggregateId: requestDbId,
      organizationId,
      actor: systemActor().event,
      idempotencyKey: `data_subject.access_requested:${body.request_id}`,
      data: {
        request_id_db: requestDbId,
        request_id: body.request_id,
        customer_id: customerId,
        organization_id: organizationId,
        request_type: 'access',
        channel,
      },
    });
  });

  return {
    request_id: body.request_id,
    status: 'received',
    message:
      'Solicitação de acesso registrada. Você receberá o export em até 15 dias úteis no canal verificado.',
  };
}

// ---------------------------------------------------------------------------
// POST /portability-request (alias de access com format=portable)
// ---------------------------------------------------------------------------

export interface PortabilityRequestBody {
  organization_id: string;
  cpf_hash: string;
  otp: string;
  request_id: string;
}

export async function portabilityRequestController(
  body: PortabilityRequestBody,
  ip: string | null,
): Promise<{ request_id: string; status: string; message: string }> {
  const { customerId, organizationId, channel } = await verifyDataSubjectChallenge({
    cpfHash: body.cpf_hash,
    otp: body.otp,
    organizationId: body.organization_id,
  });

  const existing = await db
    .select()
    .from(dataSubjectRequests)
    .where(eq(dataSubjectRequests.requestId, body.request_id));
  if (existing[0]) {
    return {
      request_id: body.request_id,
      status: existing[0].status,
      message: 'Solicitação já registrada.',
    };
  }

  let requestDbId = '';
  await db.transaction(async (tx) => {
    const req = await tx
      .insert(dataSubjectRequests)
      .values({
        organizationId,
        customerId,
        documentHash: body.cpf_hash,
        requestId: body.request_id,
        type: 'portability',
        status: 'received',
        channel,
        payloadMeta: {
          format: 'portable',
          ip_hash: ip ? createHash('sha256').update(ip).digest('hex') : null,
        },
      })
      .returning();

    requestDbId = req[0]?.id ?? '';

    await auditLog(tx, {
      organizationId,
      actor: null,
      action: 'lgpd.portability_requested',
      resource: { type: 'data_subject_request', id: requestDbId },
      after: { request_id: body.request_id, type: 'portability', customer_id: customerId },
      correlationId: null,
    });

    await emit(tx, {
      eventName: 'data_subject.access_requested',
      aggregateType: 'data_subject_request',
      aggregateId: requestDbId,
      organizationId,
      actor: systemActor().event,
      idempotencyKey: `data_subject.access_requested:${body.request_id}`,
      data: {
        request_id_db: requestDbId,
        request_id: body.request_id,
        customer_id: customerId,
        organization_id: organizationId,
        request_type: 'portability',
        channel,
      },
    });
  });

  return {
    request_id: body.request_id,
    status: 'received',
    message:
      'Solicitação de portabilidade registrada. Você receberá o arquivo em até 15 dias úteis.',
  };
}

// ---------------------------------------------------------------------------
// POST /consent/revoke — revogação de consentimento (idempotente)
// ---------------------------------------------------------------------------

export interface ConsentRevokeBody {
  organization_id: string;
  cpf_hash: string;
  otp: string;
  request_id: string;
}

export async function consentRevokeController(
  body: ConsentRevokeBody,
  ip: string | null,
): Promise<{ request_id: string; status: string; revoked_at: string }> {
  const { customerId, organizationId, channel } = await verifyDataSubjectChallenge({
    cpfHash: body.cpf_hash,
    otp: body.otp,
    organizationId: body.organization_id,
  });

  // Idempotência
  const existing = await db
    .select()
    .from(dataSubjectRequests)
    .where(eq(dataSubjectRequests.requestId, body.request_id));

  if (existing[0]) {
    const customerRow = await db.select().from(customers).where(eq(customers.id, customerId));
    const revokedAt = customerRow[0]?.consentRevokedAt ?? new Date();
    return {
      request_id: body.request_id,
      status: 'fulfilled',
      revoked_at: revokedAt.toISOString(),
    };
  }

  const now = new Date();

  await db.transaction(async (tx) => {
    // Atualizar consent_revoked_at (idempotente — se já estiver preenchido, atualiza para now)
    await tx
      .update(customers)
      .set({ consentRevokedAt: now, updatedAt: now })
      .where(eq(customers.id, customerId));

    await tx.insert(dataSubjectRequests).values({
      organizationId,
      customerId,
      documentHash: body.cpf_hash,
      requestId: body.request_id,
      type: 'consent_revoke',
      status: 'fulfilled',
      channel,
      payloadMeta: { ip_hash: ip ? createHash('sha256').update(ip).digest('hex') : null },
      fulfilledAt: now,
    });

    await auditLog(tx, {
      organizationId,
      actor: null,
      action: 'lgpd.consent_revoked',
      resource: { type: 'customer', id: customerId },
      after: { customer_id: customerId, consent_revoked_at: now.toISOString() },
      correlationId: null,
    });

    await emit(tx, {
      eventName: 'data_subject.consent_revoked',
      aggregateType: 'customer',
      aggregateId: customerId,
      organizationId,
      actor: systemActor().event,
      idempotencyKey: `data_subject.consent_revoked:${customerId}:${now.getTime()}`,
      data: {
        customer_id: customerId,
        organization_id: organizationId,
        revoked_at: now.toISOString(),
      },
    });
  });

  return {
    request_id: body.request_id,
    status: 'fulfilled',
    revoked_at: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// POST /anonymize-request
// ---------------------------------------------------------------------------

export interface AnonymizeRequestBody {
  organization_id: string;
  cpf_hash: string;
  otp: string;
  request_id: string;
}

export async function anonymizeRequestController(
  body: AnonymizeRequestBody,
  ip: string | null,
): Promise<{ request_id: string; status: string; message: string }> {
  const { customerId, organizationId, channel } = await verifyDataSubjectChallenge({
    cpfHash: body.cpf_hash,
    otp: body.otp,
    organizationId: body.organization_id,
  });

  const existing = await db
    .select()
    .from(dataSubjectRequests)
    .where(eq(dataSubjectRequests.requestId, body.request_id));
  if (existing[0]) {
    return {
      request_id: body.request_id,
      status: existing[0].status,
      message: 'Solicitação já registrada.',
    };
  }

  let requestDbId = '';
  await db.transaction(async (tx) => {
    const req = await tx
      .insert(dataSubjectRequests)
      .values({
        organizationId,
        customerId,
        documentHash: body.cpf_hash,
        requestId: body.request_id,
        type: 'anonymize',
        status: 'pending_dpo_review', // requer aprovação DPO
        channel,
        payloadMeta: { ip_hash: ip ? createHash('sha256').update(ip).digest('hex') : null },
      })
      .returning();

    requestDbId = req[0]?.id ?? '';

    await auditLog(tx, {
      organizationId,
      actor: null,
      action: 'lgpd.anonymize_requested',
      resource: { type: 'data_subject_request', id: requestDbId },
      after: {
        request_id: body.request_id,
        type: 'anonymize',
        customer_id: customerId,
        status: 'pending_dpo_review',
      },
      correlationId: null,
    });
  });

  return {
    request_id: body.request_id,
    status: 'pending_dpo_review',
    message:
      'Solicitação de anonimização registrada. Aguarda revisão do DPO conforme §6.2. Você será notificado no canal verificado.',
  };
}

// ---------------------------------------------------------------------------
// POST /delete-request
// ---------------------------------------------------------------------------

export interface DeleteRequestBody {
  organization_id: string;
  cpf_hash: string;
  otp: string;
  request_id: string;
}

export async function deleteRequestController(
  body: DeleteRequestBody,
  ip: string | null,
): Promise<{ request_id: string; status: string; message: string }> {
  const { customerId, organizationId, channel } = await verifyDataSubjectChallenge({
    cpfHash: body.cpf_hash,
    otp: body.otp,
    organizationId: body.organization_id,
  });

  // Verificar se base legal era consentimento e foi revogado
  const customerRow = await db.select().from(customers).where(eq(customers.id, customerId));

  const customer = customerRow[0];
  if (!customer?.consentRevokedAt) {
    throw new ConflictError(
      'Eliminação física não é possível: o consentimento não foi revogado ou a base legal do tratamento não é exclusivamente consentimento. ' +
        'Revogue o consentimento primeiro via POST /consent/revoke.',
    );
  }

  const existing = await db
    .select()
    .from(dataSubjectRequests)
    .where(eq(dataSubjectRequests.requestId, body.request_id));
  if (existing[0]) {
    return {
      request_id: body.request_id,
      status: existing[0].status,
      message: 'Solicitação já registrada.',
    };
  }

  let requestDbId = '';
  await db.transaction(async (tx) => {
    const req = await tx
      .insert(dataSubjectRequests)
      .values({
        organizationId,
        customerId,
        documentHash: body.cpf_hash,
        requestId: body.request_id,
        type: 'deletion',
        status: 'pending_dpo_review', // eliminação física requer DPO
        channel,
        payloadMeta: { ip_hash: ip ? createHash('sha256').update(ip).digest('hex') : null },
      })
      .returning();

    requestDbId = req[0]?.id ?? '';

    await auditLog(tx, {
      organizationId,
      actor: null,
      action: 'lgpd.deletion_requested',
      resource: { type: 'data_subject_request', id: requestDbId },
      after: {
        request_id: body.request_id,
        type: 'deletion',
        customer_id: customerId,
        status: 'pending_dpo_review',
      },
      correlationId: null,
    });
  });

  return {
    request_id: body.request_id,
    status: 'pending_dpo_review',
    message: 'Solicitação de eliminação registrada. Aguarda revisão do DPO. SLA: 15 dias úteis.',
  };
}

// ---------------------------------------------------------------------------
// POST /review-decision/:analysis_id — revisão de decisão automatizada (Art. 20)
// ---------------------------------------------------------------------------

export interface ReviewDecisionBody {
  organization_id: string;
  cpf_hash: string;
  otp: string;
  request_id: string;
}

export async function reviewDecisionController(
  analysisId: string,
  body: ReviewDecisionBody,
  ip: string | null,
): Promise<{ request_id: string; status: string; analysis_id: string; message: string }> {
  const { customerId, organizationId, channel } = await verifyDataSubjectChallenge({
    cpfHash: body.cpf_hash,
    otp: body.otp,
    organizationId: body.organization_id,
  });

  const existing = await db
    .select()
    .from(dataSubjectRequests)
    .where(eq(dataSubjectRequests.requestId, body.request_id));
  if (existing[0]) {
    return {
      request_id: body.request_id,
      status: existing[0].status,
      analysis_id: analysisId,
      message: 'Solicitação já registrada.',
    };
  }

  let requestDbId = '';
  await db.transaction(async (tx) => {
    const req = await tx
      .insert(dataSubjectRequests)
      .values({
        organizationId,
        customerId,
        documentHash: body.cpf_hash,
        requestId: body.request_id,
        type: 'review_decision',
        status: 'pending_dpo_review', // bloqueia decisão original até parecer humano
        channel,
        payloadMeta: { ip_hash: ip ? createHash('sha256').update(ip).digest('hex') : null },
        analysisId,
      })
      .returning();

    requestDbId = req[0]?.id ?? '';

    await auditLog(tx, {
      organizationId,
      actor: null,
      action: 'lgpd.review_decision_requested',
      resource: { type: 'data_subject_request', id: requestDbId },
      after: {
        request_id: body.request_id,
        type: 'review_decision',
        customer_id: customerId,
        analysis_id: analysisId,
        status: 'pending_dpo_review',
      },
      correlationId: null,
    });

    await emit(tx, {
      eventName: 'data_subject.review_requested',
      aggregateType: 'data_subject_request',
      aggregateId: requestDbId,
      organizationId,
      actor: systemActor().event,
      idempotencyKey: `data_subject.review_requested:${body.request_id}`,
      data: {
        request_id_db: requestDbId,
        request_id: body.request_id,
        customer_id: customerId,
        organization_id: organizationId,
        analysis_id: analysisId,
      },
    });
  });

  return {
    request_id: body.request_id,
    status: 'pending_dpo_review',
    analysis_id: analysisId,
    message:
      'Solicitação de revisão de decisão automatizada registrada (Art. 20 LGPD). A decisão original está bloqueada até parecer humano. SLA: 15 dias úteis.',
  };
}
