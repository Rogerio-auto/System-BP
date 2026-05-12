// =============================================================================
// cities/service.ts — Regras de negócio para o domínio de cidades (F1-S06).
//
// Responsabilidades:
//   - Gerar slug (lower + slugify(name)) e nameNormalized (lower + unaccent na app).
//   - Dedupe por ibge_code e slug dentro da organização (pre-INSERT e pre-UPDATE).
//   - Audit log em toda mutação (na mesma transação).
//   - Outbox events na mesma transação (sem PII — cidades são dados públicos).
//
// Escopo:
//   - Admin global (sem city scope). A permissão 'admin:cities:write' é
//     verificada no middleware — o service assume que o actor tem permissão.
//   - Multi-tenant: toda query filtra por organizationId.
//
// Erros:
//   - ibge_code ou slug duplicado → CityConflictError (409)
//   - Recurso não encontrado → NotFoundError (404)
// =============================================================================
import type { Database } from '../../db/client.js';
import type { City } from '../../db/schema/cities.js';
import { emit } from '../../events/emit.js';
import { auditLog } from '../../lib/audit.js';
import type { AuditActor } from '../../lib/audit.js';
import { AppError, ConflictError, NotFoundError } from '../../shared/errors.js';

import {
  findCities,
  findCityById,
  findCityByIbgeCode,
  findCityBySlug,
  insertCity,
  softDeleteCity,
  updateCity,
} from './repository.js';
import type {
  CityCreate,
  CityListQuery,
  CityListResponse,
  CityResponse,
  CityUpdate,
} from './schemas.js';

// ---------------------------------------------------------------------------
// Error customizado: conflito de ibge_code ou slug
// ---------------------------------------------------------------------------

export class CityConflictError extends AppError {
  constructor(field: 'ibge_code' | 'slug') {
    super(
      409,
      'CONFLICT',
      field === 'ibge_code'
        ? 'Já existe uma cidade com este código IBGE nesta organização'
        : 'Já existe uma cidade com este slug nesta organização',
      { field },
    );
    this.name = 'CityConflictError';
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
// Helpers: AuditActor de ActorContext
//
// exactOptionalPropertyTypes exige que campos opcionais não recebam `undefined`
// explicitamente. Construir o objeto com spread condicional garante isso.
// ---------------------------------------------------------------------------

function buildAuditActor(actor: ActorContext): AuditActor {
  return {
    userId: actor.userId,
    role: actor.role,
    // Apenas incluir ip/userAgent quando definidos (exactOptionalPropertyTypes)
    ...(actor.ip !== undefined ? { ip: actor.ip } : {}),
    ...(actor.userAgent !== undefined ? { userAgent: actor.userAgent } : {}),
  };
}

// ---------------------------------------------------------------------------
// Serialização City → CityResponse
// ---------------------------------------------------------------------------

function toCityResponse(city: City): CityResponse {
  return {
    id: city.id,
    organization_id: city.organizationId,
    name: city.name,
    name_normalized: city.nameNormalized,
    aliases: city.aliases,
    slug: city.slug,
    ibge_code: city.ibgeCode ?? null,
    state_uf: city.stateUf,
    is_active: city.isActive,
    created_at: city.createdAt.toISOString(),
    updated_at: city.updatedAt.toISOString(),
    deleted_at: city.deletedAt?.toISOString() ?? null,
  };
}

// ---------------------------------------------------------------------------
// Helpers de geração de slug e name_normalized
// ---------------------------------------------------------------------------

/**
 * Gera um slug URL-safe a partir do nome do município.
 * Ex: "Porto Velho" → "porto-velho"
 * Normaliza acentos via decomposição Unicode.
 */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

/**
 * Gera o name_normalized: sem acentos, lowercase.
 * Alimenta o índice GIN trgm para identify_city (F3).
 * Ex: "Porto Velho" → "porto velho"
 */
export function normalizeNameForIndex(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export async function listCities(
  db: Database,
  actor: ActorContext,
  query: CityListQuery,
): Promise<CityListResponse> {
  const { data, total } = await findCities(db, actor.organizationId, query);

  return {
    data: data.map(toCityResponse),
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

export async function getCityById(
  db: Database,
  actor: ActorContext,
  cityId: string,
): Promise<CityResponse> {
  const city = await findCityById(db, cityId, actor.organizationId);
  if (!city) throw new NotFoundError('Cidade não encontrada');
  return toCityResponse(city);
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createCity(
  db: Database,
  actor: ActorContext,
  body: CityCreate,
): Promise<CityResponse> {
  const nameNormalized = normalizeNameForIndex(body.name);
  const slug = slugify(body.name);

  // Dedupe por ibge_code (se fornecido)
  if (body.ibge_code !== undefined && body.ibge_code !== null) {
    const existing = await findCityByIbgeCode(db, body.ibge_code, actor.organizationId);
    if (existing) throw new CityConflictError('ibge_code');
  }

  // Dedupe por slug
  const existingSlug = await findCityBySlug(db, slug, actor.organizationId);
  if (existingSlug) throw new CityConflictError('slug');

  const city = await db.transaction(async (tx) => {
    let created: City;
    try {
      created = await insertCity(tx as unknown as Database, {
        organizationId: actor.organizationId,
        name: body.name,
        nameNormalized,
        slug,
        aliases: body.aliases,
        ibgeCode: body.ibge_code ?? null,
        stateUf: body.state_uf,
        isActive: body.is_active,
      });
    } catch (err: unknown) {
      // Race condition: dois POSTs concorrentes passam pelo pre-flight e o
      // segundo viola a unique constraint do banco. A DB constraint é autoritativa.
      // Constraint names: uq_cities_org_ibge_active, uq_cities_org_slug_active.
      throw mapUniqueViolation(err);
    }

    // Outbox event — cidades são dados públicos, sem PII
    await emit(tx as unknown as Parameters<typeof emit>[0], {
      eventName: 'cities.created',
      aggregateType: 'city',
      aggregateId: created.id,
      organizationId: actor.organizationId,
      actor: { kind: 'user', id: actor.userId, ip: actor.ip ?? null },
      idempotencyKey: `cities.created:${created.id}`,
      data: {
        city_id: created.id,
        organization_id: actor.organizationId,
        ibge_code: created.ibgeCode ?? null,
        state_uf: created.stateUf,
      },
    });

    // Audit log — cidades não têm PII, sem redact necessário
    await auditLog(tx as unknown as Parameters<typeof auditLog>[0], {
      organizationId: actor.organizationId,
      actor: buildAuditActor(actor),
      action: 'cities.create',
      resource: { type: 'city', id: created.id },
      before: null,
      after: toCityResponse(created) as unknown as Record<string, unknown>,
    });

    return created;
  });

  return toCityResponse(city);
}

// ---------------------------------------------------------------------------
// Update (partial)
// ---------------------------------------------------------------------------

export async function updateCityService(
  db: Database,
  actor: ActorContext,
  cityId: string,
  body: CityUpdate,
): Promise<CityResponse> {
  // Verificar existência
  const before = await findCityById(db, cityId, actor.organizationId);
  if (!before) throw new NotFoundError('Cidade não encontrada');

  // Derivar slug e nameNormalized se name for alterado
  const newName = body.name;
  const nameNormalized = newName !== undefined ? normalizeNameForIndex(newName) : undefined;
  const slug = newName !== undefined ? slugify(newName) : undefined;

  // Dedupe por ibge_code (se fornecido e diferente do atual)
  if (
    body.ibge_code !== undefined &&
    body.ibge_code !== null &&
    body.ibge_code !== before.ibgeCode
  ) {
    const existing = await findCityByIbgeCode(db, body.ibge_code, actor.organizationId, cityId);
    if (existing) throw new CityConflictError('ibge_code');
  }

  // Dedupe por slug (se name mudou)
  if (slug !== undefined && slug !== before.slug) {
    const existingSlug = await findCityBySlug(db, slug, actor.organizationId, cityId);
    if (existingSlug) throw new CityConflictError('slug');
  }

  // Determinar campos alterados para o outbox event
  const changedFields: string[] = [];
  if (body.name !== undefined && body.name !== before.name) changedFields.push('name');
  if (body.aliases !== undefined) changedFields.push('aliases');
  if (body.ibge_code !== undefined && body.ibge_code !== before.ibgeCode)
    changedFields.push('ibge_code');
  if (body.state_uf !== undefined && body.state_uf !== before.stateUf)
    changedFields.push('state_uf');
  if (body.is_active !== undefined && body.is_active !== before.isActive)
    changedFields.push('is_active');

  const after = await db.transaction(async (tx) => {
    let updated: City | undefined;
    try {
      updated =
        (await updateCity(tx as unknown as Database, cityId, actor.organizationId, {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(nameNormalized !== undefined ? { nameNormalized } : {}),
          ...(slug !== undefined ? { slug } : {}),
          ...(body.aliases !== undefined ? { aliases: body.aliases } : {}),
          ...(body.ibge_code !== undefined ? { ibgeCode: body.ibge_code } : {}),
          ...(body.state_uf !== undefined ? { stateUf: body.state_uf } : {}),
          ...(body.is_active !== undefined ? { isActive: body.is_active } : {}),
          updatedAt: new Date(),
        })) ?? undefined;
    } catch (err: unknown) {
      // Race condition em update: dois PATCHes concorrentes alterando para mesmo
      // nome/ibge_code podem ambos passar pelo pre-flight e o segundo viola a constraint.
      // mapUniqueViolation re-lança erros não-unique inalterados.
      throw mapUniqueViolation(err);
    }

    if (!updated) throw new NotFoundError('Cidade não encontrada');

    // Outbox event
    await emit(tx as unknown as Parameters<typeof emit>[0], {
      eventName: 'cities.updated',
      aggregateType: 'city',
      aggregateId: cityId,
      organizationId: actor.organizationId,
      actor: { kind: 'user', id: actor.userId, ip: actor.ip ?? null },
      // Chave determinística: retry com mesmo updatedAt → mesma chave → deduplicado.
      // Se houver update concorrente entre retries, updatedAt muda → 2 chaves legítimas.
      idempotencyKey: `cities.updated:${cityId}:${updated.updatedAt.getTime()}`,
      data: {
        city_id: cityId,
        organization_id: actor.organizationId,
        changed_fields: changedFields,
      },
    });

    // Audit log
    await auditLog(tx as unknown as Parameters<typeof auditLog>[0], {
      organizationId: actor.organizationId,
      actor: buildAuditActor(actor),
      action: 'cities.update',
      resource: { type: 'city', id: cityId },
      before: toCityResponse(before) as unknown as Record<string, unknown>,
      after: toCityResponse(updated) as unknown as Record<string, unknown>,
    });

    return updated;
  });

  return toCityResponse(after);
}

// ---------------------------------------------------------------------------
// Delete (soft)
// ---------------------------------------------------------------------------

export async function deleteCityService(
  db: Database,
  actor: ActorContext,
  cityId: string,
): Promise<void> {
  const before = await findCityById(db, cityId, actor.organizationId);
  if (!before) throw new NotFoundError('Cidade não encontrada');

  await db.transaction(async (tx) => {
    const deleted = await softDeleteCity(tx as unknown as Database, cityId, actor.organizationId);
    if (!deleted) throw new NotFoundError('Cidade não encontrada');

    // Outbox event
    await emit(tx as unknown as Parameters<typeof emit>[0], {
      eventName: 'cities.deleted',
      aggregateType: 'city',
      aggregateId: cityId,
      organizationId: actor.organizationId,
      actor: { kind: 'user', id: actor.userId, ip: actor.ip ?? null },
      // Chave determinística: deletedAt preenchido pelo soft-delete; retry com mesmo
      // registro → mesma chave → deduplicado pelo outbox worker.
      idempotencyKey: `cities.deleted:${cityId}:${deleted.deletedAt!.getTime()}`,
      data: {
        city_id: cityId,
        organization_id: actor.organizationId,
        soft: true as const,
      },
    });

    // Audit log
    await auditLog(tx as unknown as Parameters<typeof auditLog>[0], {
      organizationId: actor.organizationId,
      actor: buildAuditActor(actor),
      action: 'cities.delete',
      resource: { type: 'city', id: cityId },
      before: toCityResponse(before) as unknown as Record<string, unknown>,
      after: null,
    });
  });
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/**
 * Verifica se um erro é violação de unique constraint do PostgreSQL (code 23505).
 */
function isPgUniqueViolation(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;
  const code = 'code' in err ? (err as { code: unknown }).code : undefined;
  return code === '23505';
}

/**
 * Extrai o nome da constraint de um erro pg e mapeia para o AppError correto.
 *
 * Constraint names definidos em apps/api/src/db/schema/cities.ts:
 *   - uq_cities_org_ibge_active  → ibge_code duplicado
 *   - uq_cities_org_slug_active  → slug duplicado
 *
 * Qualquer outra violação de unique é re-lançada como ConflictError genérico
 * (não esconde o problema, mas evita vazar detalhes internos).
 *
 * Se o erro não for uma violação de unique, é re-lançado inalterado.
 */
function mapUniqueViolation(err: unknown): AppError {
  if (!isPgUniqueViolation(err)) throw err;
  const constraint = (err as { constraint?: string }).constraint ?? '';
  if (constraint.includes('ibge')) return new CityConflictError('ibge_code');
  if (constraint.includes('slug')) return new CityConflictError('slug');
  return new ConflictError('Conflito de chave única não mapeado', { constraint });
}
