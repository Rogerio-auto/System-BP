// =============================================================================
// agents/service.ts — Regras de negócio para agentes de crédito (F8-S01).
//
// Responsabilidades:
//   - CRUD de agentes com audit log + outbox na mesma transação.
//   - Gestão atômica de agent_cities (invariante: 1 is_primary por agente).
//   - Bloqueio 409 ao desativar último agente ativo de cidade com leads abertos.
//   - Validação de userId (deve pertencer à mesma org).
//   - Validação de cityIds (devem existir e pertencer à org).
//   - Normalização de phone via normalizePhone.
//   - City scope em list e mutações.
//
// Invariantes:
//   - Exatamente 1 is_primary por agente (garantida via transação em replaceAgentCities).
//   - Soft-delete via deleted_at (preserva FK em leads.agent_id).
//   - Toda mutação emite outbox + audit na mesma transação.
//
// LGPD: phone é dado de colaborador (não de cidadão). Tratamento art. 7°, IX.
//   display_name pode ser incluído no payload do outbox (não é PII de cidadão).
// =============================================================================
import type { Database } from '../../db/client.js';
import type { AgentCity } from '../../db/schema/agent_cities.js';
import type { Agent } from '../../db/schema/agents.js';
import { emit } from '../../events/emit.js';
import { auditLog } from '../../lib/audit.js';
import type { AuditActor } from '../../lib/audit.js';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../shared/errors.js';
import { normalizePhone } from '../../shared/phone.js';
import type { UserScopeCtx } from '../../shared/scope.js';

import {
  countOpenLeadsInCitiesWithSingleAgent,
  deactivateAgent,
  findAgentById,
  findAgents,
  findInvalidCityIds,
  insertAgent,
  reactivateAgent,
  replaceAgentCities,
  updateAgent,
  userBelongsToOrg,
} from './repository.js';
import type {
  AgentCreate,
  AgentListQuery,
  AgentListResponse,
  AgentResponse,
  AgentSetCities,
  AgentUpdate,
} from './schemas.js';

// ---------------------------------------------------------------------------
// Erros de domínio
// ---------------------------------------------------------------------------

export class AgentUserConflictError extends AppError {
  constructor() {
    super(409, 'CONFLICT', 'Este usuário já está vinculado a um agente ativo nesta organização', {
      field: 'userId',
    });
    this.name = 'AgentUserConflictError';
  }
}

export class AgentLastActiveInCityError extends AppError {
  constructor(cityId: string, openLeads: number) {
    super(
      409,
      'CONFLICT',
      `Não é possível desativar: agente é o último ativo na cidade ${cityId} que possui ${openLeads} lead(s) aberto(s)`,
      { cityId, openLeads },
    );
    this.name = 'AgentLastActiveInCityError';
  }
}

// ---------------------------------------------------------------------------
// Contexto do ator
// ---------------------------------------------------------------------------

export interface ActorContext {
  userId: string;
  organizationId: string;
  role: string;
  ip?: string | null;
  userAgent?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildAuditActor(actor: ActorContext): AuditActor {
  return {
    userId: actor.userId,
    role: actor.role,
    ...(actor.ip !== undefined ? { ip: actor.ip } : {}),
    ...(actor.userAgent !== undefined ? { userAgent: actor.userAgent } : {}),
  };
}

function toAgentResponse(agent: Agent, cities: AgentCity[]): AgentResponse {
  const primaryCity = cities.find((c) => c.isPrimary);

  return {
    id: agent.id,
    organization_id: agent.organizationId,
    user_id: agent.userId ?? null,
    display_name: agent.displayName,
    phone: agent.phone ?? null,
    is_active: agent.isActive,
    cities: cities.map((c) => ({ city_id: c.cityId, is_primary: c.isPrimary })),
    primary_city_id: primaryCity?.cityId ?? null,
    city_count: cities.length,
    created_at: agent.createdAt.toISOString(),
    updated_at: agent.updatedAt.toISOString(),
    deleted_at: agent.deletedAt?.toISOString() ?? null,
  };
}

/**
 * Normaliza e valida phone via E.164.
 * Lança ValidationError se o número for inválido.
 */
function resolvePhone(raw: string | undefined | null): string | null {
  if (raw === undefined || raw === null || raw.trim().length === 0) return null;
  const result = normalizePhone(raw);
  if (!result.isValid || result.e164 === null) {
    throw new ValidationError(
      [{ code: 'custom', message: 'phone deve ser um número E.164 válido', path: ['phone'] }],
      'Número de telefone inválido',
    );
  }
  return result.e164;
}

/**
 * Verifica se erro Postgres é violação de unique constraint (code 23505).
 */
function isPgUniqueViolation(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;
  const code = 'code' in err ? (err as { code: unknown }).code : undefined;
  return code === '23505';
}

/**
 * Valida que todos os cityIds existem na org.
 * Lança ValidationError se algum for inválido.
 */
async function assertCityIdsExist(
  db: Database,
  cityIds: string[],
  organizationId: string,
): Promise<void> {
  const invalid = await findInvalidCityIds(db, cityIds, organizationId);
  if (invalid.length > 0) {
    throw new ValidationError(
      [
        {
          code: 'custom',
          message: `cityIds contém IDs inválidos ou não pertencentes à organização: ${invalid.join(', ')}`,
          path: ['cityIds'],
        },
      ],
      'cityIds inválidos',
    );
  }
}

/**
 * Constrói o array de city inputs com invariante: exatamente 1 is_primary.
 * - Se primaryCityId não for fornecido, o primeiro da lista é primary.
 */
function buildCityInputs(
  cityIds: string[],
  primaryCityId: string | undefined,
): Array<{ cityId: string; isPrimary: boolean }> {
  const primary = primaryCityId ?? cityIds[0];
  return cityIds.map((cityId) => ({ cityId, isPrimary: cityId === primary }));
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export async function listAgents(
  db: Database,
  actor: ActorContext,
  query: AgentListQuery,
  scopeCtx: UserScopeCtx,
): Promise<AgentListResponse> {
  const { data, total } = await findAgents(db, actor.organizationId, query, scopeCtx);

  return {
    data: data.map(({ agent, cities }) => toAgentResponse(agent, cities)),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createAgent(
  db: Database,
  actor: ActorContext,
  body: AgentCreate,
): Promise<AgentResponse> {
  // Validar cityIds
  await assertCityIdsExist(db, body.cityIds, actor.organizationId);

  // Validar userId se informado
  if (body.userId !== undefined) {
    const belongs = await userBelongsToOrg(db, body.userId, actor.organizationId);
    if (!belongs) {
      throw new ValidationError(
        [
          {
            code: 'custom',
            message: 'userId não pertence à organização',
            path: ['userId'],
          },
        ],
        'userId inválido',
      );
    }
  }

  const phone = resolvePhone(body.phone);
  const cityInputs = buildCityInputs(body.cityIds, body.primaryCityId);

  const result = await db.transaction(async (tx) => {
    let created: Agent;
    try {
      created = await insertAgent(tx as unknown as Database, {
        organizationId: actor.organizationId,
        displayName: body.displayName,
        ...(phone !== null ? { phone } : {}),
        ...(body.userId !== undefined ? { userId: body.userId } : {}),
      });
    } catch (err: unknown) {
      // Violação de unique parcial (org, user_id) WHERE deleted_at IS NULL
      if (isPgUniqueViolation(err)) throw new AgentUserConflictError();
      throw err;
    }

    // Inserir cidades — sem possibilidade de unique conflict (PK composta nova)
    const cities = await replaceAgentCities(tx as unknown as Database, created.id, cityInputs);

    // Outbox — sem PII de cidadão
    await emit(tx as unknown as Parameters<typeof emit>[0], {
      eventName: 'agent.created',
      aggregateType: 'agent',
      aggregateId: created.id,
      organizationId: actor.organizationId,
      actor: { kind: 'user', id: actor.userId, ip: actor.ip ?? null },
      idempotencyKey: `agent.created:${created.id}`,
      data: {
        agent_id: created.id,
        organization_id: actor.organizationId,
        display_name: created.displayName,
        city_ids: cities.map((c) => c.cityId),
        primary_city_id: cities.find((c) => c.isPrimary)?.cityId ?? null,
      },
    });

    // Audit log
    const responseAfter = toAgentResponse(created, cities);
    await auditLog(tx as unknown as Parameters<typeof auditLog>[0], {
      organizationId: actor.organizationId,
      actor: buildAuditActor(actor),
      action: 'agent.create',
      resource: { type: 'agent', id: created.id },
      before: null,
      after: responseAfter as unknown as Record<string, unknown>,
    });

    return { agent: created, cities };
  });

  return toAgentResponse(result.agent, result.cities);
}

// ---------------------------------------------------------------------------
// Update (PATCH)
// ---------------------------------------------------------------------------

export async function updateAgentService(
  db: Database,
  actor: ActorContext,
  agentId: string,
  body: AgentUpdate,
): Promise<AgentResponse> {
  const existing = await findAgentById(db, agentId, actor.organizationId);
  if (!existing) throw new NotFoundError('Agente não encontrado');

  // Validar userId se informado
  if (body.userId !== undefined && body.userId !== null) {
    const belongs = await userBelongsToOrg(db, body.userId, actor.organizationId);
    if (!belongs) {
      throw new ValidationError(
        [{ code: 'custom', message: 'userId não pertence à organização', path: ['userId'] }],
        'userId inválido',
      );
    }
  }

  const phone = body.phone !== undefined ? resolvePhone(body.phone) : undefined;

  // Campos alterados para o evento (sem valores — LGPD)
  const changedFields: string[] = [];
  if (body.displayName !== undefined) changedFields.push('displayName');
  if (body.phone !== undefined) changedFields.push('phone');
  if (body.userId !== undefined) changedFields.push('userId');
  if (body.isActive !== undefined) changedFields.push('isActive');

  const updated = await db.transaction(async (tx) => {
    let result: Agent;
    try {
      const updatedRow = await updateAgent(
        tx as unknown as Database,
        agentId,
        actor.organizationId,
        {
          ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
          ...(phone !== undefined ? { phone } : {}),
          ...(body.userId !== undefined ? { userId: body.userId } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
          updatedAt: new Date(),
        },
      );
      if (!updatedRow) throw new NotFoundError('Agente não encontrado');
      result = updatedRow;
    } catch (err: unknown) {
      if (isPgUniqueViolation(err)) throw new AgentUserConflictError();
      throw err;
    }

    // Outbox
    await emit(tx as unknown as Parameters<typeof emit>[0], {
      eventName: 'agent.updated',
      aggregateType: 'agent',
      aggregateId: agentId,
      organizationId: actor.organizationId,
      actor: { kind: 'user', id: actor.userId, ip: actor.ip ?? null },
      idempotencyKey: `agent.updated:${agentId}:${result.updatedAt.getTime()}`,
      data: {
        agent_id: agentId,
        organization_id: actor.organizationId,
        display_name: result.displayName,
        changed_fields: changedFields,
      },
    });

    // Audit log
    const responseBefore = toAgentResponse(existing.agent, existing.cities);
    const responseAfter = toAgentResponse(result, existing.cities);
    await auditLog(tx as unknown as Parameters<typeof auditLog>[0], {
      organizationId: actor.organizationId,
      actor: buildAuditActor(actor),
      action: 'agent.update',
      resource: { type: 'agent', id: agentId },
      before: responseBefore as unknown as Record<string, unknown>,
      after: responseAfter as unknown as Record<string, unknown>,
    });

    return result;
  });

  return toAgentResponse(updated, existing.cities);
}

// ---------------------------------------------------------------------------
// Deactivate
// ---------------------------------------------------------------------------

export async function deactivateAgentService(
  db: Database,
  actor: ActorContext,
  agentId: string,
): Promise<AgentResponse> {
  const existing = await findAgentById(db, agentId, actor.organizationId);
  if (!existing) throw new NotFoundError('Agente não encontrado');

  if (!existing.agent.isActive) {
    throw new ConflictError('Agente já está inativo');
  }

  // Verificar bloqueio: último agente ativo de cidade com leads abertos
  const blockedCities = await countOpenLeadsInCitiesWithSingleAgent(
    db,
    agentId,
    actor.organizationId,
  );

  if (blockedCities.length > 0) {
    const first = blockedCities[0];
    if (first !== undefined) {
      throw new AgentLastActiveInCityError(first.cityId, first.openLeadCount);
    }
  }

  const deactivated = await db.transaction(async (tx) => {
    const result = await deactivateAgent(tx as unknown as Database, agentId, actor.organizationId);
    if (!result) throw new NotFoundError('Agente não encontrado');

    // Outbox
    await emit(tx as unknown as Parameters<typeof emit>[0], {
      eventName: 'agent.deactivated',
      aggregateType: 'agent',
      aggregateId: agentId,
      organizationId: actor.organizationId,
      actor: { kind: 'user', id: actor.userId, ip: actor.ip ?? null },
      idempotencyKey: `agent.deactivated:${agentId}:${result.deletedAt!.getTime()}`,
      data: {
        agent_id: agentId,
        organization_id: actor.organizationId,
        display_name: result.displayName,
      },
    });

    // Audit log
    const responseBefore = toAgentResponse(existing.agent, existing.cities);
    const responseAfter = toAgentResponse(result, existing.cities);
    await auditLog(tx as unknown as Parameters<typeof auditLog>[0], {
      organizationId: actor.organizationId,
      actor: buildAuditActor(actor),
      action: 'agent.deactivate',
      resource: { type: 'agent', id: agentId },
      before: responseBefore as unknown as Record<string, unknown>,
      after: responseAfter as unknown as Record<string, unknown>,
    });

    return result;
  });

  return toAgentResponse(deactivated, existing.cities);
}

// ---------------------------------------------------------------------------
// Reactivate
// ---------------------------------------------------------------------------

export async function reactivateAgentService(
  db: Database,
  actor: ActorContext,
  agentId: string,
): Promise<AgentResponse> {
  const existing = await findAgentById(db, agentId, actor.organizationId, true);
  if (!existing) throw new NotFoundError('Agente não encontrado');

  if (existing.agent.isActive && existing.agent.deletedAt === null) {
    throw new ConflictError('Agente já está ativo');
  }

  const reactivated = await db.transaction(async (tx) => {
    let result: Agent;
    try {
      const row = await reactivateAgent(tx as unknown as Database, agentId, actor.organizationId);
      if (!row) throw new NotFoundError('Agente não encontrado');
      result = row;
    } catch (err: unknown) {
      if (isPgUniqueViolation(err)) throw new AgentUserConflictError();
      throw err;
    }

    // Outbox
    await emit(tx as unknown as Parameters<typeof emit>[0], {
      eventName: 'agent.reactivated',
      aggregateType: 'agent',
      aggregateId: agentId,
      organizationId: actor.organizationId,
      actor: { kind: 'user', id: actor.userId, ip: actor.ip ?? null },
      idempotencyKey: `agent.reactivated:${agentId}:${result.updatedAt.getTime()}`,
      data: {
        agent_id: agentId,
        organization_id: actor.organizationId,
        display_name: result.displayName,
      },
    });

    // Audit log
    const responseBefore = toAgentResponse(existing.agent, existing.cities);
    const responseAfter = toAgentResponse(result, existing.cities);
    await auditLog(tx as unknown as Parameters<typeof auditLog>[0], {
      organizationId: actor.organizationId,
      actor: buildAuditActor(actor),
      action: 'agent.reactivate',
      resource: { type: 'agent', id: agentId },
      before: responseBefore as unknown as Record<string, unknown>,
      after: responseAfter as unknown as Record<string, unknown>,
    });

    return result;
  });

  // Recarregar cidades após reativação
  const refreshed = await findAgentById(db, agentId, actor.organizationId);
  return toAgentResponse(reactivated, refreshed?.cities ?? existing.cities);
}

// ---------------------------------------------------------------------------
// Set cities (PUT /:id/cities)
// ---------------------------------------------------------------------------

export async function setAgentCities(
  db: Database,
  actor: ActorContext,
  agentId: string,
  body: AgentSetCities,
): Promise<AgentResponse> {
  const existing = await findAgentById(db, agentId, actor.organizationId);
  if (!existing) throw new NotFoundError('Agente não encontrado');

  // Validar cityIds
  await assertCityIdsExist(db, body.cityIds, actor.organizationId);

  const cityInputs = buildCityInputs(body.cityIds, body.primaryCityId);

  const newCities = await db.transaction(async (tx) => {
    const cities = await replaceAgentCities(tx as unknown as Database, agentId, cityInputs);

    // Atualizar updatedAt do agente
    await updateAgent(tx as unknown as Database, agentId, actor.organizationId, {
      updatedAt: new Date(),
    });

    // Outbox
    await emit(tx as unknown as Parameters<typeof emit>[0], {
      eventName: 'agent.cities_changed',
      aggregateType: 'agent',
      aggregateId: agentId,
      organizationId: actor.organizationId,
      actor: { kind: 'user', id: actor.userId, ip: actor.ip ?? null },
      idempotencyKey: `agent.cities_changed:${agentId}:${Date.now()}`,
      data: {
        agent_id: agentId,
        organization_id: actor.organizationId,
        city_ids: cities.map((c) => c.cityId),
        primary_city_id: cities.find((c) => c.isPrimary)?.cityId ?? null,
      },
    });

    // Audit log
    const responseBefore = toAgentResponse(existing.agent, existing.cities);
    const responseAfter = toAgentResponse(existing.agent, cities);
    await auditLog(tx as unknown as Parameters<typeof auditLog>[0], {
      organizationId: actor.organizationId,
      actor: buildAuditActor(actor),
      action: 'agent.setCities',
      resource: { type: 'agent', id: agentId },
      before: responseBefore as unknown as Record<string, unknown>,
      after: responseAfter as unknown as Record<string, unknown>,
    });

    return cities;
  });

  return toAgentResponse(existing.agent, newCities);
}
