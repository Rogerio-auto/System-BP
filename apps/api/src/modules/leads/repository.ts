// =============================================================================
// leads/repository.ts — Queries Drizzle para o domínio de leads (F1-S11).
//
// Todas as queries recebem `db` por injeção de dependência para facilitar
// testes unitários (mock do db).
//
// City Scope (RBAC multi-cidade):
//   - cityScopeIds === null  → acesso global (admin/gestor_geral): sem filtro extra.
//   - cityScopeIds === []    → sem acesso a cidade alguma: retorna vazio.
//   - cityScopeIds: string[] → WHERE city_id IN (...) — aplicado pelo helper
//     applyCityScope(conditions, cityScopeIds) definido abaixo.
//
// Soft-delete:
//   - Listagem e reads ignoram registros com deleted_at IS NOT NULL por padrão.
//   - findLeadById aceita flag `includeDeleted` para a operação de restore.
//   - Delete seta deleted_at, não remove fisicamente.
//
// LGPD (doc 17 §8.1):
//   - Queries nunca retornam cpf_encrypted nem cpf_hash.
//   - O select explícito exclui esses campos da resposta.
// =============================================================================
import { and, count, eq, ilike, inArray, isNull, isNotNull, or, sql } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { leads } from '../../db/schema/leads.js';
import type { Lead } from '../../db/schema/leads.js';

import type { LeadListQuery } from './schemas.js';

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

export interface PaginatedLeads {
  data: Lead[];
  total: number;
}

export interface CreateLeadInput {
  organizationId: string;
  cityId: string;
  agentId?: string | null;
  name: string;
  phoneE164: string;
  phoneNormalized: string;
  source: 'whatsapp' | 'manual' | 'import' | 'chatwoot' | 'api';
  status: 'new' | 'qualifying' | 'simulation' | 'closed_won' | 'closed_lost' | 'archived';
  email?: string | null;
  /**
   * cpf_hash: HMAC-SHA256 do CPF normalizado.
   * LGPD: cpf bruto nunca é persistido — apenas o hash.
   */
  cpfHash?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown>;
}

export interface UpdateLeadInput {
  cityId?: string;
  agentId?: string | null;
  name?: string;
  source?: 'whatsapp' | 'manual' | 'import' | 'chatwoot' | 'api';
  status?: 'new' | 'qualifying' | 'simulation' | 'closed_won' | 'closed_lost' | 'archived';
  email?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown>;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// City scope helper
// ---------------------------------------------------------------------------

/**
 * Aplica filtro de escopo de cidade nas condições de query.
 *
 * @param cityScopeIds  null = sem restrição (admin), string[] = lista de cities permitidas.
 *
 * Segurança RBAC (doc 10 §3):
 *   - null: admin/gestor_geral vê todos os leads da org.
 *   - []: sem scope → nenhuma cidade acessível → retorna condição never (1=0).
 *   - string[]: WHERE city_id IN (...cityIds...).
 *
 * Retorna SQL condition ou null (sem restrição).
 */
function buildCityScopeCondition(
  cityScopeIds: string[] | null,
): ReturnType<typeof inArray> | ReturnType<typeof sql> | null {
  if (cityScopeIds === null) {
    // Acesso global — sem filtro adicional
    return null;
  }

  if (cityScopeIds.length === 0) {
    // Sem scope de cidade: retorna condição falsa — nenhuma row atende.
    // `as` justificado: sql<boolean> é compatível com SQL condition no Drizzle.
    return sql`1 = 0` as ReturnType<typeof sql>;
  }

  return inArray(leads.cityId, cityScopeIds);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Lista leads da org com paginação, filtros e escopo de cidade.
 * Exclui leads deletados (deleted_at IS NULL).
 */
export async function findLeads(
  db: Database,
  organizationId: string,
  cityScopeIds: string[] | null,
  query: LeadListQuery,
): Promise<PaginatedLeads> {
  const { page, limit, search, status, city_id, agent_id, source } = query;
  const offset = (page - 1) * limit;

  const conditions: ReturnType<typeof eq>[] = [
    eq(leads.organizationId, organizationId),
    // `as` justificado: isNull retorna SQL<boolean> compatível com and()
    isNull(leads.deletedAt) as ReturnType<typeof eq>,
  ];

  // City scope RBAC
  const scopeCondition = buildCityScopeCondition(cityScopeIds);
  if (scopeCondition !== null) {
    conditions.push(scopeCondition as ReturnType<typeof eq>);
  }

  if (status !== undefined) {
    conditions.push(eq(leads.status, status));
  }

  if (city_id !== undefined) {
    conditions.push(eq(leads.cityId, city_id));
  }

  if (agent_id !== undefined) {
    conditions.push(eq(leads.agentId, agent_id));
  }

  if (source !== undefined) {
    conditions.push(eq(leads.source, source));
  }

  if (search !== undefined && search.length > 0) {
    const pattern = `%${search}%`;
    // `as` justificado: or() com ilike retorna SQL compatível com and()
    conditions.push(
      or(ilike(leads.name, pattern), ilike(leads.phoneE164, pattern)) as ReturnType<typeof eq>,
    );
  }

  const where = and(...conditions);

  const [rows, totalRows] = await Promise.all([
    db.select().from(leads).where(where).orderBy(leads.createdAt).limit(limit).offset(offset),
    db.select({ count: count() }).from(leads).where(where),
  ]);

  return {
    data: rows,
    total: totalRows[0]?.count ?? 0,
  };
}

/**
 * Busca um lead pelo ID dentro da organização e escopo de cidade.
 * Retorna null se não encontrado, deletado ou fora do scope.
 *
 * Segurança: retorna 404 em vez de 403 para não vazar existência do recurso.
 *
 * @param includeDeleted Se true, inclui leads com deleted_at IS NOT NULL (para restore).
 */
export async function findLeadById(
  db: Database,
  id: string,
  organizationId: string,
  cityScopeIds: string[] | null,
  includeDeleted = false,
): Promise<Lead | null> {
  const conditions: ReturnType<typeof eq>[] = [
    eq(leads.id, id),
    eq(leads.organizationId, organizationId),
  ];

  if (!includeDeleted) {
    conditions.push(isNull(leads.deletedAt) as ReturnType<typeof eq>);
  }

  // City scope RBAC — no findById também (não vazar existência fora do scope)
  const scopeCondition = buildCityScopeCondition(cityScopeIds);
  if (scopeCondition !== null) {
    conditions.push(scopeCondition as ReturnType<typeof eq>);
  }

  const rows = await db
    .select()
    .from(leads)
    .where(and(...conditions))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Verifica se existe lead ativo com phone_normalized na mesma org.
 * Usado para dedupe antes do INSERT.
 * Parcial unique index na DB também protege em race condition.
 *
 * @returns Lead existente ou null se não houver duplicata.
 */
export async function findLeadByPhoneInOrg(
  db: Database,
  phoneNormalized: string,
  organizationId: string,
): Promise<Pick<Lead, 'id'> | null> {
  const rows = await db
    .select({ id: leads.id })
    .from(leads)
    .where(
      and(
        eq(leads.organizationId, organizationId),
        eq(leads.phoneNormalized, phoneNormalized),
        isNull(leads.deletedAt),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Verifica se existe lead ativo com phone_normalized na mesma org,
 * excluindo um ID específico. Usado para validar restore sem conflito.
 */
export async function findLeadByPhoneInOrgExcluding(
  db: Database,
  phoneNormalized: string,
  organizationId: string,
  excludeId: string,
): Promise<Pick<Lead, 'id'> | null> {
  const { ne } = await import('drizzle-orm');

  const rows = await db
    .select({ id: leads.id })
    .from(leads)
    .where(
      and(
        eq(leads.organizationId, organizationId),
        eq(leads.phoneNormalized, phoneNormalized),
        isNull(leads.deletedAt),
        ne(leads.id, excludeId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Insere um novo lead.
 * Deve ser chamado dentro de uma transação.
 * A constraint UNIQUE parcial da DB protege contra race conditions de dedupe.
 */
export async function insertLead(db: Database, input: CreateLeadInput): Promise<Lead> {
  const rows = await db
    .insert(leads)
    .values({
      organizationId: input.organizationId,
      cityId: input.cityId,
      agentId: input.agentId ?? null,
      name: input.name,
      phoneE164: input.phoneE164,
      phoneNormalized: input.phoneNormalized,
      source: input.source,
      status: input.status,
      email: input.email ?? null,
      cpfHash: input.cpfHash ?? null,
      notes: input.notes ?? null,
      metadata: input.metadata ?? {},
    })
    .returning();

  const lead = rows[0];
  if (!lead) {
    throw new Error('Falha ao inserir lead — insert não retornou linha');
  }
  return lead;
}

/**
 * Atualiza campos de um lead.
 * Retorna null se não encontrado ou fora do scope.
 * Deve ser chamado dentro de uma transação.
 */
export async function updateLead(
  db: Database,
  id: string,
  organizationId: string,
  cityScopeIds: string[] | null,
  input: UpdateLeadInput,
): Promise<Lead | null> {
  const conditions: ReturnType<typeof eq>[] = [
    eq(leads.id, id),
    eq(leads.organizationId, organizationId),
    isNull(leads.deletedAt) as ReturnType<typeof eq>,
  ];

  const scopeCondition = buildCityScopeCondition(cityScopeIds);
  if (scopeCondition !== null) {
    conditions.push(scopeCondition as ReturnType<typeof eq>);
  }

  const rows = await db
    .update(leads)
    .set(input)
    .where(and(...conditions))
    .returning();

  return rows[0] ?? null;
}

/**
 * Soft delete — seta deleted_at.
 * Retorna null se não encontrado ou fora do scope.
 * Deve ser chamado dentro de uma transação.
 */
export async function softDeleteLead(
  db: Database,
  id: string,
  organizationId: string,
  cityScopeIds: string[] | null,
): Promise<Lead | null> {
  const conditions: ReturnType<typeof eq>[] = [
    eq(leads.id, id),
    eq(leads.organizationId, organizationId),
    isNull(leads.deletedAt) as ReturnType<typeof eq>,
  ];

  const scopeCondition = buildCityScopeCondition(cityScopeIds);
  if (scopeCondition !== null) {
    conditions.push(scopeCondition as ReturnType<typeof eq>);
  }

  const rows = await db
    .update(leads)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(...conditions))
    .returning();

  return rows[0] ?? null;
}

/**
 * Restaura um lead soft-deleted — limpa deleted_at.
 * Não aplica city scope aqui (já verificado no service antes de chamar).
 * Deve ser chamado dentro de uma transação.
 */
export async function restoreLead(
  db: Database,
  id: string,
  organizationId: string,
): Promise<Lead | null> {
  const rows = await db
    .update(leads)
    .set({ deletedAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(leads.id, id),
        eq(leads.organizationId, organizationId),
        // `as` justificado: isNotNull retorna SQL<boolean> compatível com and()
        isNotNull(leads.deletedAt) as ReturnType<typeof eq>,
      ),
    )
    .returning();

  return rows[0] ?? null;
}
