// =============================================================================
// customers/repository.ts — Queries Drizzle para visão consolidada do cliente (F17-S07).
//
// Responsabilidades:
//   - getCustomerOverview: agrega customer + contratos + boleto_health + recent_dues
//     em 3 queries (sem N+1).
//
// City-scope:
//   customers não tem city_id direto — o scope é via customers → leads (primary_lead_id).
//   leads.city_id é a coluna filtrada pelo gestor_regional.
//   - null     → acesso global (admin / gestor_geral).
//   - []       → sem acesso — condição falsa (1=0).
//   - string[] → WHERE leads.city_id IN (...).
//
// Anti-N+1:
//   1. Query 1: customer + lead.name + lead.city_id (com city-scope).
//   2. Query 2: contratos do cliente + agregações de payment_dues via subquery
//      GROUP BY contract_id — calculadas em SQL, não em JS loop.
//   3. Query 3: últimas 10 parcelas do cliente (recent_dues).
//
// LGPD (doc 17 §8.1):
//   - name vem do lead (PII). Nunca selecionamos CPF/document_number aqui.
//   - Nenhum dado de boleto (URL, linha digitável, PIX) é incluído na resposta —
//     o endpoint retorna apenas metadados de saúde do boleto (contagens/somatórios).
// =============================================================================
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { contracts } from '../../db/schema/contracts.js';
import { customers } from '../../db/schema/customers.js';
import { leads } from '../../db/schema/leads.js';
import { paymentDues } from '../../db/schema/paymentDues.js';
import { NotFoundError } from '../../shared/errors.js';

import type { BoletoHealth, ContractWithHealth, CustomerOverviewResponse } from './schemas.js';

// ---------------------------------------------------------------------------
// City-scope helper
// ---------------------------------------------------------------------------

/**
 * Constrói condição SQL para filtrar por cidade permitida via customers → leads.
 *
 * - null     → acesso global — sem filtro adicional.
 * - []       → sem scope de cidade — retorna condição falsa (1=0).
 * - string[] → WHERE leads.city_id IN (...).
 */
function buildCityScopeCondition(
  cityScopeIds: string[] | null,
): ReturnType<typeof inArray> | ReturnType<typeof sql> | null {
  if (cityScopeIds === null) {
    return null;
  }
  if (cityScopeIds.length === 0) {
    // `as` justificado: sql<boolean> é compatível com SQL condition no Drizzle.
    return sql`1 = 0` as ReturnType<typeof sql>;
  }
  return inArray(leads.cityId, cityScopeIds);
}

// ---------------------------------------------------------------------------
// Mapper de health de boleto a partir do resultado do agregado SQL
// ---------------------------------------------------------------------------

function mapBoletoHealth(
  contractId: string,
  agg: {
    total_installments: number;
    paid_count: number;
    overdue_count: number;
    pending_count: number;
    paid_amount: string;
    overdue_amount: string;
    pending_amount: string;
  } | null,
): BoletoHealth | null {
  if (agg === null || agg.total_installments === 0) {
    return null;
  }

  // Calcula percentual pago
  const percentPaid =
    agg.total_installments > 0
      ? Math.round((agg.paid_count / agg.total_installments) * 100 * 100) / 100
      : 0;

  // Status sintético de saúde
  let health: BoletoHealth['health'];
  if (agg.paid_count === agg.total_installments) {
    health = 'settled';
  } else if (agg.overdue_count > 0) {
    health = 'defaulted';
  } else {
    health = 'healthy';
  }

  return {
    contract_id: contractId,
    total_installments: agg.total_installments,
    paid_count: agg.paid_count,
    overdue_count: agg.overdue_count,
    pending_count: agg.pending_count,
    paid_amount: agg.paid_amount,
    overdue_amount: agg.overdue_amount,
    pending_amount: agg.pending_amount,
    percent_paid: percentPaid,
    health,
  };
}

// ---------------------------------------------------------------------------
// getCustomerOverview — agregação completa em 3 queries (sem N+1)
// ---------------------------------------------------------------------------

export async function getCustomerOverview(
  db: Database,
  organizationId: string,
  customerId: string,
  cityScopeIds: string[] | null,
): Promise<CustomerOverviewResponse> {
  // -------------------------------------------------------------------------
  // Query 1: customer + lead.name (com city-scope via leads.city_id)
  // -------------------------------------------------------------------------
  const customerConditions = [
    eq(customers.id, customerId),
    eq(customers.organizationId, organizationId),
  ];

  const cityScopeCondition = buildCityScopeCondition(cityScopeIds);
  if (cityScopeCondition !== null) {
    customerConditions.push(cityScopeCondition);
  }

  const customerRows = await db
    .select({
      id: customers.id,
      organizationId: customers.organizationId,
      spcStatus: customers.spcStatus,
      spcChangedAt: customers.spcChangedAt,
      // name vem do lead — PII; nunca selecionar CPF/document_number
      name: leads.name,
    })
    .from(customers)
    .innerJoin(leads, eq(customers.primaryLeadId, leads.id))
    .where(and(...customerConditions))
    .limit(1);

  if (customerRows.length === 0) {
    throw new NotFoundError('Cliente não encontrado');
  }

  const customerRow = customerRows[0]!;

  // -------------------------------------------------------------------------
  // Query 2: contratos do cliente com agregações de payment_dues (anti-N+1).
  //
  // Usamos subquery lateral para calcular os agregados de boleto_health
  // via SQL puro — 1 query para todos os contratos, sem loop JS.
  //
  // Drizzle não expõe LATERAL JOIN nativamente — usamos sql`` para o subselect
  // de agregados e os obtemos num segundo join em linha.
  //
  // Estratégia: 2 selects em sequência:
  //   a) Contratos do cliente
  //   b) Agregados de payment_dues por contract_id (GROUP BY) para esses contratos
  // Depois fazemos merge em JS por contract_id — O(n) com Map, não O(n²).
  // -------------------------------------------------------------------------
  const contractRows = await db
    .select()
    .from(contracts)
    .where(and(eq(contracts.customerId, customerId), eq(contracts.organizationId, organizationId)))
    .orderBy(desc(contracts.createdAt));

  // IDs dos contratos para o subselect de agregados
  const contractIds = contractRows.map((r) => r.id);

  // Agregados de payment_dues por contract_id (1 query para todos os contratos)
  type DuesAggRow = {
    contract_id: string;
    total_installments: number;
    paid_count: number;
    overdue_count: number;
    pending_count: number;
    paid_amount: string;
    overdue_amount: string;
    pending_amount: string;
  };

  let duesAggRows: DuesAggRow[] = [];

  if (contractIds.length > 0) {
    // Drizzle sql`` para aggregate com FILTER (ANSI SQL:2003 — Postgres suporta)
    const aggResult = await db
      .select({
        contract_id: paymentDues.contractId,
        total_installments: sql<number>`count(*)::int`,
        paid_count: sql<number>`count(*) FILTER (WHERE ${paymentDues.status} = 'paid')::int`,
        overdue_count: sql<number>`count(*) FILTER (WHERE ${paymentDues.status} = 'overdue')::int`,
        pending_count: sql<number>`count(*) FILTER (WHERE ${paymentDues.status} = 'pending')::int`,
        paid_amount: sql<string>`coalesce(sum(${paymentDues.amount}) FILTER (WHERE ${paymentDues.status} = 'paid'), 0)::text`,
        overdue_amount: sql<string>`coalesce(sum(${paymentDues.amount}) FILTER (WHERE ${paymentDues.status} = 'overdue'), 0)::text`,
        pending_amount: sql<string>`coalesce(sum(${paymentDues.amount}) FILTER (WHERE ${paymentDues.status} = 'pending'), 0)::text`,
      })
      .from(paymentDues)
      .where(
        and(
          inArray(
            paymentDues.contractId,
            // `as` justificado: sql inArray espera string[], mas contractIds pode ser never[]
            // quando vazio — essa branch só executa quando contractIds.length > 0.
            contractIds as [string, ...string[]],
          ),
          eq(paymentDues.organizationId, organizationId),
        ),
      )
      .groupBy(paymentDues.contractId);

    // `as` justificado: estrutura alinhada com DuesAggRow, Drizzle infere unknown para sql<T>.
    duesAggRows = aggResult as unknown as DuesAggRow[];
  }

  // Map para O(1) lookup de agregado por contract_id
  const aggByContractId = new Map<string, DuesAggRow>();
  for (const agg of duesAggRows) {
    if (agg.contract_id !== null) {
      aggByContractId.set(agg.contract_id, agg);
    }
  }

  // Monta contratos com boleto_health
  const contractsWithHealth: ContractWithHealth[] = contractRows.map((row) => {
    const agg = aggByContractId.get(row.id) ?? null;
    const boletoHealth = mapBoletoHealth(row.id, agg);

    return {
      id: row.id,
      organization_id: row.organizationId,
      customer_id: row.customerId,
      contract_reference: row.contractReference,
      product_id: row.productId ?? null,
      rule_version_id: row.ruleVersionId ?? null,
      principal_amount: row.principalAmount,
      term_months: row.termMonths,
      monthly_rate_snapshot: row.monthlyRateSnapshot ?? null,
      status: row.status,
      signed_at: row.signedAt ? row.signedAt.toISOString() : null,
      first_due_date: row.firstDueDate ?? null,
      last_due_date: row.lastDueDate ?? null,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
      boleto_health: boletoHealth,
    };
  });

  // -------------------------------------------------------------------------
  // Query 3: últimas 10 parcelas do cliente (recent_dues), ordenadas por due_date DESC
  // -------------------------------------------------------------------------
  const recentDueRows = await db
    .select({
      id: paymentDues.id,
      contractReference: paymentDues.contractReference,
      installmentNumber: paymentDues.installmentNumber,
      dueDate: paymentDues.dueDate,
      amount: paymentDues.amount,
      status: paymentDues.status,
      paidAt: paymentDues.paidAt,
    })
    .from(paymentDues)
    .where(
      and(eq(paymentDues.customerId, customerId), eq(paymentDues.organizationId, organizationId)),
    )
    .orderBy(desc(paymentDues.dueDate))
    .limit(10);

  const recentDues = recentDueRows.map((row) => ({
    id: row.id,
    contract_reference: row.contractReference,
    installment_number: row.installmentNumber,
    due_date: row.dueDate,
    amount: row.amount,
    // `as` justificado: status está constrito pelo enum do schema; Drizzle infere string.
    status: row.status as 'pending' | 'overdue' | 'paid' | 'renegotiated' | 'cancelled',
    paid_at: row.paidAt ? row.paidAt.toISOString() : null,
  }));

  return {
    customer: {
      id: customerRow.id,
      organization_id: customerRow.organizationId,
      name: customerRow.name,
      // `as` justificado: spc_status está constrito pelo check constraint do banco.
      spc_status: customerRow.spcStatus as 'none' | 'pending_inclusion' | 'included' | 'removed',
      spc_changed_at: customerRow.spcChangedAt ? customerRow.spcChangedAt.toISOString() : null,
    },
    contracts: contractsWithHealth,
    recent_dues: recentDues,
  };
}
