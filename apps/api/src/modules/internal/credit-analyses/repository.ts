// =============================================================================
// internal/credit-analyses/repository.ts — Acesso read-only mascarado às análises.
//
// F4-S04: leitura mascarada para o grafo LangGraph.
//
// Contrato de mascaramento (LGPD Art. 6º III — minimização):
//   Seleciona APENAS: id, status, created_at, updated_at.
//   current_version_number é derivado via subquery MAX(version) em credit_analysis_versions.
//
//   NUNCA seleciona: parecer_text, pendencias, attachments, internal_score,
//   analyst_user_id, approved_amount, approved_term_months, approved_rate_monthly.
//
// Multi-tenant (regra inviolável #3 — CLAUDE.md):
//   organization_id filtrado em todas as queries via WHERE organization_id = $1.
//   Lead de outra org retorna lista vazia (não 404) — não vaza existência do recurso.
//   Consistência: se o lead não pertence à org, credit_analyses WHERE lead_id + org = [].
//
// Ordenação: created_at DESC (análise mais recente primeiro).
// =============================================================================
import { desc, eq, max, and } from 'drizzle-orm';

import { db } from '../../../db/client.js';
import { creditAnalyses } from '../../../db/schema/creditAnalyses.js';
import { creditAnalysisVersions } from '../../../db/schema/creditAnalysisVersions.js';
import { leads } from '../../../db/schema/leads.js';

// ---------------------------------------------------------------------------
// Tipo de retorno interno — já mascarado
// ---------------------------------------------------------------------------

export interface MaskedAnalysisRow {
  analysisId: string;
  status: 'em_analise' | 'pendente' | 'aprovado' | 'recusado' | 'cancelado';
  currentVersionNumber: number;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Repositório
// ---------------------------------------------------------------------------

/**
 * Retorna a lista de análises mascaradas de um lead em uma organização.
 *
 * Passos:
 *   1. Verificar que o lead existe na org (multi-tenant scope).
 *   2. Buscar análises filtradas por lead_id + organization_id.
 *   3. Para cada análise, derivar current_version_number via MAX(version).
 *
 * @param leadId - UUID do lead.
 * @param organizationId - UUID da organização (obrigatório — multi-tenant scope).
 * @returns Lista mascarada ordenada por created_at DESC. Vazia se não há análises.
 * @throws Error se lead não existe ou não pertence à org (caller trata como 404).
 */
export async function getMaskedAnalysisHistory(
  leadId: string,
  organizationId: string,
): Promise<MaskedAnalysisRow[]> {
  // -------------------------------------------------------------------------
  // 1. Verificar existência do lead na organização (multi-tenant scope).
  //    LGPD: seleciona apenas 'id' — minimização.
  //    Retorna null se não existe ou pertence a outra org — caller lança 404.
  // -------------------------------------------------------------------------
  const leadRows = await db
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.organizationId, organizationId)))
    .limit(1);

  if (leadRows.length === 0) {
    // Sinaliza para o caller que o lead não existe nesta org.
    // Lança erro explícito — caller converte para 404.
    throw new LeadNotFoundInOrgError(leadId, organizationId);
  }

  // -------------------------------------------------------------------------
  // 2. Buscar análises filtradas por lead_id + organization_id.
  //
  //    Colunas selecionadas (mascaramento LGPD):
  //      - id, status, created_at, updated_at (campos públicos seguros)
  //
  //    Colunas NÃO selecionadas (inviolável — defesa em profundidade):
  //      - parecer_text, pendencias, attachments (texto interno)
  //      - internal_score (pontuação restrita)
  //      - analyst_user_id (identificação interna)
  //      - approved_amount, approved_term_months, approved_rate_monthly (slot futuro F6)
  //      - simulation_id, customer_id, current_version_id, origin (desnecessários para o grafo)
  //
  //    Multi-tenant: both lead_id AND organization_id filtrados (regra inviolável #3).
  //    Não filtra cancelado — o grafo pode precisar saber que houve cancelamento.
  //    Ordenação: created_at DESC (mais recente primeiro).
  // -------------------------------------------------------------------------
  const analyses = await db
    .select({
      id: creditAnalyses.id,
      status: creditAnalyses.status,
      createdAt: creditAnalyses.createdAt,
      updatedAt: creditAnalyses.updatedAt,
    })
    .from(creditAnalyses)
    .where(
      and(eq(creditAnalyses.leadId, leadId), eq(creditAnalyses.organizationId, organizationId)),
    )
    .orderBy(desc(creditAnalyses.createdAt));

  if (analyses.length === 0) {
    return [];
  }

  // -------------------------------------------------------------------------
  // 3. Derivar current_version_number para cada análise.
  //
  //    Para cada analysis_id, obtemos MAX(version) de credit_analysis_versions.
  //    null → análise sem versão ainda → version_number = 0.
  //
  //    Realizamos em paralelo (Promise.all) para minimizar latência total.
  //    Aceita array vazio (já verificado acima).
  // -------------------------------------------------------------------------
  const versionRows = await Promise.all(
    analyses.map((a) =>
      db
        .select({ maxVersion: max(creditAnalysisVersions.version) })
        .from(creditAnalysisVersions)
        .where(eq(creditAnalysisVersions.analysisId, a.id))
        .limit(1),
    ),
  );

  // -------------------------------------------------------------------------
  // 4. Montar resultado mascarado.
  // -------------------------------------------------------------------------
  return analyses.map((a, i): MaskedAnalysisRow => {
    const rawMax = versionRows[i]?.[0]?.maxVersion ?? null;
    const currentVersionNumber = rawMax !== null ? Number(rawMax) : 0;

    return {
      analysisId: a.id,
      // `as` justificado: o enum do Drizzle garante que status é um dos valores
      // do literal — o banco rejeita qualquer outro valor via CHECK constraint.
      status: a.status as MaskedAnalysisRow['status'],
      currentVersionNumber,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    };
  });
}

// ---------------------------------------------------------------------------
// Erro tipado
// ---------------------------------------------------------------------------

/** Lançado quando o lead não existe ou não pertence à organização informada. */
export class LeadNotFoundInOrgError extends Error {
  readonly leadId: string;
  readonly organizationId: string;

  constructor(leadId: string, organizationId: string) {
    super(`Lead não encontrado na organização: leadId=${leadId}`);
    this.name = 'LeadNotFoundInOrgError';
    this.leadId = leadId;
    this.organizationId = organizationId;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
