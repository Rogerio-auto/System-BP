// =============================================================================
// leads/service.ts — Regras de negócio para o domínio de leads (F1-S11).
//
// Responsabilidades:
//   - Dedupe por phone_normalized no escopo da organização (pré-INSERT).
//   - Derivar phone_normalized a partir de phone_e164.
//   - Derivar cpf_hash via hashDocument() quando cpf é fornecido (LGPD).
//   - Audit log em toda mutação (sanitizado: PII redactada antes de persistir).
//   - Outbox events na mesma transação (sem PII).
//   - City scope: delegar ao repository.
//
// LGPD (doc 17 §8.1, §8.5):
//   - cpf bruto NUNCA é persistido — apenas cpf_hash (HMAC-SHA256 com pepper).
//   - before/after nos audit logs passam por redactLeadPii() antes de gravar.
//   - phone_e164, email e cpf* são substituídos por '[redacted]' nos logs.
//   - Outbox events carregam apenas IDs opacos, sem PII bruta.
//
// Erros:
//   - Duplicata phone → LeadPhoneDuplicateError (409, LEAD_PHONE_DUPLICATE).
//   - Recurso fora do scope → NotFoundError (404, não 403 — não vazar existência).
//   - Race condition (DB unique) → mapeado para LeadPhoneDuplicateError também.
// =============================================================================
import type { Database } from '../../db/client.js';
import type { Lead } from '../../db/schema/leads.js';
import { emit } from '../../events/emit.js';
import { auditLog } from '../../lib/audit.js';
import { hashDocument } from '../../lib/crypto/pii.js';
import { AppError, NotFoundError } from '../../shared/errors.js';

import {
  findLeadById,
  findLeadByPhoneInOrg,
  findLeadByPhoneInOrgExcluding,
  findLeads,
  insertLead,
  restoreLead,
  softDeleteLead,
  updateLead,
} from './repository.js';
import type {
  LeadCreate,
  LeadListQuery,
  LeadListResponse,
  LeadResponse,
  LeadUpdate,
} from './schemas.js';
import { normalizePhone } from './schemas.js';

// ---------------------------------------------------------------------------
// Error customizado: dedupe por telefone
// ---------------------------------------------------------------------------

export class LeadPhoneDuplicateError extends AppError {
  constructor(phone?: string) {
    super(409, 'CONFLICT', 'Este número de telefone já está cadastrado nesta organização', {
      code: 'LEAD_PHONE_DUPLICATE',
      ...(phone !== undefined ? { phone_e164: '[redacted]' } : {}),
    });
    this.name = 'LeadPhoneDuplicateError';
  }
}

// ---------------------------------------------------------------------------
// Contexto do ator
// ---------------------------------------------------------------------------

export interface ActorContext {
  userId: string;
  organizationId: string;
  role: string;
  cityScopeIds: string[] | null;
  ip?: string | null;
  userAgent?: string | null;
}

// ---------------------------------------------------------------------------
// LGPD: sanitização PII antes de gravar em audit_log
//
// doc 17 §8.5 — "o caller é responsável por aplicar redact antes de auditLog()."
// Substitui phone_e164, email, cpf* por '[redacted]' em snapshots before/after.
// Não remove o campo — marca que havia dado mas não o expõe no log.
// ---------------------------------------------------------------------------

function redactLeadPii(obj: Record<string, unknown>): Record<string, unknown> {
  return {
    ...obj,
    // phone_e164 e phone_normalized são PII (canal de contato)
    ...(obj['phone_e164'] !== undefined ? { phone_e164: '[redacted]' } : {}),
    ...(obj['phoneE164'] !== undefined ? { phoneE164: '[redacted]' } : {}),
    ...(obj['phone_normalized'] !== undefined ? { phone_normalized: '[redacted]' } : {}),
    ...(obj['phoneNormalized'] !== undefined ? { phoneNormalized: '[redacted]' } : {}),
    // email é PII
    ...(obj['email'] !== undefined ? { email: '[redacted]' } : {}),
    // cpf* é dado sensível (art. 11 LGPD)
    ...(obj['cpf'] !== undefined ? { cpf: '[redacted]' } : {}),
    ...(obj['cpf_hash'] !== undefined ? { cpf_hash: '[redacted]' } : {}),
    ...(obj['cpfHash'] !== undefined ? { cpfHash: '[redacted]' } : {}),
    // name é PII (identificação direta da pessoa)
    ...(obj['name'] !== undefined ? { name: '[redacted]' } : {}),
  };
}

// ---------------------------------------------------------------------------
// Serialização do Lead para resposta HTTP
// ---------------------------------------------------------------------------

function toLeadResponse(lead: Lead): LeadResponse {
  return {
    id: lead.id,
    organization_id: lead.organizationId,
    city_id: lead.cityId,
    agent_id: lead.agentId ?? null,
    name: lead.name,
    phone_e164: lead.phoneE164,
    source: lead.source,
    status: lead.status,
    email: lead.email ?? null,
    notes: lead.notes ?? null,
    // `as` justificado: metadata é JSONB — Drizzle retorna Record<string,unknown>
    metadata: (lead.metadata as Record<string, unknown>) ?? {},
    created_at: lead.createdAt.toISOString(),
    updated_at: lead.updatedAt.toISOString(),
    deleted_at: lead.deletedAt?.toISOString() ?? null,
  };
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export async function listLeads(
  db: Database,
  actor: ActorContext,
  query: LeadListQuery,
): Promise<LeadListResponse> {
  const { data, total } = await findLeads(db, actor.organizationId, actor.cityScopeIds, query);

  return {
    data: data.map(toLeadResponse),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

// ---------------------------------------------------------------------------
// Get by ID
// ---------------------------------------------------------------------------

export async function getLeadById(
  db: Database,
  actor: ActorContext,
  leadId: string,
): Promise<LeadResponse> {
  const lead = await findLeadById(db, leadId, actor.organizationId, actor.cityScopeIds);
  if (!lead) throw new NotFoundError('Lead não encontrado');

  return toLeadResponse(lead);
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createLead(
  db: Database,
  actor: ActorContext,
  body: LeadCreate,
): Promise<LeadResponse> {
  // 1. Derivar phone_normalized
  const phoneNormalized = normalizePhone(body.phone_e164);

  // 2. Dedupe por phone na org (pre-flight)
  const existing = await findLeadByPhoneInOrg(db, phoneNormalized, actor.organizationId);
  if (existing) {
    throw new LeadPhoneDuplicateError(body.phone_e164);
  }

  // 3. Derivar cpf_hash se CPF fornecido
  // LGPD: cpf bruto nunca é persistido — hashDocument usa HMAC-SHA256 com pepper.
  let cpfHash: string | null = null;
  if (body.cpf !== null && body.cpf !== undefined && body.cpf.length > 0) {
    // Normalizar CPF: remover pontos e traço antes de hashear
    const cpfNormalized = body.cpf.replace(/[^0-9]/g, '');
    cpfHash = hashDocument(cpfNormalized);
  }

  // 4. Criar em transação (lead + outbox + audit)
  const lead = await db.transaction(async (tx) => {
    let created: Lead;
    try {
      created = await insertLead(tx as unknown as Database, {
        organizationId: actor.organizationId,
        cityId: body.city_id,
        agentId: body.agent_id ?? null,
        name: body.name,
        phoneE164: body.phone_e164,
        phoneNormalized,
        source: body.source,
        status: body.status ?? 'new',
        email: body.email ?? null,
        cpfHash,
        notes: body.notes ?? null,
        metadata: body.metadata ?? {},
      });
    } catch (err: unknown) {
      // Race condition: unique constraint parcial da DB
      // pg error code 23505 = unique_violation
      if (isPgUniqueViolation(err)) {
        throw new LeadPhoneDuplicateError(body.phone_e164);
      }
      throw err;
    }

    // Outbox event — sem PII bruta (apenas IDs opacos)
    await emit(tx as unknown as Parameters<typeof emit>[0], {
      eventName: 'leads.created',
      aggregateType: 'lead',
      aggregateId: created.id,
      organizationId: actor.organizationId,
      actor: { kind: 'user', id: actor.userId, ip: actor.ip ?? null },
      idempotencyKey: `leads.created:${created.id}`,
      data: {
        lead_id: created.id,
        city_id: created.cityId,
        source: created.source,
        assigned_agent_id: created.agentId ?? null,
        created_by_kind: 'user',
      },
    });

    // Audit log — LGPD §8.5: sanitizar PII antes de gravar
    await auditLog(tx as unknown as Parameters<typeof auditLog>[0], {
      organizationId: actor.organizationId,
      actor: { userId: actor.userId, role: actor.role, ip: actor.ip, userAgent: actor.userAgent },
      action: 'leads.create',
      resource: { type: 'lead', id: created.id },
      before: null,
      // redactLeadPii: substitui phone_e164, email, name por '[redacted]' — LGPD §8.5
      after: redactLeadPii(toLeadResponse(created) as unknown as Record<string, unknown>),
    });

    return created;
  });

  return toLeadResponse(lead);
}

// ---------------------------------------------------------------------------
// Update (partial)
// ---------------------------------------------------------------------------

export async function updateLeadService(
  db: Database,
  actor: ActorContext,
  leadId: string,
  body: LeadUpdate,
): Promise<LeadResponse> {
  // 1. Verificar existência e scope
  const before = await findLeadById(db, leadId, actor.organizationId, actor.cityScopeIds);
  if (!before) throw new NotFoundError('Lead não encontrado');

  // 2. Derivar cpf_hash se CPF fornecido na atualização
  // LGPD: cpf bruto nunca é persistido
  let cpfHash: string | null | undefined;
  if (body.cpf !== null && body.cpf !== undefined && body.cpf.length > 0) {
    const cpfNormalized = body.cpf.replace(/[^0-9]/g, '');
    cpfHash = hashDocument(cpfNormalized);
  } else if (body.cpf === null) {
    cpfHash = null;
  }
  // undefined = não alterar

  // 3. Determinar campos alterados (para o outbox event)
  const changedFields: string[] = [];
  if (body.name !== undefined && body.name !== before.name) changedFields.push('name');
  if (body.city_id !== undefined && body.city_id !== before.cityId) changedFields.push('city_id');
  if (body.agent_id !== undefined && body.agent_id !== before.agentId)
    changedFields.push('agent_id');
  if (body.source !== undefined && body.source !== before.source) changedFields.push('source');
  if (body.status !== undefined && body.status !== before.status) changedFields.push('status');
  if (body.email !== undefined && body.email !== before.email) changedFields.push('email');
  if (body.notes !== undefined && body.notes !== before.notes) changedFields.push('notes');
  if (body.metadata !== undefined) changedFields.push('metadata');

  const after = await db.transaction(async (tx) => {
    const updated = await updateLead(
      tx as unknown as Database,
      leadId,
      actor.organizationId,
      actor.cityScopeIds,
      {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.city_id !== undefined ? { cityId: body.city_id } : {}),
        ...(body.agent_id !== undefined ? { agentId: body.agent_id } : {}),
        ...(body.source !== undefined ? { source: body.source } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.email !== undefined ? { email: body.email } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
        ...(cpfHash !== undefined ? { cpfHash } : {}),
        updatedAt: new Date(),
      },
    );

    if (!updated) throw new NotFoundError('Lead não encontrado');

    // Outbox event — sem PII bruta; changedFields é lista de nomes de campo
    await emit(tx as unknown as Parameters<typeof emit>[0], {
      eventName: 'leads.updated',
      aggregateType: 'lead',
      aggregateId: leadId,
      organizationId: actor.organizationId,
      actor: { kind: 'user', id: actor.userId, ip: actor.ip ?? null },
      idempotencyKey: `leads.updated:${leadId}:${Date.now()}`,
      data: {
        lead_id: leadId,
        // changes sem PII: apenas nomes dos campos e valores não-PII
        changes: changedFields.map((field) => ({
          field,
          // Omitimos before/after de campos PII (phone, email, name) no outbox
          before: ['phone_e164', 'email', 'name'].includes(field) ? '[redacted]' : null,
          after: ['phone_e164', 'email', 'name'].includes(field) ? '[redacted]' : null,
        })),
      },
    });

    // Audit log — LGPD §8.5: sanitizar PII antes de gravar
    await auditLog(tx as unknown as Parameters<typeof auditLog>[0], {
      organizationId: actor.organizationId,
      actor: { userId: actor.userId, role: actor.role, ip: actor.ip, userAgent: actor.userAgent },
      action: 'leads.update',
      resource: { type: 'lead', id: leadId },
      // redactLeadPii: substitui phone_e164, email, name por '[redacted]' — LGPD §8.5
      before: redactLeadPii(toLeadResponse(before) as unknown as Record<string, unknown>),
      after: redactLeadPii(toLeadResponse(updated) as unknown as Record<string, unknown>),
    });

    return updated;
  });

  return toLeadResponse(after);
}

// ---------------------------------------------------------------------------
// Delete (soft)
// ---------------------------------------------------------------------------

export async function deleteLeadService(
  db: Database,
  actor: ActorContext,
  leadId: string,
): Promise<void> {
  const before = await findLeadById(db, leadId, actor.organizationId, actor.cityScopeIds);
  if (!before) throw new NotFoundError('Lead não encontrado');

  await db.transaction(async (tx) => {
    const deleted = await softDeleteLead(
      tx as unknown as Database,
      leadId,
      actor.organizationId,
      actor.cityScopeIds,
    );

    if (!deleted) throw new NotFoundError('Lead não encontrado');

    // Outbox event — sem PII
    await emit(tx as unknown as Parameters<typeof emit>[0], {
      eventName: 'leads.deleted',
      aggregateType: 'lead',
      aggregateId: leadId,
      organizationId: actor.organizationId,
      actor: { kind: 'user', id: actor.userId, ip: actor.ip ?? null },
      idempotencyKey: `leads.deleted:${leadId}:${Date.now()}`,
      data: {
        lead_id: leadId,
        deleted_by_user_id: actor.userId,
      },
    });

    // Audit log — LGPD §8.5: sanitizar PII antes de gravar
    await auditLog(tx as unknown as Parameters<typeof auditLog>[0], {
      organizationId: actor.organizationId,
      actor: { userId: actor.userId, role: actor.role, ip: actor.ip, userAgent: actor.userAgent },
      action: 'leads.delete',
      resource: { type: 'lead', id: leadId },
      // redactLeadPii: substitui phone_e164, email, name por '[redacted]' — LGPD §8.5
      before: redactLeadPii(toLeadResponse(before) as unknown as Record<string, unknown>),
      after: null,
    });
  });
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

export async function restoreLeadService(
  db: Database,
  actor: ActorContext,
  leadId: string,
): Promise<LeadResponse> {
  // 1. Buscar o lead deletado (includeDeleted: true)
  const existing = await findLeadById(
    db,
    leadId,
    actor.organizationId,
    actor.cityScopeIds,
    true, // includeDeleted
  );

  if (!existing) throw new NotFoundError('Lead não encontrado');
  if (!existing.deletedAt) throw new NotFoundError('Lead não está deletado');

  // 2. Verificar se phone_normalized está em conflito com lead ativo (dedupe)
  // Exceção à dedupe: se o próprio lead está sendo restaurado e não há OUTRO lead com mesmo phone
  const conflict = await findLeadByPhoneInOrgExcluding(
    db,
    existing.phoneNormalized,
    actor.organizationId,
    leadId,
  );

  if (conflict) {
    throw new LeadPhoneDuplicateError(existing.phoneE164);
  }

  const restored = await db.transaction(async (tx) => {
    const lead = await restoreLead(tx as unknown as Database, leadId, actor.organizationId);
    if (!lead) throw new NotFoundError('Lead não encontrado');

    // Outbox event — sem PII
    await emit(tx as unknown as Parameters<typeof emit>[0], {
      eventName: 'leads.restored',
      aggregateType: 'lead',
      aggregateId: leadId,
      organizationId: actor.organizationId,
      actor: { kind: 'user', id: actor.userId, ip: actor.ip ?? null },
      idempotencyKey: `leads.restored:${leadId}:${Date.now()}`,
      data: {
        lead_id: leadId,
        restored_by_user_id: actor.userId,
      },
    });

    // Audit log — LGPD §8.5: sanitizar PII antes de gravar
    await auditLog(tx as unknown as Parameters<typeof auditLog>[0], {
      organizationId: actor.organizationId,
      actor: { userId: actor.userId, role: actor.role, ip: actor.ip, userAgent: actor.userAgent },
      action: 'leads.restore',
      resource: { type: 'lead', id: leadId },
      before: null,
      // redactLeadPii: substitui phone_e164, email, name por '[redacted]' — LGPD §8.5
      after: redactLeadPii(toLeadResponse(lead) as unknown as Record<string, unknown>),
    });

    return lead;
  });

  return toLeadResponse(restored);
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/**
 * Verifica se um erro é violação de unique constraint do PostgreSQL (code 23505).
 * Usado para mapear race condition de dedupe para LeadPhoneDuplicateError.
 */
function isPgUniqueViolation(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;

  // Drizzle/node-postgres expõe o código via .code
  const code = 'code' in err ? (err as { code: unknown }).code : undefined;

  return code === '23505';
}
