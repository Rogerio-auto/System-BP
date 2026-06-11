// =============================================================================
// credit-analyses/repository.ts — Queries Drizzle para análise de crédito.
//
// Contexto: F4-S02.
//
// City Scope (RBAC multi-cidade):
//   - cityScopeIds === null  → acesso global (admin/gestor_geral).
//   - cityScopeIds === []    → sem acesso → retorna vazio.
//   - cityScopeIds: string[] → filtra credit_analyses via JOIN com leads.city_id.
//
// Imutabilidade:
//   - credit_analysis_versions nunca recebe UPDATE.
//   - Trigger prevent_credit_analysis_version_update garante em profundidade.
//
// LGPD (doc 17 §8.1):
//   - Queries não retornam cpf_encrypted/cpf_hash de leads.
//   - internal_score não é exposto nas funções de leitura pública.
//   - lead_id e customer_id são UUIDs opacos — nunca logados.
// =============================================================================
import { and, count, desc, eq, inArray, max, sql } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { creditAnalyses } from '../../db/schema/creditAnalyses.js';
import type { CreditAnalysis } from '../../db/schema/creditAnalyses.js';
import { creditAnalysisVersions } from '../../db/schema/creditAnalysisVersions.js';
import type { CreditAnalysisVersion } from '../../db/schema/creditAnalysisVersions.js';
import { leads } from '../../db/schema/leads.js';

import type { CreditAnalysisListQuery } from './schemas.js';

// ---------------------------------------------------------------------------
// City scope helper
// ---------------------------------------------------------------------------

/**
 * Constrói a condição SQL de city-scope via leads.city_id.
 * credit_analyses não tem city_id diretamente — obtém via leads.
 *
 * @param cityScopeIds  null = sem restrição, [] = nenhum acesso, string[] = filtro.
 *
 * Retorna SQL condition ou null (sem restrição).
 */
function buildCityScopeCondition(
  cityScopeIds: string[] | null,
): ReturnType<typeof inArray> | ReturnType<typeof sql> | null {
  if (cityScopeIds === null) return null;
  if (cityScopeIds.length === 0) {
    // `as` justificado: sql<boolean> é compatível com SQL condition no Drizzle.
    return sql`1 = 0` as ReturnType<typeof sql>;
  }
  return inArray(leads.cityId, cityScopeIds);
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface InsertAnalysisInput {
  organizationId: string;
  leadId: string;
  customerId?: string | null;
  simulationId?: string | null;
  analystUserId?: string | null;
  status: 'em_analise' | 'pendente' | 'aprovado' | 'recusado' | 'cancelado';
  origin: 'manual' | 'import';
  approvedAmount?: string | null;
  approvedTermMonths?: number | null;
  approvedRateMonthly?: string | null;
}

export interface InsertVersionInput {
  analysisId: string;
  version: number;
  status: 'em_analise' | 'pendente' | 'aprovado' | 'recusado' | 'cancelado';
  parecerText: string;
  pendencias: unknown;
  attachments: unknown;
  authorUserId: string;
}

export interface UpdateAnalysisInput {
  status?: 'em_analise' | 'pendente' | 'aprovado' | 'recusado' | 'cancelado';
  currentVersionId?: string;
  approvedAmount?: string | null;
  approvedTermMonths?: number | null;
  approvedRateMonthly?: string | null;
  analystUserId?: string | null;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Listagem
// ---------------------------------------------------------------------------

export interface PaginatedAnalyses {
  data: CreditAnalysis[];
  total: number;
}

/**
 * Lista análises da org com paginação e city-scope.
 * Join com leads para filtrar por city_id quando cityScopeIds é fornecido.
 */
export async function findAnalyses(
  db: Database,
  organizationId: string,
  cityScopeIds: string[] | null,
  query: CreditAnalysisListQuery,
): Promise<PaginatedAnalyses> {
  const { page, limit, status, analyst_user_id, lead_id } = query;
  const offset = (page - 1) * limit;

  const conditions: Array<ReturnType<typeof eq>> = [
    eq(creditAnalyses.organizationId, organizationId),
  ];

  if (status !== undefined) {
    conditions.push(eq(creditAnalyses.status, status));
  }

  if (analyst_user_id !== undefined) {
    conditions.push(eq(creditAnalyses.analystUserId, analyst_user_id));
  }

  if (lead_id !== undefined) {
    conditions.push(eq(creditAnalyses.leadId, lead_id));
  }

  const scopeCondition = buildCityScopeCondition(cityScopeIds);

  if (scopeCondition !== null) {
    // Quando há city scope, precisa de JOIN com leads
    const whereClause = and(...conditions, scopeCondition as ReturnType<typeof eq>);

    const [rows, totalRows] = await Promise.all([
      db
        .select({ creditAnalyses })
        .from(creditAnalyses)
        .innerJoin(leads, eq(creditAnalyses.leadId, leads.id))
        .where(whereClause)
        .orderBy(desc(creditAnalyses.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: count() })
        .from(creditAnalyses)
        .innerJoin(leads, eq(creditAnalyses.leadId, leads.id))
        .where(whereClause),
    ]);

    return {
      data: rows.map((r) => r.creditAnalyses),
      total: totalRows[0]?.count ?? 0,
    };
  }

  // Sem city scope — query simples sem JOIN
  const whereClause = and(...conditions);

  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(creditAnalyses)
      .where(whereClause)
      .orderBy(desc(creditAnalyses.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: count() }).from(creditAnalyses).where(whereClause),
  ]);

  return {
    data: rows,
    total: totalRows[0]?.count ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Busca por ID
// ---------------------------------------------------------------------------

/**
 * Busca análise por ID dentro da org e city-scope.
 * Retorna null se não encontrada ou fora do scope (evitar vazar existência).
 */
export async function findAnalysisById(
  db: Database,
  id: string,
  organizationId: string,
  cityScopeIds: string[] | null,
): Promise<CreditAnalysis | null> {
  const conditions: Array<ReturnType<typeof eq>> = [
    eq(creditAnalyses.id, id),
    eq(creditAnalyses.organizationId, organizationId),
  ];

  const scopeCondition = buildCityScopeCondition(cityScopeIds);

  if (scopeCondition !== null) {
    const whereClause = and(...conditions, scopeCondition as ReturnType<typeof eq>);

    const rows = await db
      .select({ creditAnalyses })
      .from(creditAnalyses)
      .innerJoin(leads, eq(creditAnalyses.leadId, leads.id))
      .where(whereClause)
      .limit(1);

    return rows[0]?.creditAnalyses ?? null;
  }

  const rows = await db
    .select()
    .from(creditAnalyses)
    .where(and(...conditions))
    .limit(1);

  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Nome do lead (para exibição na tela de análise) — F13
// ---------------------------------------------------------------------------

/**
 * Busca o nome do lead por ID. PII — exibido apenas ao analista autorizado.
 * O acesso à análise já foi validado (org + city-scope) antes desta chamada.
 */
export async function findLeadName(db: Database, leadId: string): Promise<string | null> {
  const rows = await db
    .select({ name: leads.name })
    .from(leads)
    .where(eq(leads.id, leadId))
    .limit(1);
  return rows[0]?.name ?? null;
}

// ---------------------------------------------------------------------------
// Histórico por lead
// ---------------------------------------------------------------------------

/**
 * Retorna todas as análises de um lead dentro do city-scope.
 * Usado pelo endpoint GET /api/leads/:leadId/credit-analyses.
 */
export async function findAnalysesByLeadId(
  db: Database,
  leadId: string,
  organizationId: string,
  cityScopeIds: string[] | null,
  query: CreditAnalysisListQuery,
): Promise<PaginatedAnalyses> {
  return findAnalyses(db, organizationId, cityScopeIds, { ...query, lead_id: leadId });
}

// ---------------------------------------------------------------------------
// Busca versão por ID
// ---------------------------------------------------------------------------

/**
 * Retorna todas as versões de uma análise (histórico de pareceres).
 */
export async function findVersionsByAnalysisId(
  db: Database,
  analysisId: string,
): Promise<CreditAnalysisVersion[]> {
  return db
    .select()
    .from(creditAnalysisVersions)
    .where(eq(creditAnalysisVersions.analysisId, analysisId))
    .orderBy(desc(creditAnalysisVersions.version));
}

/**
 * Retorna a versão atual (current_version) de uma análise.
 */
export async function findCurrentVersion(
  db: Database,
  versionId: string,
): Promise<CreditAnalysisVersion | null> {
  const rows = await db
    .select()
    .from(creditAnalysisVersions)
    .where(eq(creditAnalysisVersions.id, versionId))
    .limit(1);

  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Próximo número de versão
// ---------------------------------------------------------------------------

/**
 * Calcula o próximo número de versão para uma análise.
 * SELECT MAX(version) + 1 — chamado dentro de transação para evitar race condition.
 */
export async function nextVersionNumber(db: Database, analysisId: string): Promise<number> {
  const rows = await db
    .select({ maxVersion: max(creditAnalysisVersions.version) })
    .from(creditAnalysisVersions)
    .where(eq(creditAnalysisVersions.analysisId, analysisId));

  return (rows[0]?.maxVersion ?? 0) + 1;
}

// ---------------------------------------------------------------------------
// Insert analysis
// ---------------------------------------------------------------------------

/**
 * Insere uma nova análise de crédito.
 * Deve ser chamado dentro de uma transação.
 */
export async function insertAnalysis(
  db: Database,
  input: InsertAnalysisInput,
): Promise<CreditAnalysis> {
  const rows = await db
    .insert(creditAnalyses)
    .values({
      organizationId: input.organizationId,
      leadId: input.leadId,
      customerId: input.customerId ?? null,
      simulationId: input.simulationId ?? null,
      analystUserId: input.analystUserId ?? null,
      status: input.status,
      origin: input.origin,
      approvedAmount: input.approvedAmount ?? null,
      approvedTermMonths: input.approvedTermMonths ?? null,
      approvedRateMonthly: input.approvedRateMonthly ?? null,
    })
    .returning();

  const analysis = rows[0];
  if (!analysis) {
    throw new Error('Falha ao inserir credit_analysis — insert não retornou linha');
  }
  return analysis;
}

// ---------------------------------------------------------------------------
// Insert version
// ---------------------------------------------------------------------------

/**
 * Insere uma nova versão (parecer) de análise.
 * Imutável após inserção — trigger de banco impede UPDATE.
 * Deve ser chamado dentro de uma transação.
 */
export async function insertVersion(
  db: Database,
  input: InsertVersionInput,
): Promise<CreditAnalysisVersion> {
  const rows = await db
    .insert(creditAnalysisVersions)
    .values({
      analysisId: input.analysisId,
      version: input.version,
      status: input.status,
      parecerText: input.parecerText,
      // `as` justificado: pendencias/attachments são JSONB — Drizzle aceita unknown.
      pendencias: input.pendencias as Record<string, unknown>[],
      attachments: input.attachments as Record<string, unknown>[],
      authorUserId: input.authorUserId,
    })
    .returning();

  const version = rows[0];
  if (!version) {
    throw new Error('Falha ao inserir credit_analysis_version — insert não retornou linha');
  }
  return version;
}

// ---------------------------------------------------------------------------
// Update analysis
// ---------------------------------------------------------------------------

/**
 * Atualiza campos da análise (status, current_version_id, approved_*).
 * Deve ser chamado dentro de uma transação.
 * Retorna null se não encontrada (race condition).
 */
export async function updateAnalysis(
  db: Database,
  id: string,
  organizationId: string,
  input: UpdateAnalysisInput,
): Promise<CreditAnalysis | null> {
  const rows = await db
    .update(creditAnalyses)
    .set({
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.currentVersionId !== undefined ? { currentVersionId: input.currentVersionId } : {}),
      ...(input.approvedAmount !== undefined ? { approvedAmount: input.approvedAmount } : {}),
      ...(input.approvedTermMonths !== undefined
        ? { approvedTermMonths: input.approvedTermMonths }
        : {}),
      ...(input.approvedRateMonthly !== undefined
        ? { approvedRateMonthly: input.approvedRateMonthly }
        : {}),
      ...(input.analystUserId !== undefined ? { analystUserId: input.analystUserId } : {}),
      updatedAt: input.updatedAt,
    })
    .where(and(eq(creditAnalyses.id, id), eq(creditAnalyses.organizationId, organizationId)))
    .returning();

  return rows[0] ?? null;
}
