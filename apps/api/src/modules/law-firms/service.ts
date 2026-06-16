// =============================================================================
// law-firms/service.ts — Regras de negócio para escritórios de advocacia (F19-S02).
//
// Responsabilidades:
//   - CRUD de law_firms com audit log em mutações.
//   - Suggest: busca escritório padrão para a cidade do cliente.
//
// Audit log:
//   - create: registra o escritório criado (sem PII — dados de PJ).
//   - update: registra before/after.
//   - delete: registra o soft-delete.
//   - suggest: sem audit log (operação de leitura).
//
// LGPD (doc 17):
//   - contact_phone é dado público de PJ — não precisa de redact.
//   - notes pode conter descrições de inadimplência — não incluir CPF/biometria.
//   - customer_id é FK ao titular LGPD — validado por org-scope antes do suggest.
// =============================================================================

import type { Database } from '../../db/client.js';
import { auditLog } from '../../lib/audit.js';
import { NotFoundError } from '../../shared/errors.js';

import {
  findCustomerCityId,
  findDefaultLawFirmForCity,
  findLawFirmById,
  findLawFirms,
  insertLawFirm,
  softDeleteLawFirm,
  toLawFirmRow,
  updateLawFirm,
} from './repository.js';
import type {
  LawFirmCreate,
  LawFirmListQuery,
  LawFirmListResponse,
  LawFirmResponse,
  LawFirmSuggestResponse,
  LawFirmUpdate,
} from './schemas.js';

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
// List
// ---------------------------------------------------------------------------

export async function listLawFirmsService(
  db: Database,
  actor: ActorContext,
  query: LawFirmListQuery,
): Promise<LawFirmListResponse> {
  const { page, pageSize, city_id } = query;

  const { data, total } = await findLawFirms(db, actor.organizationId, page, pageSize, city_id);

  return {
    data: data.map(toLawFirmRow) as LawFirmResponse[],
    meta: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createLawFirmService(
  db: Database,
  actor: ActorContext,
  body: LawFirmCreate,
): Promise<LawFirmResponse> {
  const firm = await db.transaction(async (tx) => {
    const created = await insertLawFirm(tx as unknown as Database, {
      organizationId: actor.organizationId,
      name: body.name,
      contactPhone: body.contact_phone ?? null,
      coverageCityIds: body.coverage_city_ids,
      isDefaultForCity: body.is_default_for_city,
      notes: body.notes ?? null,
      createdBy: actor.userId,
    });

    await auditLog(tx as unknown as Parameters<typeof auditLog>[0], {
      organizationId: actor.organizationId,
      actor: {
        userId: actor.userId,
        role: actor.role,
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
      },
      action: 'law_firms.create',
      resource: { type: 'law_firm', id: created.id },
      before: null,
      // `as` justificado: LawFirmRow é compatível com Record<string, unknown> em runtime.
      after: toLawFirmRow(created) as unknown as Record<string, unknown>,
    });

    return created;
  });

  return toLawFirmRow(firm) as LawFirmResponse;
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export async function updateLawFirmService(
  db: Database,
  actor: ActorContext,
  firmId: string,
  body: LawFirmUpdate,
): Promise<LawFirmResponse> {
  // 1. Verificar existência e org-scope antes de iniciar transação
  const before = await findLawFirmById(db, firmId, actor.organizationId);
  if (!before) throw new NotFoundError('Escritório não encontrado');

  const updated = await db.transaction(async (tx) => {
    const firm = await updateLawFirm(tx as unknown as Database, firmId, actor.organizationId, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.contact_phone !== undefined ? { contactPhone: body.contact_phone } : {}),
      ...(body.coverage_city_ids !== undefined ? { coverageCityIds: body.coverage_city_ids } : {}),
      ...(body.is_default_for_city !== undefined
        ? { isDefaultForCity: body.is_default_for_city }
        : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
    });

    if (!firm) throw new NotFoundError('Escritório não encontrado');

    await auditLog(tx as unknown as Parameters<typeof auditLog>[0], {
      organizationId: actor.organizationId,
      actor: {
        userId: actor.userId,
        role: actor.role,
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
      },
      action: 'law_firms.update',
      resource: { type: 'law_firm', id: firmId },
      // `as` justificado: LawFirmRow é compatível com Record<string, unknown> em runtime.
      before: toLawFirmRow(before) as unknown as Record<string, unknown>,
      after: toLawFirmRow(firm) as unknown as Record<string, unknown>,
    });

    return firm;
  });

  return toLawFirmRow(updated) as LawFirmResponse;
}

// ---------------------------------------------------------------------------
// Delete (soft)
// ---------------------------------------------------------------------------

export async function deleteLawFirmService(
  db: Database,
  actor: ActorContext,
  firmId: string,
): Promise<void> {
  const before = await findLawFirmById(db, firmId, actor.organizationId);
  if (!before) throw new NotFoundError('Escritório não encontrado');

  await db.transaction(async (tx) => {
    const deleted = await softDeleteLawFirm(
      tx as unknown as Database,
      firmId,
      actor.organizationId,
    );

    if (!deleted) throw new NotFoundError('Escritório não encontrado');

    await auditLog(tx as unknown as Parameters<typeof auditLog>[0], {
      organizationId: actor.organizationId,
      actor: {
        userId: actor.userId,
        role: actor.role,
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
      },
      action: 'law_firms.delete',
      resource: { type: 'law_firm', id: firmId },
      // `as` justificado: LawFirmRow é compatível com Record<string, unknown> em runtime.
      before: toLawFirmRow(before) as unknown as Record<string, unknown>,
      after: null,
    });
  });
}

// ---------------------------------------------------------------------------
// Suggest
// ---------------------------------------------------------------------------

/**
 * Retorna o escritório padrão (is_default_for_city = true) para a cidade do cliente.
 *
 * Pipeline:
 *   1. Busca city_id do customer via JOIN customers → leads (org-scope).
 *   2. Se customer não encontrado → 404.
 *   3. Se customer não tem cidade → retorna { data: null }.
 *   4. Busca escritório padrão que cobre a cidade (GIN containment).
 *   5. Retorna primeiro match ou null.
 *
 * Sem audit log: operação de leitura.
 */
export async function suggestLawFirmService(
  db: Database,
  actor: ActorContext,
  customerId: string,
): Promise<LawFirmSuggestResponse> {
  // 1. Buscar cidade do cliente (via lead primário)
  const cityId = await findCustomerCityId(db, customerId, actor.organizationId);

  // 2. Customer não encontrado (ou fora do org-scope) → 404
  //    Retornamos 404 em vez de 403 para não vazar existência de recursos de outras orgs.
  if (cityId === null) {
    throw new NotFoundError('Cliente não encontrado');
  }

  // 3. Buscar escritório padrão para a cidade
  const firm = await findDefaultLawFirmForCity(db, actor.organizationId, cityId);

  return {
    data: firm !== null ? (toLawFirmRow(firm) as LawFirmResponse) : null,
  };
}
