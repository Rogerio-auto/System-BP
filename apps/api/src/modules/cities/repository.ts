// =============================================================================
// cities/repository.ts — Queries Drizzle para o domínio de cidades (F1-S06).
//
// City scope: cidades são gerenciadas por admin global (cityScopeIds === null).
// O repository não aplica city scope nas queries de CRUD — apenas organizationId.
// A autorização é feita pela permissão 'admin:cities:write' no middleware.
//
// Soft-delete:
//   - Listagem exclui registros com deleted_at IS NOT NULL por padrão.
//   - findCityById: sem filtro de deleted_at por default.
//   - delete: seta deleted_at, não remove fisicamente.
//
// LGPD: cidades não contêm PII (nome de município + UF).
// =============================================================================
import { and, count, eq, ilike, isNull, isNotNull, or } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { cities } from '../../db/schema/cities.js';
import type { City } from '../../db/schema/cities.js';

import type { CityListQuery } from './schemas.js';

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

export interface PaginatedCities {
  data: City[];
  total: number;
}

export interface CreateCityInput {
  organizationId: string;
  name: string;
  nameNormalized: string;
  slug: string;
  aliases: string[];
  ibgeCode?: string | null;
  stateUf: string;
  isActive: boolean;
}

export interface UpdateCityInput {
  name?: string;
  nameNormalized?: string;
  slug?: string;
  aliases?: string[];
  ibgeCode?: string | null;
  stateUf?: string;
  isActive?: boolean;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Lista cidades da org com paginação e filtros opcionais.
 * Por padrão exclui cidades soft-deleted.
 */
export async function findCities(
  db: Database,
  organizationId: string,
  query: CityListQuery,
): Promise<PaginatedCities> {
  const { page, limit, search, state_uf, is_active, include_deleted } = query;
  const offset = (page - 1) * limit;

  const conditions: ReturnType<typeof eq>[] = [eq(cities.organizationId, organizationId)];

  if (!include_deleted) {
    // `as` justificado: isNull retorna SQL<boolean> compatível com and()
    conditions.push(isNull(cities.deletedAt) as ReturnType<typeof eq>);
  }

  if (state_uf !== undefined) {
    conditions.push(eq(cities.stateUf, state_uf));
  }

  if (is_active !== undefined) {
    conditions.push(eq(cities.isActive, is_active));
  }

  if (search !== undefined && search.length > 0) {
    const pattern = `%${search}%`;
    // `as` justificado: or() com ilike retorna SQL compatível com and()
    conditions.push(
      or(ilike(cities.name, pattern), ilike(cities.nameNormalized, pattern)) as ReturnType<
        typeof eq
      >,
    );
  }

  const where = and(...conditions);

  const [rows, totalRows] = await Promise.all([
    db.select().from(cities).where(where).orderBy(cities.name).limit(limit).offset(offset),
    db.select({ count: count() }).from(cities).where(where),
  ]);

  return {
    data: rows,
    total: totalRows[0]?.count ?? 0,
  };
}

/**
 * Busca cidade pelo ID dentro da organização.
 * Retorna null se não encontrada.
 */
export async function findCityById(
  db: Database,
  id: string,
  organizationId: string,
  includeDeleted = false,
): Promise<City | null> {
  const conditions: ReturnType<typeof eq>[] = [
    eq(cities.id, id),
    eq(cities.organizationId, organizationId),
  ];

  if (!includeDeleted) {
    conditions.push(isNull(cities.deletedAt) as ReturnType<typeof eq>);
  }

  const rows = await db
    .select()
    .from(cities)
    .where(and(...conditions))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Verifica se existe cidade ativa com ibge_code na mesma org.
 * Retorna a cidade existente ou null.
 */
export async function findCityByIbgeCode(
  db: Database,
  ibgeCode: string,
  organizationId: string,
  excludeId?: string,
): Promise<Pick<City, 'id'> | null> {
  const conditions: ReturnType<typeof eq>[] = [
    eq(cities.organizationId, organizationId),
    eq(cities.ibgeCode, ibgeCode),
    isNull(cities.deletedAt) as ReturnType<typeof eq>,
  ];

  if (excludeId !== undefined) {
    const { ne } = await import('drizzle-orm');
    conditions.push(ne(cities.id, excludeId) as ReturnType<typeof eq>);
  }

  const rows = await db
    .select({ id: cities.id })
    .from(cities)
    .where(and(...conditions))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Verifica se existe cidade ativa com slug na mesma org.
 * Retorna a cidade existente ou null.
 */
export async function findCityBySlug(
  db: Database,
  slug: string,
  organizationId: string,
  excludeId?: string,
): Promise<Pick<City, 'id'> | null> {
  const conditions: ReturnType<typeof eq>[] = [
    eq(cities.organizationId, organizationId),
    eq(cities.slug, slug),
    isNull(cities.deletedAt) as ReturnType<typeof eq>,
  ];

  if (excludeId !== undefined) {
    const { ne } = await import('drizzle-orm');
    conditions.push(ne(cities.id, excludeId) as ReturnType<typeof eq>);
  }

  const rows = await db
    .select({ id: cities.id })
    .from(cities)
    .where(and(...conditions))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Insere uma nova cidade.
 * Deve ser chamado dentro de uma transação.
 */
export async function insertCity(db: Database, input: CreateCityInput): Promise<City> {
  const rows = await db
    .insert(cities)
    .values({
      organizationId: input.organizationId,
      name: input.name,
      nameNormalized: input.nameNormalized,
      slug: input.slug,
      aliases: input.aliases,
      ibgeCode: input.ibgeCode ?? null,
      stateUf: input.stateUf,
      isActive: input.isActive,
    })
    .returning();

  const city = rows[0];
  if (!city) {
    throw new Error('Falha ao inserir cidade — insert não retornou linha');
  }
  return city;
}

/**
 * Atualiza campos de uma cidade.
 * Retorna null se não encontrada ou já deletada.
 * Deve ser chamado dentro de uma transação.
 */
export async function updateCity(
  db: Database,
  id: string,
  organizationId: string,
  input: UpdateCityInput,
): Promise<City | null> {
  const rows = await db
    .update(cities)
    .set(input)
    .where(
      and(
        eq(cities.id, id),
        eq(cities.organizationId, organizationId),
        isNull(cities.deletedAt) as ReturnType<typeof eq>,
      ),
    )
    .returning();

  return rows[0] ?? null;
}

/**
 * Soft-delete — seta deleted_at.
 * Retorna null se não encontrada ou já deletada.
 * Deve ser chamado dentro de uma transação.
 */
export async function softDeleteCity(
  db: Database,
  id: string,
  organizationId: string,
): Promise<City | null> {
  const rows = await db
    .update(cities)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(cities.id, id),
        eq(cities.organizationId, organizationId),
        isNull(cities.deletedAt) as ReturnType<typeof eq>,
      ),
    )
    .returning();

  return rows[0] ?? null;
}

/**
 * Restaura uma cidade soft-deleted — limpa deleted_at.
 * Deve ser chamado dentro de uma transação.
 */
export async function restoreCity(
  db: Database,
  id: string,
  organizationId: string,
): Promise<City | null> {
  const rows = await db
    .update(cities)
    .set({ deletedAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(cities.id, id),
        eq(cities.organizationId, organizationId),
        // `as` justificado: isNotNull retorna SQL<boolean> compatível com and()
        isNotNull(cities.deletedAt) as ReturnType<typeof eq>,
      ),
    )
    .returning();

  return rows[0] ?? null;
}
