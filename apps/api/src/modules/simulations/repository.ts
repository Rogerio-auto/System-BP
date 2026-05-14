// =============================================================================
// simulations/repository.ts — Queries Drizzle para simulações de crédito.
//
// Responsabilidades:
//   - INSERT credit_simulations (imutável após criação — sem UPDATE).
//   - UPDATE leads.last_simulation_id (aponta para a última simulação).
//   - UPDATE kanban_cards.last_simulation_id (denormalizado para board queries).
//   - Busca de lead com cityScope RBAC.
//   - Busca de produto ativo por ID + org.
//   - Busca de regra ativa por produto + city_id (respeitando precedência de scope).
//
// Invariantes:
//   - Simulações são imutáveis após criação (tabela sem updated_at por design).
//   - leads/kanban_cards são atualizados DENTRO da mesma transação.
//
// LGPD: lead_id é referência opaca — não logar contexto do lead nos queries.
// =============================================================================
import { and, eq, isNull, sql, type or } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { creditProductRules } from '../../db/schema/creditProductRules.js';
import type { CreditProductRule } from '../../db/schema/creditProductRules.js';
import { creditProducts } from '../../db/schema/creditProducts.js';
import type { CreditProduct } from '../../db/schema/creditProducts.js';
import { creditSimulations } from '../../db/schema/creditSimulations.js';
import type { CreditSimulation, NewCreditSimulation } from '../../db/schema/creditSimulations.js';
import { kanbanCards } from '../../db/schema/kanbanCards.js';
import { leads } from '../../db/schema/leads.js';
import type { Lead } from '../../db/schema/leads.js';

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface InsertSimulationInput {
  organizationId: string;
  leadId: string;
  productId: string;
  ruleVersionId: string;
  amountRequested: string;
  termMonths: number;
  monthlyPayment: string;
  totalAmount: string;
  totalInterest: string;
  rateMonthlySnapshot: string;
  amortizationTable: unknown;
  origin: 'manual' | 'ai' | 'import';
  createdByUserId?: string | null;
  idempotencyKey?: string | null;
}

// ---------------------------------------------------------------------------
// Lead queries
// ---------------------------------------------------------------------------

/**
 * Busca lead por ID dentro da org e escopo de cidade.
 *
 * City scope RBAC:
 *   - cityScopeIds === null → admin/gestor_geral, sem filtro extra.
 *   - cityScopeIds === []   → sem acesso a cidade alguma → retorna null.
 *   - cityScopeIds: string[] → WHERE city_id IN (...).
 *
 * Retorna null se não encontrado, deletado ou fora do scope.
 */
export async function findLeadForSimulation(
  db: Database,
  leadId: string,
  organizationId: string,
  cityScopeIds: string[] | null,
): Promise<Lead | null> {
  const conditions: ReturnType<typeof eq>[] = [
    eq(leads.id, leadId),
    eq(leads.organizationId, organizationId),
    // `as` justificado: isNull retorna SQL<boolean> compatível com and()
    isNull(leads.deletedAt) as ReturnType<typeof eq>,
  ];

  if (cityScopeIds !== null) {
    if (cityScopeIds.length === 0) {
      // Sem scope de cidade → acesso negado
      return null;
    }
    // `as` justificado: sql<boolean> compatível com and()
    conditions.push(
      sql`${leads.cityId} = ANY(ARRAY[${sql.join(
        cityScopeIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )}])` as ReturnType<typeof eq>,
    );
  }

  const rows = await db
    .select()
    .from(leads)
    .where(and(...conditions))
    .limit(1);

  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Product queries
// ---------------------------------------------------------------------------

/**
 * Busca produto de crédito ativo por ID dentro da organização.
 * Retorna null se não encontrado, inativo ou deletado.
 */
export async function findActiveProduct(
  db: Database,
  productId: string,
  organizationId: string,
): Promise<CreditProduct | null> {
  const rows = await db
    .select()
    .from(creditProducts)
    .where(
      and(
        eq(creditProducts.id, productId),
        eq(creditProducts.organizationId, organizationId),
        eq(creditProducts.isActive, true),
        isNull(creditProducts.deletedAt) as ReturnType<typeof eq>,
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Rule queries
// ---------------------------------------------------------------------------

/**
 * Busca a regra ativa mais adequada para o produto dado o city_id do lead.
 *
 * Precedência (doc 05 §"Crédito"):
 *   1. Regra com lead.city_id contido em city_scope → específica para a cidade.
 *   2. Regra com city_scope IS NULL → regra global (fallback).
 *   3. Nenhuma regra → retorna null (409 na service layer).
 *
 * Somente regras is_active=true são consideradas.
 */
export async function findActiveRuleForCity(
  db: Database,
  productId: string,
  cityId: string,
): Promise<CreditProductRule | null> {
  // 1. Regra específica para a cidade: city_scope IS NOT NULL AND cityId IN city_scope
  const specificRows = await db
    .select()
    .from(creditProductRules)
    .where(
      and(
        eq(creditProductRules.productId, productId),
        eq(creditProductRules.isActive, true),
        // city_scope IS NOT NULL
        sql`${creditProductRules.cityScope} IS NOT NULL` as ReturnType<typeof eq>,
        // cityId = ANY(city_scope) — Postgres syntax para arrays
        sql`${sql`${cityId}::uuid`} = ANY(${creditProductRules.cityScope})` as ReturnType<
          typeof eq
        >,
      ),
    )
    .limit(1);

  if (specificRows[0] !== undefined) {
    return specificRows[0];
  }

  // 2. Regra global: city_scope IS NULL
  const globalRows = await db
    .select()
    .from(creditProductRules)
    .where(
      and(
        eq(creditProductRules.productId, productId),
        eq(creditProductRules.isActive, true),
        isNull(creditProductRules.cityScope) as ReturnType<typeof eq>,
      ),
    )
    .limit(1);

  return globalRows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Simulation queries
// ---------------------------------------------------------------------------

/**
 * Insere nova simulação. Deve ser chamado dentro de transação.
 * Simulações são imutáveis após criação — sem UPDATE.
 */
export async function insertSimulation(
  db: Database,
  input: InsertSimulationInput,
): Promise<CreditSimulation> {
  const values: NewCreditSimulation = {
    organizationId: input.organizationId,
    leadId: input.leadId,
    productId: input.productId,
    ruleVersionId: input.ruleVersionId,
    amountRequested: input.amountRequested,
    termMonths: input.termMonths,
    monthlyPayment: input.monthlyPayment,
    totalAmount: input.totalAmount,
    totalInterest: input.totalInterest,
    rateMonthlySnapshot: input.rateMonthlySnapshot,
    amortizationTable: input.amortizationTable,
    origin: input.origin,
    ...(input.createdByUserId !== undefined ? { createdByUserId: input.createdByUserId } : {}),
  };

  const rows = await db.insert(creditSimulations).values(values).returning();
  const simulation = rows[0];
  if (!simulation) throw new Error('Falha ao inserir simulação de crédito');
  return simulation;
}

/**
 * Atualiza last_simulation_id no lead.
 * Deve ser chamado dentro de transação (mesma que insertSimulation).
 */
export async function updateLeadLastSimulation(
  db: Database,
  leadId: string,
  simulationId: string,
): Promise<void> {
  await db.update(leads).set({ lastSimulationId: simulationId }).where(eq(leads.id, leadId));
}

/**
 * Atualiza last_simulation_id no kanban_card vinculado ao lead.
 * Deve ser chamado dentro de transação (mesma que insertSimulation).
 * Não falha se o lead não tiver card associado.
 */
export async function updateKanbanCardLastSimulation(
  db: Database,
  leadId: string,
  simulationId: string,
): Promise<void> {
  await db
    .update(kanbanCards)
    .set({ lastSimulationId: simulationId })
    .where(eq(kanbanCards.leadId, leadId));
}

/**
 * Busca simulação por ID dentro da organização.
 * Retorna null se não encontrada.
 */
export async function findSimulationById(
  db: Database,
  id: string,
  organizationId: string,
): Promise<CreditSimulation | null> {
  const rows = await db
    .select()
    .from(creditSimulations)
    .where(
      and(
        eq(creditSimulations.id, id),
        eq(creditSimulations.organizationId, organizationId),
      ) as ReturnType<typeof or>,
    )
    .limit(1);

  return rows[0] ?? null;
}
