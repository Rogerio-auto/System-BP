// =============================================================================
// contracts/repository.ts — Queries Drizzle para contratos (F17-S03).
//
// Responsabilidades:
//   - Listagem paginada de contratos com filtros (status, customer_id).
//   - Get por id (com city-scope).
//   - Criação de contrato draft.
//   - Update de status (sign).
//
// City-scope:
//   Contratos pertencem ao cliente; cliente tem cidade via customers → leads.
//   A condição de city-scope filtra via customers.primary_lead_id → leads.city_id.
//   null     → acesso global (admin / gestor_geral).
//   []       → sem acesso — retorna condição falsa (1=0).
//   string[] → WHERE leads.city_id IN (...).
//
// LGPD (doc 17):
//   - Nenhuma coluna de PII (CPF, telefone, e-mail) é selecionada aqui.
//   - contract_reference não é PII (identificador operacional sem dados biométricos).
//   - principal_amount é dado financeiro operacional (base legal: Art. 7º V LGPD).
// =============================================================================
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { contracts } from '../../db/schema/contracts.js';
import { customers } from '../../db/schema/customers.js';
import { leads } from '../../db/schema/leads.js';
import { paymentDues } from '../../db/schema/paymentDues.js';
import { NotFoundError } from '../../shared/errors.js';

import type {
  BoletoHealthResponse,
  ContractCreateBody,
  ContractResponse,
  ContractStatus,
  ContractsListQuery,
  ContractsListResponse,
} from './schemas.js';

// ---------------------------------------------------------------------------
// City-scope helper (padrão: billing/repository.ts §buildCityScopeCondition)
// ---------------------------------------------------------------------------

/**
 * Constrói condição SQL para filtrar contratos por cidade permitida
 * via customers → leads (primary_lead_id → city_id).
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
// Mapper — row Drizzle → ContractResponse
// ---------------------------------------------------------------------------

function mapContractRow(row: typeof contracts.$inferSelect): ContractResponse {
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
  };
}

// ---------------------------------------------------------------------------
// listContracts — listagem paginada com city-scope
// ---------------------------------------------------------------------------

export async function listContracts(
  db: Database,
  organizationId: string,
  cityScopeIds: string[] | null,
  query: ContractsListQuery,
): Promise<ContractsListResponse> {
  const offset = (query.page - 1) * query.limit;

  const conditions = [eq(contracts.organizationId, organizationId)];

  const cityScopeCondition = buildCityScopeCondition(cityScopeIds);
  if (cityScopeCondition !== null) {
    conditions.push(cityScopeCondition);
  }

  if (query.status) {
    conditions.push(eq(contracts.status, query.status as typeof contracts.status._.data));
  }

  if (query.customer_id) {
    conditions.push(eq(contracts.customerId, query.customer_id));
  }

  const whereClause = and(...conditions);

  const countResult = await db
    .select({ total: count() })
    .from(contracts)
    .leftJoin(customers, eq(contracts.customerId, customers.id))
    .leftJoin(leads, eq(customers.primaryLeadId, leads.id))
    .where(whereClause);

  const total = countResult[0]?.total ?? 0;

  const rows = await db
    .select()
    .from(contracts)
    .leftJoin(customers, eq(contracts.customerId, customers.id))
    .leftJoin(leads, eq(customers.primaryLeadId, leads.id))
    .where(whereClause)
    .orderBy(desc(contracts.createdAt))
    .limit(query.limit)
    .offset(offset);

  return {
    data: rows.map((row) => mapContractRow(row.contracts)),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

// ---------------------------------------------------------------------------
// getContractById — busca por id com city-scope
// ---------------------------------------------------------------------------

export async function getContractById(
  db: Database,
  organizationId: string,
  contractId: string,
  cityScopeIds: string[] | null,
): Promise<ContractResponse> {
  const conditions = [eq(contracts.id, contractId), eq(contracts.organizationId, organizationId)];

  const cityScopeCondition = buildCityScopeCondition(cityScopeIds);
  if (cityScopeCondition !== null) {
    conditions.push(cityScopeCondition);
  }

  const rows = await db
    .select()
    .from(contracts)
    .leftJoin(customers, eq(contracts.customerId, customers.id))
    .leftJoin(leads, eq(customers.primaryLeadId, leads.id))
    .where(and(...conditions))
    .limit(1);

  if (rows.length === 0) {
    throw new NotFoundError('Contrato não encontrado');
  }

  return mapContractRow(rows[0]!.contracts);
}

// ---------------------------------------------------------------------------
// createContract — insere novo contrato draft
// ---------------------------------------------------------------------------

export async function createContract(
  db: Database,
  organizationId: string,
  input: ContractCreateBody,
): Promise<ContractResponse> {
  const rows = await db
    .insert(contracts)
    .values({
      organizationId,
      customerId: input.customer_id,
      contractReference: input.contract_reference,
      productId: input.product_id ?? null,
      ruleVersionId: input.rule_version_id ?? null,
      principalAmount: input.principal_amount,
      termMonths: input.term_months,
      monthlyRateSnapshot: input.monthly_rate_snapshot ?? null,
      status: 'draft',
      firstDueDate: input.first_due_date ?? null,
      lastDueDate: input.last_due_date ?? null,
    })
    .returning();

  return mapContractRow(rows[0]!);
}

// ---------------------------------------------------------------------------
// signContract — transição de status + signed_at (dentro de tx ativa)
//
// Chamado DENTRO de uma transação — não faz SELECT FOR UPDATE próprio;
// o caller (service) já verificou o estado antes de abrir a tx.
// ---------------------------------------------------------------------------

export async function signContract(
  db: Database,
  organizationId: string,
  contractId: string,
  nextStatus: ContractStatus,
  signedAt: Date | null,
): Promise<ContractResponse> {
  const updateValues: Partial<typeof contracts.$inferInsert> & { updatedAt: Date } = {
    status: nextStatus,
    updatedAt: new Date(),
  };

  // signed_at só é definido na primeira transição (draft→signed)
  if (signedAt !== null) {
    updateValues.signedAt = signedAt;
  }

  const rows = await db
    .update(contracts)
    .set(updateValues)
    .where(and(eq(contracts.id, contractId), eq(contracts.organizationId, organizationId)))
    .returning();

  if (rows.length === 0) {
    throw new NotFoundError('Contrato não encontrado');
  }

  return mapContractRow(rows[0]!);
}

// ---------------------------------------------------------------------------
// getBoletoHealthByContractId — agregação de saúde de boletos (F17-S04)
//
// Uma única query SQL com COUNT FILTER e SUM FILTER agrupa todas as parcelas
// do contrato em uma passada (sem N+1). Os valores numéricos (amount) são
// retornados como string para evitar float drift (numeric → text via SQL).
//
// Também conta parcelas overdue com vencimento >= 15 dias atrás para
// calcular o indicador 'defaulted' vs 'at_risk'.
//
// City-scope: não aplicado aqui — o caller (service) deve verificar
// que o contrato pertence ao escopo do usuário antes de chamar esta função
// (via verifyContractScope).
// ---------------------------------------------------------------------------

/**
 * Tipos internos da row retornada pela query de agregação.
 * Os campos COUNT retornam bigint (string em pg) — convertidos para number.
 * Os campos SUM retornam numeric — mantidos como string.
 * Index signature requerida por db.execute<T> do Drizzle (constraint Record<string, unknown>).
 */
interface BoletoHealthRow extends Record<string, unknown> {
  total: string;
  paid_count: string;
  overdue_count: string;
  pending_count: string;
  paid_amount: string | null;
  overdue_amount: string | null;
  pending_amount: string | null;
  overdue_15d_count: string;
}

export async function getBoletoHealthByContractId(
  db: Database,
  contractId: string,
): Promise<BoletoHealthResponse> {
  // Uma única query de agregação — sem N+1.
  // Drizzle não suporta FILTER nativo, portanto usamos sql`` parametrizado.
  // `as` justificado: sql<BoletoHealthRow> não tem outro mecanismo de tipagem em Drizzle.
  const rows = await db.execute<BoletoHealthRow>(sql`
    SELECT
      COUNT(*)::text                                                              AS total,
      COUNT(*) FILTER (WHERE ${paymentDues.status} = 'paid')::text               AS paid_count,
      COUNT(*) FILTER (WHERE ${paymentDues.status} = 'overdue')::text             AS overdue_count,
      COUNT(*) FILTER (WHERE ${paymentDues.status} = 'pending')::text             AS pending_count,
      COALESCE(SUM(${paymentDues.amount}) FILTER (WHERE ${paymentDues.status} = 'paid'),  0)::text AS paid_amount,
      COALESCE(SUM(${paymentDues.amount}) FILTER (WHERE ${paymentDues.status} = 'overdue'), 0)::text AS overdue_amount,
      COALESCE(SUM(${paymentDues.amount}) FILTER (WHERE ${paymentDues.status} = 'pending'), 0)::text AS pending_amount,
      COUNT(*) FILTER (
        WHERE ${paymentDues.status} = 'overdue'
          AND ${paymentDues.dueDate} <= (NOW() - INTERVAL '15 days')::date
      )::text AS overdue_15d_count
    FROM ${paymentDues}
    WHERE ${paymentDues.contractId} = ${contractId}
  `);

  const row = rows.rows[0] as BoletoHealthRow | undefined;

  // Se a query não retornar nenhuma linha (impossível com COUNT mas defensivo)
  // retornamos saúde zerada.
  const total = row ? parseInt(row.total, 10) : 0;
  const paidCount = row ? parseInt(row.paid_count, 10) : 0;
  const overdueCount = row ? parseInt(row.overdue_count, 10) : 0;
  const pendingCount = row ? parseInt(row.pending_count, 10) : 0;
  const overdue15dCount = row ? parseInt(row.overdue_15d_count, 10) : 0;

  const paidAmount = row?.paid_amount ?? '0';
  const overdueAmount = row?.overdue_amount ?? '0';
  const pendingAmount = row?.pending_amount ?? '0';

  // Percentual pago — divisão inteira segura; 0 se sem parcelas.
  const percentPaid = total === 0 ? 0 : Math.round((paidCount / total) * 100);

  // Indicador sintético de saúde:
  //   settled:   todas as parcelas pagas (ou sem parcelas e percentPaid == 100 — impossível)
  //   defaulted: ≥1 parcela overdue há ≥ 15 dias
  //   at_risk:   ≥1 parcela overdue mas todas há < 15 dias
  //   healthy:   sem parcelas overdue (paid ou pending apenas)
  let health: BoletoHealthResponse['health'];

  if (total > 0 && percentPaid === 100) {
    health = 'settled';
  } else if (overdue15dCount > 0) {
    health = 'defaulted';
  } else if (overdueCount > 0) {
    health = 'at_risk';
  } else {
    health = 'healthy';
  }

  return {
    contract_id: contractId,
    total_installments: total,
    paid_count: paidCount,
    overdue_count: overdueCount,
    pending_count: pendingCount,
    paid_amount: paidAmount,
    overdue_amount: overdueAmount,
    pending_amount: pendingAmount,
    percent_paid: percentPaid,
    health,
  };
}

// ---------------------------------------------------------------------------
// verifyContractScope — verifica existência e city-scope antes de mutar
//
// Retorna status atual. Lança NotFoundError se fora do scope ou inexistente.
// Não usa SELECT FOR UPDATE — o lock real ocorre implicitamente no UPDATE
// dentro da transação (Postgres row lock em UPDATE).
// ---------------------------------------------------------------------------

export async function verifyContractScope(
  db: Database,
  organizationId: string,
  contractId: string,
  cityScopeIds: string[] | null,
): Promise<{ id: string; status: ContractStatus; customerId: string }> {
  const conditions = [eq(contracts.id, contractId), eq(contracts.organizationId, organizationId)];

  const cityScopeCondition = buildCityScopeCondition(cityScopeIds);
  if (cityScopeCondition !== null) {
    conditions.push(cityScopeCondition);
  }

  const rows = await db
    .select({
      id: contracts.id,
      status: contracts.status,
      customerId: contracts.customerId,
    })
    .from(contracts)
    .leftJoin(customers, eq(contracts.customerId, customers.id))
    .leftJoin(leads, eq(customers.primaryLeadId, leads.id))
    .where(and(...conditions))
    .limit(1);

  if (rows.length === 0) {
    throw new NotFoundError('Contrato não encontrado');
  }

  const row = rows[0]!;
  return {
    id: row.id,
    // `as` justificado: status está constrito pelo check constraint do banco a valores válidos.
    status: row.status as ContractStatus,
    customerId: row.customerId,
  };
}
