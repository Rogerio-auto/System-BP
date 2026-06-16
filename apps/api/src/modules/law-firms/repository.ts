// =============================================================================
// law-firms/repository.ts — Queries Drizzle para escritórios de advocacia (F19-S02).
//
// Responsabilidades:
//   - CRUD de law_firms com org-scope em todas as queries.
//   - Suggest: busca escritório padrão para uma cidade (GIN array containment).
//
// Multi-tenant:
//   Todas as queries exigem organizationId para isolar por tenant.
//   Nenhuma query opera só por id — sempre id + organizationId.
//
// City scope:
//   law_firms não tem city_id direto — coverage_city_ids é um uuid[].
//   O escopo RBAC de cidade (cityScopeIds do actor) NÃO é aplicado aqui:
//   escritórios são recursos de gestão (não de operação por cidade do agente).
//   O endpoint /suggest filtra por cobertura de cidade do cliente, não do actor.
//
// Soft-delete:
//   - Listagem/reads: excluem deleted_at IS NOT NULL por padrão.
//   - Delete: seta deleted_at + updated_at (não remove fisicamente).
//
// LGPD (doc 17):
//   - contact_phone é dado de PJ — não é PII pessoal.
//   - notes pode conter descrições de inadimplência — validação na borda (service).
// =============================================================================
import { type SQL, and, count, eq, isNull, sql } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { customers } from '../../db/schema/customers.js';
import { lawFirms } from '../../db/schema/law-firms.js';
import type { LawFirm } from '../../db/schema/law-firms.js';
import { leads } from '../../db/schema/leads.js';

// ---------------------------------------------------------------------------
// Tipos de input internos
// ---------------------------------------------------------------------------

export interface CreateLawFirmInput {
  organizationId: string;
  name: string;
  contactPhone?: string | null;
  coverageCityIds: string[];
  isDefaultForCity: boolean;
  notes?: string | null;
  createdBy: string | null;
}

export interface UpdateLawFirmInput {
  name?: string;
  contactPhone?: string | null;
  coverageCityIds?: string[];
  isDefaultForCity?: boolean;
  notes?: string | null;
}

export interface PaginatedLawFirms {
  data: LawFirm[];
  total: number;
}

// ---------------------------------------------------------------------------
// Serialização: LawFirm → LawFirmResponse (shape snake_case para o cliente)
// ---------------------------------------------------------------------------

export interface LawFirmRow {
  id: string;
  organization_id: string;
  name: string;
  contact_phone: string | null;
  coverage_city_ids: string[];
  is_default_for_city: boolean;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export function toLawFirmRow(firm: LawFirm): LawFirmRow {
  return {
    id: firm.id,
    organization_id: firm.organizationId,
    name: firm.name,
    contact_phone: firm.contactPhone ?? null,
    // Drizzle retorna uuid[] como string[]
    coverage_city_ids: (firm.coverageCityIds as string[]) ?? [],
    is_default_for_city: firm.isDefaultForCity,
    notes: firm.notes ?? null,
    created_by: firm.createdBy ?? null,
    created_at: firm.createdAt.toISOString(),
    updated_at: firm.updatedAt.toISOString(),
    deleted_at: firm.deletedAt?.toISOString() ?? null,
  };
}

// ---------------------------------------------------------------------------
// List (paginada)
// ---------------------------------------------------------------------------

/**
 * Lista escritórios de uma organização, com paginação e filtro opcional por cidade.
 * Exclui soft-deletados (deleted_at IS NULL).
 *
 * @param cityId  Se fornecido, filtra por cobertura: coverage_city_ids @> ARRAY[cityId].
 */
export async function findLawFirms(
  db: Database,
  organizationId: string,
  page: number,
  pageSize: number,
  cityId?: string,
): Promise<PaginatedLawFirms> {
  const offset = (page - 1) * pageSize;

  const conditions: SQL<unknown>[] = [
    eq(lawFirms.organizationId, organizationId),
    isNull(lawFirms.deletedAt),
  ];

  if (cityId !== undefined) {
    // GIN array containment: escritórios que cobrem a cidade fornecida.
    // `@>` verifica se coverage_city_ids contém o array [cityId].
    conditions.push(sql`${lawFirms.coverageCityIds} @> ARRAY[${cityId}]::uuid[]` as SQL<unknown>);
  }

  const where = and(...conditions);

  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(lawFirms)
      .where(where)
      .orderBy(lawFirms.createdAt)
      .limit(pageSize)
      .offset(offset),
    db.select({ count: count() }).from(lawFirms).where(where),
  ]);

  return {
    data: rows,
    total: totalRows[0]?.count ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Find by ID (com org-scope)
// ---------------------------------------------------------------------------

/**
 * Busca um escritório pelo id dentro da organização.
 * Retorna null se não encontrado, deletado ou fora do org-scope.
 *
 * Segurança: org-scope garante isolamento multi-tenant.
 * 404 em vez de 403 — não vaza existência de recursos de outras orgs.
 */
export async function findLawFirmById(
  db: Database,
  id: string,
  organizationId: string,
): Promise<LawFirm | null> {
  const rows = await db
    .select()
    .from(lawFirms)
    .where(
      and(
        eq(lawFirms.id, id),
        eq(lawFirms.organizationId, organizationId),
        isNull(lawFirms.deletedAt),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Insert
// ---------------------------------------------------------------------------

/**
 * Insere um novo escritório de advocacia.
 * Deve ser chamado dentro de uma transação quando combinado com auditLog/emit.
 */
export async function insertLawFirm(db: Database, input: CreateLawFirmInput): Promise<LawFirm> {
  const rows = await db
    .insert(lawFirms)
    .values({
      organizationId: input.organizationId,
      name: input.name,
      contactPhone: input.contactPhone ?? null,
      // `as` justificado: Drizzle espera string[] para uuid[] — o schema Zod garante UUIDs.
      coverageCityIds: input.coverageCityIds as string[],
      isDefaultForCity: input.isDefaultForCity,
      notes: input.notes ?? null,
      createdBy: input.createdBy,
    })
    .returning();

  const firm = rows[0];
  if (firm === undefined) {
    throw new Error('Falha ao inserir escritório — insert não retornou linha');
  }
  return firm;
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

/**
 * Atualiza campos de um escritório.
 * Retorna null se não encontrado ou fora do org-scope.
 * Deve ser chamado dentro de uma transação.
 */
export async function updateLawFirm(
  db: Database,
  id: string,
  organizationId: string,
  input: UpdateLawFirmInput,
): Promise<LawFirm | null> {
  const setValues: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (input.name !== undefined) setValues['name'] = input.name;
  if (input.contactPhone !== undefined) setValues['contactPhone'] = input.contactPhone;
  if (input.coverageCityIds !== undefined) {
    // `as` justificado: Drizzle espera string[] para uuid[] — Zod garante UUIDs.
    setValues['coverageCityIds'] = input.coverageCityIds as string[];
  }
  if (input.isDefaultForCity !== undefined) setValues['isDefaultForCity'] = input.isDefaultForCity;
  if (input.notes !== undefined) setValues['notes'] = input.notes;

  const rows = await db
    .update(lawFirms)
    .set(setValues)
    .where(
      and(
        eq(lawFirms.id, id),
        eq(lawFirms.organizationId, organizationId),
        isNull(lawFirms.deletedAt),
      ),
    )
    .returning();

  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Soft delete
// ---------------------------------------------------------------------------

/**
 * Soft-delete: seta deleted_at + updated_at.
 * Retorna null se não encontrado ou fora do org-scope.
 * Deve ser chamado dentro de uma transação.
 */
export async function softDeleteLawFirm(
  db: Database,
  id: string,
  organizationId: string,
): Promise<LawFirm | null> {
  const rows = await db
    .update(lawFirms)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(lawFirms.id, id),
        eq(lawFirms.organizationId, organizationId),
        isNull(lawFirms.deletedAt),
      ),
    )
    .returning();

  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Suggest: escritório padrão para a cidade do cliente
// ---------------------------------------------------------------------------

/**
 * Busca o city_id do lead primário de um customer (com org-scope).
 * Retorna null se o customer não for encontrado ou se o lead primário não tiver city_id.
 *
 * customers não tem city_id direto — a cidade fica no lead primário (leads.city_id).
 * Fazemos JOIN customers → leads via primary_lead_id para obter a cidade.
 *
 * Segurança: org-scope garante isolamento multi-tenant.
 * LGPD: retorna apenas city_id (dado de localização, não PII sensível).
 */
export async function findCustomerCityId(
  db: Database,
  customerId: string,
  organizationId: string,
): Promise<string | null> {
  const rows = await db
    .select({ cityId: leads.cityId })
    .from(customers)
    .innerJoin(leads, eq(customers.primaryLeadId, leads.id))
    .where(and(eq(customers.id, customerId), eq(customers.organizationId, organizationId)))
    .limit(1);

  return rows[0]?.cityId ?? null;
}

/**
 * Busca o escritório padrão (is_default_for_city = true) que cobre uma cidade.
 * Retorna null se não encontrado.
 *
 * Estratégia: filtra is_default_for_city=true + coverage_city_ids contém cityId.
 * Retorna apenas o primeiro match — constraint de negócio garante 0 ou 1 por cidade/org.
 */
export async function findDefaultLawFirmForCity(
  db: Database,
  organizationId: string,
  cityId: string,
): Promise<LawFirm | null> {
  const rows = await db
    .select()
    .from(lawFirms)
    .where(
      and(
        eq(lawFirms.organizationId, organizationId),
        isNull(lawFirms.deletedAt),
        eq(lawFirms.isDefaultForCity, true),
        sql`${lawFirms.coverageCityIds} @> ARRAY[${cityId}]::uuid[]` as SQL<unknown>,
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}
