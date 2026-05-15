// =============================================================================
// agents/repository.ts — Queries Drizzle para agentes e agent_cities (F8-S01).
//
// Responsabilidades:
//   - CRUD de agents (soft-delete via deleted_at).
//   - Gestão atômica de agent_cities (substituição completa via transação).
//   - Filtro por cidade (applyCityScope via agent_cities).
//   - Verificação de "último agente ativo de cidade com leads abertos".
//
// Multi-tenant: todas as queries filtram por organizationId.
// City scope: list aplica intersecção com user.cityScopeIds (via agent_cities).
//
// LGPD: phone é dado pessoal de colaborador (art. 7°, IX — legítimo interesse).
//   Não é exposto a leads/clientes. Tratado como interno.
//
// Segurança — oracle de existência (docs/10 §3.5):
//   GET-by-id com escopo de cidade: se não encontrar, lança NotFoundError (404).
//   Nunca ForbiddenError (403) — previne confirmar existência de recurso.
// =============================================================================
import { and, count, eq, ilike, inArray, isNull, sql } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { agentCities } from '../../db/schema/agent_cities.js';
import type { AgentCity, NewAgentCity } from '../../db/schema/agent_cities.js';
import { agents } from '../../db/schema/agents.js';
import type { Agent, NewAgent } from '../../db/schema/agents.js';
import { leads } from '../../db/schema/leads.js';
import type { UserScopeCtx } from '../../shared/scope.js';

import type { AgentListQuery } from './schemas.js';

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

export interface AgentWithCities {
  agent: Agent;
  cities: AgentCity[];
}

export interface PaginatedAgents {
  data: AgentWithCities[];
  total: number;
}

export interface CreateAgentInput {
  organizationId: string;
  displayName: string;
  phone?: string | null;
  userId?: string | null;
}

export interface UpdateAgentInput {
  displayName?: string;
  phone?: string | null;
  userId?: string | null;
  isActive?: boolean;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

/**
 * Lista agentes da organização com paginação e filtros opcionais.
 *
 * City scope:
 *   - null   → admin global, sem filtro.
 *   - []     → sem cidade configurada → zero resultados.
 *   - [...]  → apenas agentes com ao menos uma cidade no escopo.
 *
 * Filtro por cityId: se informado, só retorna agentes vinculados à cidade.
 */
export async function findAgents(
  db: Database,
  organizationId: string,
  query: AgentListQuery,
  scopeCtx: UserScopeCtx,
): Promise<PaginatedAgents> {
  const { page, limit, cityId, isActive, q } = query;
  const offset = (page - 1) * limit;

  // --- Condições base ---
  // `as` justificado: and() aceita SQL<boolean>, eq/isNull retornam tipos compatíveis
  const conditions: ReturnType<typeof eq>[] = [
    eq(agents.organizationId, organizationId),
    isNull(agents.deletedAt) as ReturnType<typeof eq>,
  ];

  if (isActive !== undefined) {
    conditions.push(eq(agents.isActive, isActive));
  }

  if (q !== undefined && q.length > 0) {
    const pattern = `%${q}%`;
    conditions.push(ilike(agents.displayName, pattern) as ReturnType<typeof eq>);
  }

  // --- City scope: escopo do usuário autenticado ---
  const { cityScopeIds } = scopeCtx;
  if (cityScopeIds !== null && cityScopeIds.length === 0) {
    // Sem cidade configurada → zero resultados
    return { data: [], total: 0 };
  }

  const where = and(...conditions);

  // Busca IDs de agentes que passam nos filtros base
  const agentRows = await db
    .select({ id: agents.id })
    .from(agents)
    .where(where)
    .orderBy(agents.displayName);

  if (agentRows.length === 0) {
    return { data: [], total: 0 };
  }

  const allAgentIds = agentRows.map((r) => r.id);

  // Busca agent_cities para calcular filtragens
  const allCities = await db
    .select()
    .from(agentCities)
    .where(inArray(agentCities.agentId, allAgentIds));

  // Filtrar por cityId explícito
  let filteredAgentIds = allAgentIds;

  if (cityId !== undefined) {
    const agentsInCity = new Set(
      allCities.filter((c) => c.cityId === cityId).map((c) => c.agentId),
    );
    filteredAgentIds = filteredAgentIds.filter((id) => agentsInCity.has(id));
  }

  // Filtrar por escopo do usuário (intersecção de cidades)
  if (cityScopeIds !== null) {
    const scopeSet = new Set(cityScopeIds);
    const agentsInScope = new Set(
      allCities.filter((c) => scopeSet.has(c.cityId)).map((c) => c.agentId),
    );
    filteredAgentIds = filteredAgentIds.filter((id) => agentsInScope.has(id));
  }

  const total = filteredAgentIds.length;

  // Paginar sobre IDs filtrados
  const pagedIds = filteredAgentIds.slice(offset, offset + limit);
  if (pagedIds.length === 0) {
    return { data: [], total };
  }

  // Busca agentes completos + cidades dos agentes paginados
  const [pagedAgents, pagedCities] = await Promise.all([
    db
      .select()
      .from(agents)
      .where(
        // `as` justificado: inArray retorna SQL<boolean> compatível com and()
        and(
          isNull(agents.deletedAt) as ReturnType<typeof eq>,
          inArray(agents.id, pagedIds) as ReturnType<typeof eq>,
        ),
      )
      .orderBy(agents.displayName),
    db.select().from(agentCities).where(inArray(agentCities.agentId, pagedIds)),
  ]);

  // Montar mapa de cidades por agente
  const citiesMap = new Map<string, AgentCity[]>();
  for (const city of pagedCities) {
    const existing = citiesMap.get(city.agentId) ?? [];
    existing.push(city);
    citiesMap.set(city.agentId, existing);
  }

  return {
    data: pagedAgents.map((agent) => ({
      agent,
      cities: citiesMap.get(agent.id) ?? [],
    })),
    total,
  };
}

// ---------------------------------------------------------------------------
// Find by ID
// ---------------------------------------------------------------------------

/**
 * Busca agente pelo ID dentro da organização.
 * Retorna null se não encontrado ou soft-deleted.
 */
export async function findAgentById(
  db: Database,
  id: string,
  organizationId: string,
  includeDeleted = false,
): Promise<AgentWithCities | null> {
  const conditions: ReturnType<typeof eq>[] = [
    eq(agents.id, id),
    eq(agents.organizationId, organizationId),
  ];

  if (!includeDeleted) {
    conditions.push(isNull(agents.deletedAt) as ReturnType<typeof eq>);
  }

  const rows = await db
    .select()
    .from(agents)
    .where(and(...conditions))
    .limit(1);

  const agent = rows[0];
  if (!agent) return null;

  const cities = await db.select().from(agentCities).where(eq(agentCities.agentId, id));

  return { agent, cities };
}

// ---------------------------------------------------------------------------
// Insert
// ---------------------------------------------------------------------------

/**
 * Insere um agente. Deve ser chamado dentro de transação.
 */
export async function insertAgent(db: Database, input: CreateAgentInput): Promise<Agent> {
  const values: NewAgent = {
    organizationId: input.organizationId,
    displayName: input.displayName,
    // exactOptionalPropertyTypes: só incluir campos opcionais quando definidos
    ...(input.phone !== undefined ? { phone: input.phone } : {}),
    ...(input.userId !== undefined ? { userId: input.userId } : {}),
  };

  const rows = await db.insert(agents).values(values).returning();
  const agent = rows[0];
  if (!agent) throw new Error('Falha ao inserir agente');
  return agent;
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

/**
 * Atualiza campos do agente. Deve ser chamado dentro de transação.
 */
export async function updateAgent(
  db: Database,
  id: string,
  organizationId: string,
  input: UpdateAgentInput,
): Promise<Agent | null> {
  const rows = await db
    .update(agents)
    .set(input)
    .where(
      and(
        eq(agents.id, id),
        eq(agents.organizationId, organizationId),
        isNull(agents.deletedAt) as ReturnType<typeof eq>,
      ),
    )
    .returning();

  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Deactivate / Reactivate
// ---------------------------------------------------------------------------

/**
 * Soft-delete do agente (is_active=false + deleted_at).
 * Preserva FK em leads.agent_id.
 * Deve ser chamado dentro de transação.
 */
export async function deactivateAgent(
  db: Database,
  id: string,
  organizationId: string,
): Promise<Agent | null> {
  const rows = await db
    .update(agents)
    .set({ isActive: false, deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(agents.id, id),
        eq(agents.organizationId, organizationId),
        isNull(agents.deletedAt) as ReturnType<typeof eq>,
      ),
    )
    .returning();

  return rows[0] ?? null;
}

/**
 * Reativa agente (is_active=true, limpa deleted_at).
 * Busca por id + org independente de deleted_at.
 * Deve ser chamado dentro de transação.
 */
export async function reactivateAgent(
  db: Database,
  id: string,
  organizationId: string,
): Promise<Agent | null> {
  const rows = await db
    .update(agents)
    .set({ isActive: true, deletedAt: null, updatedAt: new Date() })
    .where(and(eq(agents.id, id), eq(agents.organizationId, organizationId)))
    .returning();

  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Agent cities: set (substituição atômica)
// ---------------------------------------------------------------------------

/**
 * Substitui o conjunto completo de agent_cities atomicamente.
 * Delete-all + insert. Deve ser chamado dentro de transação.
 */
export async function replaceAgentCities(
  db: Database,
  agentId: string,
  cityInputs: Array<{ cityId: string; isPrimary: boolean }>,
): Promise<AgentCity[]> {
  // 1. Deletar todas as entradas existentes
  await db.delete(agentCities).where(eq(agentCities.agentId, agentId));

  if (cityInputs.length === 0) return [];

  // 2. Inserir novas
  const values: NewAgentCity[] = cityInputs.map(({ cityId, isPrimary }) => ({
    agentId,
    cityId,
    isPrimary,
  }));

  const rows = await db.insert(agentCities).values(values).returning();
  return rows;
}

// ---------------------------------------------------------------------------
// Verificação: último agente ativo de cidade com leads abertos
// ---------------------------------------------------------------------------

/**
 * Conta quantos agentes ATIVOS (is_active=true, deleted_at IS NULL) cobrem
 * a cidade `cityId` dentro da organização — excluindo o agente `excludeAgentId`.
 *
 * Usado para bloquear desativação do último agente ativo de uma cidade
 * que possui leads abertos (status 'new' ou 'qualifying').
 */
export async function countActiveAgentsInCity(
  db: Database,
  cityId: string,
  organizationId: string,
  excludeAgentId: string,
): Promise<number> {
  const rows = await db
    .select({ count: count() })
    .from(agentCities)
    .innerJoin(agents, eq(agentCities.agentId, agents.id))
    .where(
      and(
        eq(agentCities.cityId, cityId),
        eq(agents.organizationId, organizationId),
        eq(agents.isActive, true),
        isNull(agents.deletedAt) as ReturnType<typeof eq>,
        // `as` justificado: sql`` retorna SQL<boolean> compatível com and()
        sql`${agents.id} != ${excludeAgentId}::uuid` as ReturnType<typeof eq>,
      ),
    );

  return rows[0]?.count ?? 0;
}

/**
 * Conta leads com status 'new' ou 'qualifying' atribuídos a cidades
 * cobertas pelo agente (excluindo o próprio agente para fins de bloqueio).
 *
 * Se o agente for o único ativo em uma cidade E existirem leads abertos,
 * a desativação deve ser bloqueada com 409.
 */
export async function countOpenLeadsInCitiesWithSingleAgent(
  db: Database,
  agentId: string,
  organizationId: string,
): Promise<{ cityId: string; openLeadCount: number }[]> {
  // Buscar cidades do agente
  const agentCityRows = await db
    .select({ cityId: agentCities.cityId })
    .from(agentCities)
    .where(eq(agentCities.agentId, agentId));

  if (agentCityRows.length === 0) return [];

  const results: { cityId: string; openLeadCount: number }[] = [];

  for (const { cityId } of agentCityRows) {
    // Verificar quantos outros agentes ativos cobrem essa cidade
    const otherActiveCount = await countActiveAgentsInCity(db, cityId, organizationId, agentId);

    if (otherActiveCount > 0) {
      // Há outros agentes ativos nessa cidade — desativação não bloqueia esta cidade
      continue;
    }

    // É o único agente ativo nessa cidade. Verificar leads abertos.
    const openLeads = await db
      .select({ count: count() })
      .from(leads)
      .where(
        and(
          eq(leads.organizationId, organizationId),
          eq(leads.cityId, cityId),
          isNull(leads.deletedAt) as ReturnType<typeof eq>,
          // `as` justificado: sql`` retorna SQL<boolean> compatível com and()
          sql`${leads.status} IN ('new', 'qualifying')` as ReturnType<typeof eq>,
        ),
      );

    const openLeadCount = openLeads[0]?.count ?? 0;
    if (openLeadCount > 0) {
      results.push({ cityId, openLeadCount });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Verificação: userId pertence à organização
// ---------------------------------------------------------------------------

/**
 * Verifica se userId pertence à organização (para validação de FK).
 */
export async function userBelongsToOrg(
  db: Database,
  userId: string,
  organizationId: string,
): Promise<boolean> {
  const { users } = await import('../../db/schema/users.js');
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, userId),
        eq(users.organizationId, organizationId),
        isNull(users.deletedAt) as ReturnType<typeof eq>,
      ),
    )
    .limit(1);

  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Verificação: cityIds existem na org
// ---------------------------------------------------------------------------

/**
 * Valida que todos os IDs em cityIds existem como cidades ativas da organização.
 * Retorna lista de IDs inválidos.
 */
export async function findInvalidCityIds(
  db: Database,
  cityIds: string[],
  organizationId: string,
): Promise<string[]> {
  if (cityIds.length === 0) return [];

  const { cities } = await import('../../db/schema/cities.js');
  const found = await db
    .select({ id: cities.id })
    .from(cities)
    .where(
      and(
        eq(cities.organizationId, organizationId),
        inArray(cities.id, cityIds) as ReturnType<typeof eq>,
        isNull(cities.deletedAt) as ReturnType<typeof eq>,
      ),
    );

  const foundSet = new Set(found.map((r) => r.id));
  return cityIds.filter((id) => !foundSet.has(id));
}
