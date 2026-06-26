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
//
// F3-S04: getOrCreateLead
//   - Dedupe M2M para a tool get_or_create_lead (LangGraph).
//   - Erros tipados: INVALID_PHONE, LEAD_MERGE_REQUIRED.
//   - Outbox leads.created apenas quando created=true (mesma transação).
//   - LGPD: resposta retorna apenas IDs opacos — sem PII.
// =============================================================================
import { eq } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { kanbanCards, kanbanStages } from '../../db/schema/index.js';
import type { Lead } from '../../db/schema/leads.js';
import { emit } from '../../events/emit.js';
import { auditLog } from '../../lib/audit.js';
import { hashDocument } from '../../lib/crypto/pii.js';
import { AppError, NotFoundError } from '../../shared/errors.js';
import { findInitialStage, insertCard, insertHistory } from '../kanban/repository.js';

import {
  findCityNamesByIds,
  findCurrentStagesByLeadIds,
  findCustomerIdsByLeadIds,
  findInteractionsByLead,
  findLeadById,
  findLeadByPhoneInOrg,
  findLeadByPhoneInOrgExcluding,
  findLeads,
  ensureCustomerForLead,
  insertLead,
  isInternalEmail,
  restoreLead,
  softDeleteLead,
  updateLead,
} from './repository.js';
import type { LeadInteractionRow } from './repository.js';
import type {
  LeadCreate,
  LeadInteractionResponse,
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

/**
 * Erro de unicidade de email por organização.
 * Lançado quando um email ativo já está associado a outro lead na mesma org.
 * HTTP 409 para que o frontend possa exibir mensagem específica sem 500.
 *
 * LGPD §8.5: email não é logado — apenas o código de erro.
 */
export class LeadEmailDuplicateError extends AppError {
  constructor() {
    super(409, 'CONFLICT', 'Este email já está cadastrado nesta organização', {
      code: 'LEAD_EMAIL_DUPLICATE',
    });
    this.name = 'LeadEmailDuplicateError';
  }
}

/**
 * Erro de tentativa de usar email interno (de usuário da plataforma) como email de lead.
 * HTTP 422 porque é um erro semântico: o dado fornecido é inválido para este contexto.
 *
 * D3 (F14-S02): evita confusão de identidade e exposição de emails internos no CRM.
 */
export class LeadEmailInternalError extends AppError {
  constructor() {
    super(422, 'VALIDATION_ERROR', 'Use o email do cliente, não um email interno', {
      code: 'LEAD_EMAIL_INTERNAL',
    });
    this.name = 'LeadEmailInternalError';
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
    // cnpj: dado de PJ — fora do escopo estrito de PF (LGPD art. 5 I), mas
    // redactado em audit_log por precaução (pode revelar intenção de crédito).
    ...(obj['cnpj'] !== undefined ? { cnpj: '[redacted]' } : {}),
  };
}

// ---------------------------------------------------------------------------
// Serialização do Lead para resposta HTTP
// ---------------------------------------------------------------------------

interface LeadResponseExtras {
  cityName?: string | null;
  cardId?: string | null;
  stage?: { id: string; name: string } | null;
  /** ID do customer quando o lead está 'closed_won'. null = não convertido. (F17-S08) */
  customerId?: string | null;
}

function toLeadResponse(lead: Lead, extras?: LeadResponseExtras): LeadResponse {
  return {
    id: lead.id,
    organization_id: lead.organizationId,
    // cityId nullable (F3-S01): agente IA cria lead antes de identificar a cidade
    city_id: lead.cityId ?? null,
    // city_name / kanban_*: enriquecidos na lista/detalhe (F13-S03); null nos demais fluxos.
    city_name: extras?.cityName ?? null,
    kanban_card_id: extras?.cardId ?? null,
    kanban_stage: extras?.stage ?? null,
    // customer_id: null quando não convertido; UUID quando lead está 'closed_won' (F17-S08).
    customer_id: extras?.customerId ?? null,
    agent_id: lead.agentId ?? null,
    name: lead.name,
    phone_e164: lead.phoneE164,
    source: lead.source,
    status: lead.status,
    email: lead.email ?? null,
    notes: lead.notes ?? null,
    // `as` justificado: metadata é JSONB — Drizzle retorna Record<string,unknown>
    metadata: (lead.metadata as Record<string, unknown>) ?? {},
    cnpj: lead.cnpj ?? null,
    legal_name: lead.legalName ?? null,
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

  // Enriquecimento em lote (cidade + estágio de Kanban + customer) — sem N+1 (F13-S03).
  const cityIds = data
    .map((l) => l.cityId)
    .filter((id): id is string => id !== null && id !== undefined);
  const leadIds = data.map((l) => l.id);
  const [cityNames, stages, customerIds] = await Promise.all([
    findCityNamesByIds(db, cityIds),
    findCurrentStagesByLeadIds(db, leadIds),
    findCustomerIdsByLeadIds(db, leadIds),
  ]);

  return {
    data: data.map((l) => {
      const info = stages.get(l.id);
      return toLeadResponse(l, {
        cityName: l.cityId ? (cityNames.get(l.cityId) ?? null) : null,
        cardId: info?.cardId ?? null,
        stage: info?.stage ?? null,
        customerId: customerIds.get(l.id) ?? null,
      });
    }),
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

  // Enriquecimento cidade + estágio de Kanban + customer (F13-S03, F17-S08).
  const [cityNames, stages, customerIds] = await Promise.all([
    lead.cityId
      ? findCityNamesByIds(db, [lead.cityId])
      : Promise.resolve(new Map<string, string>()),
    findCurrentStagesByLeadIds(db, [lead.id]),
    findCustomerIdsByLeadIds(db, [lead.id]),
  ]);

  const info = stages.get(lead.id);
  return toLeadResponse(lead, {
    cityName: lead.cityId ? (cityNames.get(lead.cityId) ?? null) : null,
    cardId: info?.cardId ?? null,
    stage: info?.stage ?? null,
    customerId: customerIds.get(lead.id) ?? null,
  });
}

// ---------------------------------------------------------------------------
// Timeline de interações (F13-S07)
// ---------------------------------------------------------------------------

/** Mapeia o canal da interação para o `type` esperado pelo front. */
const CHANNEL_TO_TYPE: Record<LeadInteractionRow['channel'], LeadInteractionResponse['type']> = {
  whatsapp: 'whatsapp',
  chatwoot: 'whatsapp',
  phone: 'call',
  email: 'note',
  in_person: 'note',
};

/**
 * Lista a timeline de interações de um lead.
 *
 * Segurança: valida o acesso ao lead via findLeadById (city-scope RBAC) ANTES
 * de buscar as interações — 404 se fora do escopo (não vaza existência).
 *
 * LGPD (doc 17 §8.5): `content` é exibido ao agente autorizado (finalidade de
 * atendimento). Não há mascaramento aqui — é o canal de leitura do próprio
 * atendente; logs são cobertos por pino.redact no app.ts.
 */
export async function listLeadInteractions(
  db: Database,
  actor: ActorContext,
  leadId: string,
): Promise<LeadInteractionResponse[]> {
  const lead = await findLeadById(db, leadId, actor.organizationId, actor.cityScopeIds);
  if (!lead) throw new NotFoundError('Lead não encontrado');

  const rows = await findInteractionsByLead(db, leadId);

  return rows.map((r) => ({
    id: r.id,
    leadId: r.leadId,
    type: CHANNEL_TO_TYPE[r.channel] ?? 'note',
    content: r.content,
    // interactions não tem actor_user_id — derivamos do sentido da mensagem.
    actorName: r.direction === 'inbound' ? 'Cliente' : 'Equipe',
    createdAt: r.createdAt.toISOString(),
  }));
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

  // 3. Bloqueio de email interno (D3 F14-S02):
  // Se o email informado pertence a um usuário ativo da org → 422.
  // LGPD §8.5: não logamos o email aqui — apenas o código de erro.
  if (body.email !== null && body.email !== undefined) {
    const internal = await isInternalEmail(db, actor.organizationId, body.email);
    if (internal) {
      throw new LeadEmailInternalError();
    }
  }

  // 4. Derivar cpf_hash se CPF fornecido
  // LGPD: cpf bruto nunca é persistido — hashDocument usa HMAC-SHA256 com pepper.
  let cpfHash: string | null = null;
  if (body.cpf !== null && body.cpf !== undefined && body.cpf.length > 0) {
    // Normalizar CPF: remover pontos e traço antes de hashear
    const cpfNormalized = body.cpf.replace(/[^0-9]/g, '');
    cpfHash = hashDocument(cpfNormalized);
  }

  // 5. Criar em transação (lead + outbox + audit)
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
        cnpj: body.cnpj ?? null,
        legalName: body.legal_name ?? null,
      });
    } catch (err: unknown) {
      // Race condition: unique constraint parcial da DB
      // pg error code 23505 = unique_violation
      // Distinguimos pelo nome da constraint para mapear ao erro correto.
      if (isUniqueViolation(err, 'uq_leads_org_email_active')) {
        throw new LeadEmailDuplicateError();
      }
      if (isPgUniqueViolation(err)) {
        throw new LeadPhoneDuplicateError(body.phone_e164);
      }
      throw err;
    }

    // Lead criado já como convertido → garante o customer (idempotente).
    if (created.status === 'closed_won') {
      await ensureCustomerForLead(tx as unknown as Database, actor.organizationId, created.id);
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

    // ---- Kanban card automático (doc 01-prd-produto.md §72) -----------------
    // Todo lead entra no pipeline imediatamente, no stage de menor order_index
    // (seed canônico: "Pré-atendimento"). Mesma transação garante atomicidade:
    // se a criação do card falhar, o lead também é revertido — não fica órfão.
    const initialStage = await findInitialStage(
      tx as unknown as Parameters<typeof findInitialStage>[0],
      actor.organizationId,
    );
    if (initialStage) {
      const card = await insertCard(tx as unknown as Parameters<typeof insertCard>[0], {
        organizationId: actor.organizationId,
        leadId: created.id,
        stageId: initialStage.id,
        assigneeUserId: created.agentId,
      });

      await insertHistory(tx as unknown as Parameters<typeof insertHistory>[0], {
        cardId: card.id,
        fromStageId: null,
        toStageId: initialStage.id,
        actorUserId: actor.userId,
        metadata: { reason: 'lead_created' },
      });

      await emit(tx as unknown as Parameters<typeof emit>[0], {
        eventName: 'kanban.card_created',
        aggregateType: 'kanban_card',
        aggregateId: card.id,
        organizationId: actor.organizationId,
        actor: { kind: 'user', id: actor.userId, ip: actor.ip ?? null },
        idempotencyKey: `kanban.card_created:${card.id}`,
        data: {
          card_id: card.id,
          lead_id: created.id,
          stage: initialStage.name,
          city_id: created.cityId,
        },
      });
    }

    // Audit log — LGPD §8.5: sanitizar PII antes de gravar
    await auditLog(tx as unknown as Parameters<typeof auditLog>[0], {
      organizationId: actor.organizationId,
      actor: {
        userId: actor.userId,
        role: actor.role,
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
      },
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

  // 2. Bloqueio de email interno (D3 F14-S02):
  // Se o email está sendo alterado e pertence a um usuário ativo da org → 422.
  if (body.email !== null && body.email !== undefined && body.email !== before.email) {
    const internal = await isInternalEmail(db, actor.organizationId, body.email);
    if (internal) {
      throw new LeadEmailInternalError();
    }
  }

  // 3. Derivar cpf_hash se CPF fornecido na atualização
  // LGPD: cpf bruto nunca é persistido
  let cpfHash: string | null | undefined;
  if (body.cpf !== null && body.cpf !== undefined && body.cpf.length > 0) {
    const cpfNormalized = body.cpf.replace(/[^0-9]/g, '');
    cpfHash = hashDocument(cpfNormalized);
  } else if (body.cpf === null) {
    cpfHash = null;
  }
  // undefined = não alterar

  // 4. Determinar campos alterados (para o outbox event)
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
  if (body.cnpj !== undefined && body.cnpj !== before.cnpj) changedFields.push('cnpj');
  if (body.legal_name !== undefined && body.legal_name !== before.legalName)
    changedFields.push('legal_name');

  const after = await db.transaction(async (tx) => {
    let updated: Lead | null = null;
    try {
      updated = await updateLead(
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
          ...(body.cnpj !== undefined ? { cnpj: body.cnpj } : {}),
          ...(body.legal_name !== undefined ? { legalName: body.legal_name } : {}),
          updatedAt: new Date(),
        },
      );
    } catch (err: unknown) {
      if (isUniqueViolation(err, 'uq_leads_org_email_active')) {
        throw new LeadEmailDuplicateError();
      }
      throw err;
    }

    if (!updated) throw new NotFoundError('Lead não encontrado');

    // Conversão lead → cliente: ao entrar em closed_won, garante o registro de
    // customer (idempotente). Sem isto o lead fica "Convertido" sem customer e
    // não é possível criar contrato (que exige customer_id).
    if (body.status === 'closed_won' && before.status !== 'closed_won') {
      await ensureCustomerForLead(tx as unknown as Database, actor.organizationId, leadId);
    }

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
      actor: {
        userId: actor.userId,
        role: actor.role,
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
      },
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
      actor: {
        userId: actor.userId,
        role: actor.role,
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
      },
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
      actor: {
        userId: actor.userId,
        role: actor.role,
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
      },
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
// Get-or-create (F3-S04) — canal M2M / LangGraph
// ---------------------------------------------------------------------------

/**
 * Erros tipados específicos do canal interno (doc 06 §7.1).
 * Separados dos erros CRM para não poluir o domínio público.
 */

export class InvalidPhoneError extends AppError {
  constructor(detail?: string) {
    super(422, 'VALIDATION_ERROR', 'Telefone inválido ou não reconhecido como número BR', {
      code: 'INVALID_PHONE',
      ...(detail !== undefined ? { detail } : {}),
    });
    this.name = 'InvalidPhoneError';
  }
}

export class LeadMergeRequiredError extends AppError {
  constructor() {
    super(
      409,
      'CONFLICT',
      'Múltiplos leads com o mesmo telefone requerem ação humana para unificação',
      { code: 'LEAD_MERGE_REQUIRED' },
    );
    this.name = 'LeadMergeRequiredError';
  }
}

/**
 * Input para getOrCreateLead.
 * Tipagem própria — não expõe LeadCreate público (campos diferentes).
 */
export interface GetOrCreateLeadInput {
  /** Telefone E.164 (ex: +5569999999999). LGPD: PII. */
  phone: string;
  /** Nome do lead — pode ser undefined no primeiro contato. LGPD: PII. */
  name: string | undefined;
  /** Canal de origem da conversa. */
  source: 'whatsapp' | 'chatwoot' | 'api';
  /** ID opaco da conversa no Chatwoot — armazenado em metadata. */
  chatwootConversationId: string | undefined;
  /** UUID de correlação para rastreamento distribuído. */
  correlationId: string | undefined;
  /**
   * UUID da cidade do lead (opcional no primeiro contato).
   *
   * Nullable: leads.city_id é nullable desde migration 23 (F16-S32).
   * No canal IA, a cidade é desconhecida no primeiro contato e preenchida
   * depois via identify_city (F3-S06) / PATCH /internal/leads/:id.
   * undefined → null no insertLead.
   */
  cityId: string | undefined;
}

/**
 * Resposta de getOrCreateLead.
 * Apenas IDs opacos — LGPD §8.1: sem PII na resposta interna.
 */
export interface GetOrCreateLeadResult {
  lead_id: string;
  /** Sempre null em F3 — vinculação customer↔lead ocorre em F4. */
  customer_id: null;
  /** true = lead criado agora; false = lead existente retornado. */
  created: boolean;
  /** Nome do stage kanban atual (ex: "Pré-atendimento") ou null. */
  current_stage: string | null;
  /** UUID da cidade do lead — null quando desconhecida. */
  city_id: string | null;
  /** UUID do agente atribuído — null quando não atribuído. */
  assigned_agent_id: string | null;
}

/**
 * Busca ou cria um lead por telefone normalizado.
 *
 * Pipeline:
 *   1. Valida telefone — INVALID_PHONE se não passar na regex E.164.
 *   2. Normaliza phone_normalized.
 *   3. Lookup ativo por (phone_normalized, organization_id).
 *   4. Encontrado → retorna dados sem criar novo.
 *   5. Não encontrado → cria em transação com outbox leads.created.
 *
 * Escopo: sem city scope — IA tem acesso de leitura global à org.
 * Actor: sistema (LangGraph). userId sempre vazio; auditLog com role='ai'.
 *
 * LGPD (doc 17 §8.1, §8.5):
 *   - phone e name são PII — cobertos pelo pino.redact do app.ts.
 *   - Resposta retorna apenas IDs opacos (lead_id, city_id, assigned_agent_id).
 *   - Outbox leads.created sem PII bruta.
 *   - Audit log: redactLeadPii antes de persistir.
 */
export async function getOrCreateLead(
  db: Database,
  organizationId: string,
  input: GetOrCreateLeadInput,
  requestIp: string | null,
): Promise<GetOrCreateLeadResult> {
  // 1. Validação de formato E.164 — deve ser número BR (DDI 55 + DDD + número).
  //    A regex do schema já garante \+\d{10,15}, mas aqui refinamos para Brasil.
  //    Formato BR: +55 + 2 dígitos DDD + 8-9 dígitos = +55XXXXXXXXXXX (13 dígitos total).
  //    Número internacional pode ter formato diferente — aceitar qualquer E.164 válido
  //    e deixar a lógica de negócio futura refinar. Por ora apenas E.164 básico.
  const e164Regex = /^\+\d{10,15}$/;
  if (!e164Regex.test(input.phone)) {
    throw new InvalidPhoneError('Formato esperado: +5569999999999');
  }

  // 2. Normalizar: remove o '+' para phone_normalized (padrão do domínio de leads).
  const phoneNormalized = normalizePhone(input.phone);

  // 3. Lookup por telefone normalizado na org.
  //    findLeadByPhoneInOrg usa .limit(1) — retorna no máximo 1 resultado ativo.
  //    A unique constraint parcial da DB garante que não há duplicatas ativas.
  const existing = await findLeadByPhoneInOrg(db, phoneNormalized, organizationId);

  if (existing !== null) {
    // 4. Lead encontrado — buscar dados completos para montar resposta.
    //    cityScopeIds=null: IA tem visibilidade global dentro da org.
    const lead = await findLeadById(db, existing.id, organizationId, null);
    if (!lead) {
      // Race condition: lead foi soft-deleted entre o lookup e o findById.
      // Improvável mas possível — tratar como "não encontrado" e criar novo.
      return createNewLead(db, organizationId, input, requestIp);
    }

    // Buscar stage atual no kanban via JOIN direto.
    // Não há findCardByLeadId no kanban/repository — query direta é aceitável
    // pois é uma leitura simples (1 JOIN, sem lógica de negócio).
    const stageRows = await db
      .select({ stageName: kanbanStages.name })
      .from(kanbanCards)
      .innerJoin(kanbanStages, eq(kanbanCards.stageId, kanbanStages.id))
      .where(eq(kanbanCards.leadId, lead.id))
      .limit(1);

    const currentStage = stageRows[0]?.stageName ?? null;

    return {
      lead_id: lead.id,
      customer_id: null,
      created: false,
      current_stage: currentStage,
      city_id: lead.cityId ?? null,
      assigned_agent_id: lead.agentId ?? null,
    };
  }

  // 5. Não encontrado — criar novo lead.
  return createNewLead(db, organizationId, input, requestIp);
}

/**
 * Cria um novo lead via canal interno (IA).
 * Emite leads.created via outbox na mesma transação.
 * Cria kanban card automaticamente (mesmo comportamento de createLead).
 *
 * LGPD: audit log com redactLeadPii — phone, name, email substituídos por '[redacted]'.
 */
async function createNewLead(
  db: Database,
  organizationId: string,
  input: GetOrCreateLeadInput,
  requestIp: string | null,
): Promise<GetOrCreateLeadResult> {
  const phoneNormalized = normalizePhone(input.phone);

  // city_id é nullable (migration 23 já aplicada — schema Drizzle leads.ts:104 sem .notNull()).
  // No canal IA, a cidade é desconhecida no primeiro contato e preenchida depois por
  // identify_city / PATCH /internal/leads/:id. O lead entra no kanban pelo estágio inicial da org.

  const lead = await db.transaction(async (tx) => {
    let created: Lead;
    try {
      created = await insertLead(tx as unknown as Database, {
        organizationId,
        cityId: input.cityId ?? null,
        agentId: null,
        // Se name não fornecido, usa placeholder. O nó collect_missing_profile_data
        // do grafo coleta o nome real antes de follow-up.
        name: input.name ?? 'Desconhecido',
        phoneE164: input.phone,
        phoneNormalized,
        source: input.source,
        status: 'new',
        email: null,
        cpfHash: null,
        notes: null,
        metadata: {
          ...(input.chatwootConversationId !== undefined
            ? { chatwoot_conversation_id: input.chatwootConversationId }
            : {}),
          ...(input.correlationId !== undefined ? { correlation_id: input.correlationId } : {}),
        },
      });
    } catch (err: unknown) {
      if (isPgUniqueViolation(err)) {
        // Race condition: dois processos tentaram criar o lead simultaneamente.
        // O segundo falha no unique constraint — retornar como LEAD_MERGE_REQUIRED
        // para que o LangGraph tente novamente (o retry vai encontrar o lead existente).
        throw new LeadMergeRequiredError();
      }
      throw err;
    }

    // Outbox leads.created — sem PII bruta (apenas IDs opacos).
    // Emitido APENAS quando created=true (DoD F3-S04).
    await emit(tx as unknown as Parameters<typeof emit>[0], {
      eventName: 'leads.created',
      aggregateType: 'lead',
      aggregateId: created.id,
      organizationId,
      // actor 'system' representa a IA como sistema automático (não usuário humano).
      actor: { kind: 'system', id: 'langgraph', ip: requestIp },
      idempotencyKey: `leads.created:${created.id}`,
      data: {
        lead_id: created.id,
        city_id: created.cityId,
        source: created.source,
        assigned_agent_id: created.agentId ?? null,
        // Identifica que este lead foi criado pelo canal IA (distingue de 'user').
        created_by_kind: 'ai',
      },
    });

    // Kanban card automático — mesmo comportamento de createLead (F1-S11).
    // Garante que todo lead entra no pipeline imediatamente.
    const initialStage = await findInitialStage(
      tx as unknown as Parameters<typeof findInitialStage>[0],
      organizationId,
    );

    let stageName: string | null = null;

    if (initialStage !== undefined) {
      const card = await insertCard(tx as unknown as Parameters<typeof insertCard>[0], {
        organizationId,
        leadId: created.id,
        stageId: initialStage.id,
        assigneeUserId: null,
      });

      await insertHistory(tx as unknown as Parameters<typeof insertHistory>[0], {
        cardId: card.id,
        fromStageId: null,
        toStageId: initialStage.id,
        // actor_user_id null para ator de sistema (IA não tem UUID de usuário).
        actorUserId: null,
        metadata: { reason: 'lead_created_by_ai' },
      });

      await emit(tx as unknown as Parameters<typeof emit>[0], {
        eventName: 'kanban.card_created',
        aggregateType: 'kanban_card',
        aggregateId: card.id,
        organizationId,
        actor: { kind: 'system', id: 'langgraph', ip: requestIp },
        idempotencyKey: `kanban.card_created:${card.id}`,
        data: {
          card_id: card.id,
          lead_id: created.id,
          stage: initialStage.name,
          city_id: created.cityId,
        },
      });

      stageName = initialStage.name;
    }

    // Audit log — LGPD §8.5: sanitizar PII antes de gravar.
    // actor=null: ação de sistema (IA LangGraph). Conforme AuditActor type.
    await auditLog(tx as unknown as Parameters<typeof auditLog>[0], {
      organizationId,
      // null = ator de sistema/IA (não há usuário humano autenticado).
      actor: null,
      action: 'leads.create',
      resource: { type: 'lead', id: created.id },
      before: null,
      // redactLeadPii: substitui phone_e164, name, email por '[redacted]' — LGPD §8.5.
      after: redactLeadPii({
        id: created.id,
        organization_id: created.organizationId,
        city_id: created.cityId,
        agent_id: created.agentId ?? null,
        name: created.name,
        phone_e164: created.phoneE164,
        source: created.source,
        status: created.status,
      }),
    });

    return { lead: created, stageName };
  });

  return {
    lead_id: lead.lead.id,
    customer_id: null,
    created: true,
    current_stage: lead.stageName,
    city_id: lead.lead.cityId ?? null,
    assigned_agent_id: lead.lead.agentId ?? null,
  };
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

/**
 * Verifica se um erro é violação de unique constraint do PostgreSQL (code 23505),
 * opcionalmente filtrando pelo nome da constraint.
 * Usado para distinguir entre violações de phone vs email no createLead.
 */
function isUniqueViolation(err: unknown, constraint?: string): boolean {
  if (err === null || typeof err !== 'object') return false;
  const e = err as { code?: unknown; constraint?: unknown };
  if (e.code !== '23505') return false;
  if (constraint !== undefined && e.constraint !== constraint) return false;
  return true;
}
