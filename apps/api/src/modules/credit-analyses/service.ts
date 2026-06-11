// =============================================================================
// credit-analyses/service.ts — Regras de negócio para análise de crédito.
//
// Contexto: F4-S02.
//
// Responsabilidades:
//   - Criar análise + 1ª versão em 1 transação (insert análise + versão + outbox + audit).
//   - Nova versão imutável em 1 transação.
//   - Decisão (aprovado/recusado) com validação de transição de status.
//   - Request-review (Art. 20 §5 LGPD) — bloqueia decisões automáticas.
//   - City scope: delegar ao repository.
//   - Audit log em toda mutação (parecer_text truncado em 200 chars).
//   - Outbox events sem PII bruta (somente IDs + status).
//
// LGPD (doc 17 §8.1, Art. 20 §1º e §5):
//   - parecer_text é campo sensível — truncado nos audit logs (200 chars).
//   - Outbox: nenhum campo de PII bruta (lead_id é UUID opaco).
//   - pino.redact cobre parecer_text, attachments, internal_score no app.ts.
//   - Toda decisão tem analyst_user_id + created_at + parecer_text + versão anterior
//     preservados — rastreabilidade obrigatória Art. 20 §1º.
//   - request-review: insere nova versão em_analise + outbox review_requested.
//     Bloqueia novas decisões automáticas até novo parecer humano.
//
// Invariantes transacionais:
//   1. Criar análise: INSERT credit_analyses + INSERT versão + UPDATE current_version_id
//      + audit + outbox — 1 tx.
//   2. Nova versão: INSERT versão + UPDATE current_version_id/status/approved_* + audit
//      + outbox — 1 tx.
//   3. Decidir: valida transição → mesmo fluxo de nova versão + outbox status_changed.
//   4. Request-review: INSERT versão em_analise + UPDATE + audit + outbox — 1 tx.
// =============================================================================
import type { Database } from '../../db/client.js';
import type { CreditAnalysis } from '../../db/schema/creditAnalyses.js';
import type { CreditAnalysisVersion } from '../../db/schema/creditAnalysisVersions.js';
import { emit } from '../../events/emit.js';
import { auditLog } from '../../lib/audit.js';
import { AppError, ForbiddenError, NotFoundError } from '../../shared/errors.js';

import {
  findAnalysesByLeadId,
  findAnalysisById,
  findAnalyses,
  findCurrentVersion,
  findLeadName,
  insertAnalysis,
  insertVersion,
  nextVersionNumber,
  updateAnalysis,
} from './repository.js';
import type {
  CreditAnalysisCreate,
  CreditAnalysisDecide,
  CreditAnalysisListQuery,
  CreditAnalysisListResponse,
  CreditAnalysisRequestReview,
  CreditAnalysisResponse,
  CreditAnalysisVersionCreate,
  CreditAnalysisVersionResponse,
} from './schemas.js';

// ---------------------------------------------------------------------------
// Erro tipado: já existe análise ativa para o lead
//
// O índice único parcial `uq_credit_analyses_org_lead_active` garante no máximo
// 1 análise ativa (em_analise/pendente) por lead na org. Ao tentar criar uma
// segunda, o Postgres lança 23505 — mapeamos para 409 (não 500) com mensagem
// clara, espelhando o padrão de LeadPhoneDuplicateError do módulo de leads.
// ---------------------------------------------------------------------------

export class AnalysisActiveExistsError extends AppError {
  constructor() {
    super(
      409,
      'CONFLICT',
      'Já existe uma análise de crédito ativa para este lead. Conclua ou cancele a análise atual antes de abrir uma nova.',
      { code: 'CREDIT_ANALYSIS_ACTIVE_EXISTS' },
    );
    this.name = 'AnalysisActiveExistsError';
  }
}

/** Detecta violação de unique constraint do Postgres (code 23505), opcionalmente por nome. */
function isUniqueViolation(err: unknown, constraint?: string): boolean {
  if (err === null || typeof err !== 'object') return false;
  const e = err as { code?: unknown; constraint?: unknown };
  if (e.code !== '23505') return false;
  if (constraint !== undefined && e.constraint !== constraint) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Actor context
// ---------------------------------------------------------------------------

export interface ActorContext {
  userId: string;
  organizationId: string;
  role: string;
  cityScopeIds: string[] | null;
  ip?: string | null;
  userAgent?: string | null;
}

// ---------------------------------------------------------------------------
// Transições de status válidas
// ---------------------------------------------------------------------------

/** Status de onde é possível fazer uma decisão. */
const DECIDABLE_STATUSES = new Set<string>(['em_analise', 'pendente']);

/** Status finais — não permitem nova versão (exceto request-review). */
const TERMINAL_STATUSES = new Set<string>(['aprovado', 'recusado', 'cancelado']);

// ---------------------------------------------------------------------------
// LGPD: truncar parecer_text para audit_log (Art. 20 §1º)
// ---------------------------------------------------------------------------

/**
 * Trunca parecer_text para no máximo 200 chars antes de gravar em audit_log.
 * O texto completo persiste em credit_analysis_versions (imutável).
 * O log de auditoria não precisa do texto completo — apenas confirmação de que
 * o campo foi preenchido e o analista que o preencheu (author_user_id).
 */
function truncateParecer(text: string, maxLen = 200): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '…[truncado]';
}

// ---------------------------------------------------------------------------
// Serialização: CreditAnalysis → CreditAnalysisResponse
// ---------------------------------------------------------------------------

async function toAnalysisResponse(
  db: Database,
  analysis: CreditAnalysis,
): Promise<CreditAnalysisResponse> {
  let currentVersion: CreditAnalysisVersionResponse | null = null;

  if (analysis.currentVersionId !== null) {
    const version = await findCurrentVersion(db, analysis.currentVersionId);
    if (version !== null) {
      currentVersion = toVersionResponse(version);
    }
  }

  // Nome do lead para exibição (PII — RBAC já validado no acesso à análise).
  const leadName = await findLeadName(db, analysis.leadId);

  return {
    id: analysis.id,
    organization_id: analysis.organizationId,
    lead_id: analysis.leadId,
    lead_name: leadName,
    customer_id: analysis.customerId ?? null,
    simulation_id: analysis.simulationId ?? null,
    current_version_id: analysis.currentVersionId ?? null,
    status: analysis.status,
    approved_amount: analysis.approvedAmount ?? null,
    approved_term_months: analysis.approvedTermMonths ?? null,
    approved_rate_monthly: analysis.approvedRateMonthly ?? null,
    // internal_score: NUNCA exposto na rota pública (gated por feature flag)
    internal_score: null,
    analyst_user_id: analysis.analystUserId ?? null,
    origin: analysis.origin,
    created_at: analysis.createdAt.toISOString(),
    updated_at: analysis.updatedAt.toISOString(),
    current_version: currentVersion,
  };
}

function toVersionResponse(version: CreditAnalysisVersion): CreditAnalysisVersionResponse {
  return {
    id: version.id,
    analysis_id: version.analysisId,
    version: version.version,
    status: version.status,
    parecer_text: version.parecerText,
    // `as` justificado: pendencias e attachments são JSONB — Drizzle retorna unknown.
    pendencias: version.pendencias as Array<{
      tipo: string;
      descricao: string;
      prazo?: string;
    }>,
    attachments: version.attachments as Array<{
      storage_key: string;
      filename: string;
      mime_type: string;
      size_bytes: number;
      sha256: string;
    }>,
    author_user_id: version.authorUserId,
    created_at: version.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export async function listAnalyses(
  db: Database,
  actor: ActorContext,
  query: CreditAnalysisListQuery,
): Promise<CreditAnalysisListResponse> {
  const { data, total } = await findAnalyses(db, actor.organizationId, actor.cityScopeIds, query);

  const items = await Promise.all(data.map((a) => toAnalysisResponse(db, a)));

  return {
    data: items,
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

export async function getAnalysisById(
  db: Database,
  actor: ActorContext,
  analysisId: string,
): Promise<CreditAnalysisResponse> {
  const analysis = await findAnalysisById(db, analysisId, actor.organizationId, actor.cityScopeIds);
  if (!analysis) throw new NotFoundError('Análise de crédito não encontrada');

  return toAnalysisResponse(db, analysis);
}

// ---------------------------------------------------------------------------
// List by lead
// ---------------------------------------------------------------------------

export async function listAnalysesByLead(
  db: Database,
  actor: ActorContext,
  leadId: string,
  query: CreditAnalysisListQuery,
): Promise<CreditAnalysisListResponse> {
  const { data, total } = await findAnalysesByLeadId(
    db,
    leadId,
    actor.organizationId,
    actor.cityScopeIds,
    query,
  );

  const items = await Promise.all(data.map((a) => toAnalysisResponse(db, a)));

  return {
    data: items,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

// ---------------------------------------------------------------------------
// Create analysis (+ 1ª versão) — 1 transação
// ---------------------------------------------------------------------------

export async function createAnalysis(
  db: Database,
  actor: ActorContext,
  body: CreditAnalysisCreate,
): Promise<CreditAnalysisResponse> {
  const analysis = await db.transaction(async (tx) => {
    const txDb = tx as unknown as Database;

    // 1. Inserir análise de crédito (sem versão ainda)
    // Race/duplicata: o índice único parcial uq_credit_analyses_org_lead_active
    // impede 2 análises ativas por lead — mapeamos 23505 para 409 (não 500).
    let created: CreditAnalysis;
    try {
      created = await insertAnalysis(txDb, {
        organizationId: actor.organizationId,
        leadId: body.lead_id,
        customerId: body.customer_id ?? null,
        simulationId: body.simulation_id ?? null,
        analystUserId: body.analyst_user_id ?? actor.userId,
        status: body.status,
        origin: body.origin,
      });
    } catch (err: unknown) {
      if (isUniqueViolation(err, 'uq_credit_analyses_org_lead_active')) {
        throw new AnalysisActiveExistsError();
      }
      throw err;
    }

    // 2. Inserir 1ª versão (parecer inicial)
    const version = await insertVersion(txDb, {
      analysisId: created.id,
      version: 1,
      status: body.status,
      parecerText: body.parecer_text,
      pendencias: body.pendencias,
      attachments: body.attachments,
      authorUserId: actor.userId,
    });

    // 3. Atualizar current_version_id na análise
    const updated = await updateAnalysis(txDb, created.id, actor.organizationId, {
      currentVersionId: version.id,
      updatedAt: new Date(),
    });

    if (!updated) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Falha ao atualizar current_version_id');
    }

    // 4. Outbox event — sem PII bruta (Art. 20 §1º)
    await emit(txDb, {
      eventName: 'credit_analysis.created',
      aggregateType: 'credit_analysis',
      aggregateId: created.id,
      organizationId: actor.organizationId,
      actor: { kind: 'user', id: actor.userId, ip: actor.ip ?? null },
      idempotencyKey: `credit_analysis.created:${created.id}`,
      data: {
        analysis_id: created.id,
        lead_id: created.leadId,
        organization_id: created.organizationId,
        status: body.status,
        origin: body.origin,
      },
    });

    // 5. Audit log — LGPD §8.5: parecer_text truncado em 200 chars
    await auditLog(txDb, {
      organizationId: actor.organizationId,
      actor: {
        userId: actor.userId,
        role: actor.role,
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
      },
      action: 'credit_analyses.create',
      resource: { type: 'credit_analysis', id: created.id },
      before: null,
      after: {
        analysis_id: created.id,
        lead_id: created.leadId,
        status: body.status,
        origin: body.origin,
        analyst_user_id: updated.analystUserId ?? null,
        version: 1,
        // parecer truncado — texto completo em credit_analysis_versions (imutável)
        parecer_text_preview: truncateParecer(body.parecer_text),
        created_at: created.createdAt.toISOString(),
      },
    });

    return updated;
  });

  return toAnalysisResponse(db, analysis);
}

// ---------------------------------------------------------------------------
// Add version — 1 transação
// ---------------------------------------------------------------------------

export async function addVersion(
  db: Database,
  actor: ActorContext,
  analysisId: string,
  body: CreditAnalysisVersionCreate,
): Promise<CreditAnalysisResponse> {
  // Pre-flight: verificar existência e scope
  const existing = await findAnalysisById(db, analysisId, actor.organizationId, actor.cityScopeIds);
  if (!existing) throw new NotFoundError('Análise de crédito não encontrada');

  // Não permitir nova versão em análise cancelada
  if (existing.status === 'cancelado') {
    throw new AppError(409, 'CONFLICT', 'Não é possível adicionar versão a uma análise cancelada', {
      code: 'ANALYSIS_CANCELLED',
    });
  }

  const approvedAmount =
    body.approved_amount !== null && body.approved_amount !== undefined
      ? String(body.approved_amount)
      : null;
  const approvedRateMonthly =
    body.approved_rate_monthly !== null && body.approved_rate_monthly !== undefined
      ? String(body.approved_rate_monthly)
      : null;

  const updated = await db.transaction(async (tx) => {
    const txDb = tx as unknown as Database;

    // 1. Calcular próxima versão
    const versionNumber = await nextVersionNumber(txDb, analysisId);

    // 2. Inserir nova versão
    const version = await insertVersion(txDb, {
      analysisId,
      version: versionNumber,
      status: body.status,
      parecerText: body.parecer_text,
      pendencias: body.pendencias,
      attachments: body.attachments,
      authorUserId: actor.userId,
    });

    // 3. Atualizar cabeçalho da análise
    const result = await updateAnalysis(txDb, analysisId, actor.organizationId, {
      status: body.status,
      currentVersionId: version.id,
      approvedAmount,
      approvedTermMonths: body.approved_term_months ?? null,
      approvedRateMonthly,
      updatedAt: new Date(),
    });

    if (!result) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Falha ao atualizar análise');
    }

    // 4. Outbox — sem PII bruta
    await emit(txDb, {
      eventName: 'credit_analysis.version_added',
      aggregateType: 'credit_analysis',
      aggregateId: analysisId,
      organizationId: actor.organizationId,
      actor: { kind: 'user', id: actor.userId, ip: actor.ip ?? null },
      idempotencyKey: `credit_analysis.version_added:${version.id}`,
      data: {
        analysis_id: analysisId,
        version: versionNumber,
        status: body.status,
        version_id: version.id,
      },
    });

    // 5. Audit log — parecer truncado
    await auditLog(txDb, {
      organizationId: actor.organizationId,
      actor: {
        userId: actor.userId,
        role: actor.role,
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
      },
      action: 'credit_analyses.add_version',
      resource: { type: 'credit_analysis', id: analysisId },
      before: {
        status: existing.status,
        current_version_id: existing.currentVersionId ?? null,
      },
      after: {
        status: body.status,
        current_version_id: version.id,
        version: versionNumber,
        parecer_text_preview: truncateParecer(body.parecer_text),
        author_user_id: actor.userId,
      },
    });

    return result;
  });

  return toAnalysisResponse(db, updated);
}

// ---------------------------------------------------------------------------
// Decide (aprovado | recusado) — 1 transação
// ---------------------------------------------------------------------------

export async function decideAnalysis(
  db: Database,
  actor: ActorContext,
  analysisId: string,
  body: CreditAnalysisDecide,
): Promise<CreditAnalysisResponse> {
  // Pre-flight: verificar existência e scope
  const existing = await findAnalysisById(db, analysisId, actor.organizationId, actor.cityScopeIds);
  if (!existing) throw new NotFoundError('Análise de crédito não encontrada');

  // Validar transição de status
  if (!DECIDABLE_STATUSES.has(existing.status)) {
    throw new AppError(
      409,
      'CONFLICT',
      `Não é possível decidir análise com status "${existing.status}". Status esperado: em_analise ou pendente.`,
      { code: 'INVALID_STATUS_TRANSITION', current_status: existing.status },
    );
  }

  // Quando aprovado, os campos financeiros são obrigatórios
  if (body.decision === 'aprovado') {
    if (
      body.approved_amount === null ||
      body.approved_amount === undefined ||
      body.approved_term_months === null ||
      body.approved_term_months === undefined ||
      body.approved_rate_monthly === null ||
      body.approved_rate_monthly === undefined
    ) {
      throw new AppError(
        422,
        'VALIDATION_ERROR',
        'approved_amount, approved_term_months e approved_rate_monthly são obrigatórios para aprovação',
        { code: 'APPROVAL_FIELDS_REQUIRED' },
      );
    }
  }

  const fromStatus = existing.status;
  const toStatus = body.decision;

  const approvedAmount =
    body.approved_amount !== null && body.approved_amount !== undefined
      ? String(body.approved_amount)
      : null;
  const approvedRateMonthly =
    body.approved_rate_monthly !== null && body.approved_rate_monthly !== undefined
      ? String(body.approved_rate_monthly)
      : null;

  const updated = await db.transaction(async (tx) => {
    const txDb = tx as unknown as Database;

    // 1. Próxima versão
    const versionNumber = await nextVersionNumber(txDb, analysisId);

    // 2. Inserir versão de decisão
    const version = await insertVersion(txDb, {
      analysisId,
      version: versionNumber,
      status: toStatus,
      parecerText: body.parecer_text,
      pendencias: body.pendencias,
      attachments: body.attachments,
      authorUserId: actor.userId,
    });

    // 3. Atualizar análise
    const result = await updateAnalysis(txDb, analysisId, actor.organizationId, {
      status: toStatus,
      currentVersionId: version.id,
      approvedAmount: body.decision === 'aprovado' ? approvedAmount : null,
      approvedTermMonths: body.decision === 'aprovado' ? (body.approved_term_months ?? null) : null,
      approvedRateMonthly: body.decision === 'aprovado' ? approvedRateMonthly : null,
      updatedAt: new Date(),
    });

    if (!result) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Falha ao atualizar análise após decisão');
    }

    // 4. Outbox status_changed — para worker do Kanban (F4-S05) consumir
    await emit(txDb, {
      eventName: 'credit_analysis.status_changed',
      aggregateType: 'credit_analysis',
      aggregateId: analysisId,
      organizationId: actor.organizationId,
      actor: { kind: 'user', id: actor.userId, ip: actor.ip ?? null },
      idempotencyKey: `credit_analysis.status_changed:${analysisId}:${version.id}`,
      data: {
        analysis_id: analysisId,
        lead_id: existing.leadId,
        from_status: fromStatus,
        to_status: toStatus,
        version_id: version.id,
      },
    });

    // 5. Audit log — rastreabilidade obrigatória Art. 20 §1º LGPD
    await auditLog(txDb, {
      organizationId: actor.organizationId,
      actor: {
        userId: actor.userId,
        role: actor.role,
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
      },
      action: 'credit_analyses.decide',
      resource: { type: 'credit_analysis', id: analysisId },
      before: {
        status: fromStatus,
        current_version_id: existing.currentVersionId ?? null,
      },
      after: {
        status: toStatus,
        current_version_id: version.id,
        version: versionNumber,
        analyst_user_id: actor.userId,
        parecer_text_preview: truncateParecer(body.parecer_text),
        decided_at: new Date().toISOString(),
      },
    });

    return result;
  });

  return toAnalysisResponse(db, updated);
}

// ---------------------------------------------------------------------------
// Request-review — Art. 20 §5 LGPD — 1 transação
// ---------------------------------------------------------------------------

/**
 * Solicita revisão humana da análise pelo titular dos dados.
 * Insere nova versão com status em_analise e parecer padrão de revisão.
 * Emite credit_analysis.review_requested para o outbox.
 * Bloqueia novas decisões automáticas até que um analista humano emita parecer.
 *
 * LGPD Art. 20 §5: o titular tem direito a solicitar revisão humana de
 * decisões automatizadas que afetem seus interesses. Esta rota implementa
 * o mecanismo de exercício desse direito.
 *
 * Segurança: qualquer usuário com credit_analyses:request_review pode chamar,
 * mas o RBAC do authorize() já restringe (agente só para leads atribuídos).
 */
export async function requestReview(
  db: Database,
  actor: ActorContext,
  analysisId: string,
  body: CreditAnalysisRequestReview,
): Promise<CreditAnalysisResponse> {
  // Pre-flight: verificar existência e scope
  const existing = await findAnalysisById(db, analysisId, actor.organizationId, actor.cityScopeIds);
  if (!existing) throw new NotFoundError('Análise de crédito não encontrada');

  // request-review não pode ser feito em análise cancelada
  if (existing.status === 'cancelado') {
    throw new AppError(
      409,
      'CONFLICT',
      'Não é possível solicitar revisão de uma análise cancelada',
      { code: 'ANALYSIS_CANCELLED' },
    );
  }

  // request-review não tem sentido em análise já em revisão (em_analise)
  // mas não bloqueamos — pode ser re-solicitado para constar no histórico.

  // Texto padrão LGPD Art. 20 §5 — indica inequivocamente revisão humana solicitada.
  const parecerText =
    body.reason !== null && body.reason !== undefined && body.reason.trim().length > 0
      ? `Revisão solicitada pelo titular (LGPD Art. 20 §5): ${body.reason.trim()}`
      : 'Revisão solicitada pelo titular (LGPD Art. 20 §5)';

  const updated = await db.transaction(async (tx) => {
    const txDb = tx as unknown as Database;

    // 1. Próxima versão
    const versionNumber = await nextVersionNumber(txDb, analysisId);

    // 2. Inserir versão de revisão
    const version = await insertVersion(txDb, {
      analysisId,
      version: versionNumber,
      status: 'em_analise',
      parecerText,
      pendencias: [],
      attachments: [],
      authorUserId: actor.userId,
    });

    // 3. Resetar status para em_analise (bloqueia decisão automática)
    // Se a análise estava em status terminal (aprovado/recusado), limpar campos de
    // aprovação para que o novo analista preencha do zero.
    // exactOptionalPropertyTypes: não passamos undefined explícito — omitimos o campo
    // ou passamos null (que é aceito pelo UpdateAnalysisInput).
    const approvalReset = TERMINAL_STATUSES.has(existing.status)
      ? {
          approvedAmount: null as null,
          approvedTermMonths: null as null,
          approvedRateMonthly: null as null,
        }
      : {};

    const result = await updateAnalysis(txDb, analysisId, actor.organizationId, {
      status: 'em_analise',
      currentVersionId: version.id,
      ...approvalReset,
      updatedAt: new Date(),
    });

    if (!result) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Falha ao atualizar análise para revisão');
    }

    // 4. Outbox — LGPD Art. 20 §5: sem PII bruta
    await emit(txDb, {
      eventName: 'credit_analysis.review_requested',
      aggregateType: 'credit_analysis',
      aggregateId: analysisId,
      organizationId: actor.organizationId,
      actor: { kind: 'user', id: actor.userId, ip: actor.ip ?? null },
      idempotencyKey: `credit_analysis.review_requested:${analysisId}:${version.id}`,
      data: {
        analysis_id: analysisId,
        lead_id: existing.leadId,
        requested_by_user_id: actor.userId,
      },
    });

    // 5. Audit log — rastreabilidade Art. 20 §5
    await auditLog(txDb, {
      organizationId: actor.organizationId,
      actor: {
        userId: actor.userId,
        role: actor.role,
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
      },
      action: 'credit_analyses.request_review',
      resource: { type: 'credit_analysis', id: analysisId },
      before: {
        status: existing.status,
        current_version_id: existing.currentVersionId ?? null,
      },
      after: {
        status: 'em_analise',
        current_version_id: version.id,
        version: versionNumber,
        requested_by_user_id: actor.userId,
        lgpd_basis: 'Art. 20 §5 — direito de revisão por humano',
        requested_at: new Date().toISOString(),
      },
    });

    return result;
  });

  return toAnalysisResponse(db, updated);
}

// ---------------------------------------------------------------------------
// Verificação de acesso ao lead (para endpoint /leads/:leadId/credit-analyses)
// ---------------------------------------------------------------------------

/**
 * Verifica se o actor tem acesso ao lead dentro do seu city-scope.
 * Lança ForbiddenError se o lead não pertence ao scope do usuário.
 * Usa NOT FOUND semântico (404) para não vazar existência do lead.
 */
export async function assertLeadAccess(
  db: Database,
  actor: ActorContext,
  leadId: string,
): Promise<void> {
  // Busca análises pelo lead — se o array for vazio mas o lead existe fora do scope,
  // findAnalysesByLeadId retorna vazio (city-scope aplicado).
  // Para verificar acesso puro ao lead, buscamos diretamente no leads table.
  // Importação dinâmica para evitar dependência circular (leads <-> credit-analyses).
  const { findLeadById } = await import('../leads/repository.js');
  const lead = await findLeadById(db, leadId, actor.organizationId, actor.cityScopeIds);
  if (!lead) {
    throw new ForbiddenError('Lead não encontrado ou fora do escopo do usuário');
  }
}
