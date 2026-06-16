// =============================================================================
// handlers/auto-contract-from-analysis.ts — Handler de auto-contrato (F17-S13).
//
// Responsabilidade:
//   Consome eventos credit_analysis.status_changed (via outbox-publisher) e,
//   conforme o to_status:
//
//   aprovado → upsert idempotente de contrato draft:
//     1. Fetch análise via creditAnalysesRepository.findAnalysisById.
//     2. Se customer_id === null → log warning + return (skip silencioso).
//     3. Buscar contrato existente por (org, analysis_id):
//        - Não existe   → INSERT draft com campos aprovados.
//        - Existe draft  → UPDATE com novos valores (re-aprovação).
//        - Existe !draft → skip (não destrói contrato assinado/ativo).
//     4. Audit log + outbox (sem PII).
//
//   recusado → cancela draft vinculado (se existir e status=draft):
//     1. Buscar contrato por (org, analysis_id).
//     2. Se existe e draft → UPDATE status='cancelled' + audit log.
//     3. Senão → skip silencioso.
//
//   Outros status → ignorado silenciosamente.
//
// Padrão de assinatura (EventOutbox):
//   O handler recebe EventOutbox (registro bruto do banco, payload: unknown),
//   seguindo o padrão canônico de kanban-on-analysis.ts. A fábrica
//   buildAutoContractFromAnalysisHandler() retorna a fn compatível com
//   registerHandler() em workers/index.ts.
//
// Idempotência:
//   Unique constraint parcial (org, analysis_id) WHERE NOT NULL no banco
//   impede duplicatas. Handler idempotente por design: rodar 2x com mesmo
//   evento não cria duplicatas.
//
// LGPD §8.5:
//   - Outbox events carregam apenas IDs opacos — sem PII bruta.
//   - audit log carrega apenas IDs e status — sem CPF, nome ou telefone.
//   - Logs com apenas IDs opacos — sem PII direta.
// =============================================================================
import pino from 'pino';

import { env } from '../config/env.js';
import type { Database } from '../db/client.js';
import { db as defaultDb } from '../db/client.js';
import type { EventOutbox } from '../db/schema/events.js';
import { emit } from '../events/emit.js';
import type { DrizzleTx } from '../events/emit.js';
import type {
  ContractAutoCreatedData,
  ContractAutoUpdatedData,
  CreditAnalysisStatusChangedData,
} from '../events/types.js';
import { auditLog } from '../lib/audit.js';
import type { AuditTx } from '../lib/audit.js';
import {
  cancelAutoContractDraft,
  createAutoContractDraft,
  findContractByAnalysisId,
  updateAutoContractDraft,
} from '../modules/contracts/repository.js';
import { findAnalysisById } from '../modules/credit-analyses/repository.js';

// ---------------------------------------------------------------------------
// Logger — LGPD §8.5: redact de campos sensíveis
// ---------------------------------------------------------------------------

const REDACT_PATHS = ['*.cpf', '*.email', '*.telefone', '*.phone', '*.nome', '*.name'];

const logger = pino({
  name: 'auto-contract-from-analysis',
  level: env.LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  ...(env.NODE_ENV === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
        },
      }
    : {}),
});

// ---------------------------------------------------------------------------
// Geração de contract_reference automática
// ---------------------------------------------------------------------------

/**
 * Gera referência canônica para contrato criado automaticamente.
 * Formato: ANA-{ano}-{8 primeiros chars do analysisId em uppercase sem hífens}.
 * Não contém PII — apenas ano corrente + fragmento de UUID opaco.
 */
function buildAutoContractReference(analysisId: string): string {
  const year = new Date().getFullYear();
  const fragment = analysisId.replace(/-/g, '').slice(0, 8).toUpperCase();
  return `ANA-${year}-${fragment}`;
}

// ---------------------------------------------------------------------------
// Processamento de status 'aprovado'
// ---------------------------------------------------------------------------

/**
 * Processa análise aprovada: upsert idempotente de contrato draft.
 *
 * Fluxo:
 *   1. Fetch análise — precisa de customer_id, approved_amount, approved_term_months,
 *      approved_rate_monthly, organization_id.
 *   2. customer_id null → warning + return.
 *   3. Buscar contrato existente por (org, analysis_id).
 *   4. Não existe → INSERT draft.
 *   5. Existe e draft → UPDATE com novos valores aprovados.
 *   6. Existe e !draft → skip (contrato assinado/ativo não é sobrescrito).
 *   7. Audit log + outbox dentro da mesma transação.
 */
async function handleAprovado(
  db: Database,
  data: CreditAnalysisStatusChangedData,
  organizationId: string,
  correlationId: string | null,
): Promise<void> {
  const { analysis_id, version_id } = data;

  // Fetch análise — necessário para obter campos financeiros aprovados.
  // O evento credit_analysis.status_changed NÃO carrega esses campos.
  // cityScopeIds = null → handler de sistema, acesso global.
  const analysis = await findAnalysisById(db, analysis_id, organizationId, null);

  if (!analysis) {
    // Pode ocorrer em rollback ou race condition — skip silencioso.
    logger.warn(
      {
        analysis_id,
        organization_id: organizationId,
        event_name: 'credit_analysis.status_changed',
      },
      'auto-contract: análise não encontrada — skip',
    );
    return;
  }

  if (analysis.customerId === null) {
    logger.warn(
      {
        analysis_id,
        organization_id: organizationId,
        event_name: 'credit_analysis.status_changed',
      },
      'auto-contract: customer_id nulo — análise sem cliente vinculado, skip silencioso',
    );
    return;
  }

  const customerId = analysis.customerId;

  // Validação defensiva: campos financeiros devem estar presentes em análise aprovada.
  if (
    analysis.approvedAmount === null ||
    analysis.approvedAmount === undefined ||
    analysis.approvedTermMonths === null ||
    analysis.approvedTermMonths === undefined
  ) {
    logger.warn(
      { analysis_id, organization_id: organizationId },
      'auto-contract: approved_amount ou approved_term_months ausentes — skip',
    );
    return;
  }

  const approvedAmount = analysis.approvedAmount;
  const approvedTermMonths = analysis.approvedTermMonths;
  const approvedRateMonthly = analysis.approvedRateMonthly ?? null;

  // Buscar contrato existente por (org, analysis_id)
  const existing = await findContractByAnalysisId(db, organizationId, analysis_id);

  if (existing !== null && existing.status !== 'draft') {
    logger.info(
      {
        analysis_id,
        contract_id: existing.id,
        contract_status: existing.status,
        organization_id: organizationId,
      },
      'auto-contract: contrato já existe com status não-draft — skip (preserva estado)',
    );
    return;
  }

  await db.transaction(async (tx) => {
    // `as` justificados: Drizzle não exporta tipo público da transação.
    // Database, DrizzleTx e AuditTx são interfaces estruturais compatíveis.
    const txDb = tx as unknown as Database;
    const txForEmit = tx as unknown as DrizzleTx;
    const txForAudit = tx as unknown as AuditTx;

    if (existing === null) {
      // INSERT draft
      const contractRef = buildAutoContractReference(analysis_id);
      const created = await createAutoContractDraft(txDb, {
        organizationId,
        customerId,
        contractReference: contractRef,
        principalAmount: approvedAmount,
        termMonths: approvedTermMonths,
        monthlyRateSnapshot: approvedRateMonthly,
        analysisId: analysis_id,
      });

      logger.info(
        {
          contract_id: created.id,
          analysis_id,
          organization_id: organizationId,
          version_id,
        },
        'auto-contract: contrato draft criado automaticamente',
      );

      // Audit log — sem PII
      await auditLog(txForAudit, {
        organizationId,
        actor: null,
        action: 'contract.auto_created',
        resource: { type: 'contract', id: created.id },
        after: {
          contract_id: created.id,
          analysis_id,
          contract_reference: created.contract_reference,
          status: created.status,
        },
        correlationId,
      });

      // Outbox — LGPD §8.5: apenas IDs opacos
      const eventData: ContractAutoCreatedData = {
        contract_id: created.id,
        analysis_id,
        organization_id: organizationId,
      };

      await emit(txForEmit, {
        eventName: 'contract.auto_created',
        aggregateType: 'contract',
        aggregateId: created.id,
        organizationId,
        actor: { kind: 'system', id: null, ip: null },
        idempotencyKey: `contract.auto_created:${analysis_id}`,
        data: eventData,
        ...(correlationId !== null ? { correlationId } : {}),
      });
    } else {
      // UPDATE draft com novos valores aprovados (re-aprovação)
      const updated = await updateAutoContractDraft(txDb, existing.id, organizationId, {
        principalAmount: approvedAmount,
        termMonths: approvedTermMonths,
        monthlyRateSnapshot: approvedRateMonthly,
      });

      logger.info(
        {
          contract_id: updated.id,
          analysis_id,
          organization_id: organizationId,
          version_id,
        },
        'auto-contract: contrato draft atualizado com novos valores aprovados',
      );

      // Audit log — sem PII
      await auditLog(txForAudit, {
        organizationId,
        actor: null,
        action: 'contract.auto_updated',
        resource: { type: 'contract', id: updated.id },
        before: {
          principal_amount: existing.principal_amount,
          term_months: existing.term_months,
          monthly_rate_snapshot: existing.monthly_rate_snapshot,
        },
        after: {
          principal_amount: updated.principal_amount,
          term_months: updated.term_months,
          monthly_rate_snapshot: updated.monthly_rate_snapshot,
        },
        correlationId,
      });

      // Outbox — LGPD §8.5: apenas IDs opacos
      const eventData: ContractAutoUpdatedData = {
        contract_id: updated.id,
        analysis_id,
        organization_id: organizationId,
      };

      await emit(txForEmit, {
        eventName: 'contract.auto_updated',
        aggregateType: 'contract',
        aggregateId: updated.id,
        organizationId,
        actor: { kind: 'system', id: null, ip: null },
        idempotencyKey: `contract.auto_updated:${analysis_id}:${version_id}`,
        data: eventData,
        ...(correlationId !== null ? { correlationId } : {}),
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Processamento de status 'recusado'
// ---------------------------------------------------------------------------

/**
 * Processa análise recusada: cancela o draft vinculado (se existir).
 *
 * Fluxo:
 *   1. Buscar contrato por (org, analysis_id).
 *   2. Não existe → skip silencioso.
 *   3. Existe e !draft → skip silencioso (não destrói contrato assinado).
 *   4. Existe e draft → UPDATE status='cancelled' + audit log.
 */
async function handleRecusado(
  db: Database,
  data: CreditAnalysisStatusChangedData,
  organizationId: string,
  correlationId: string | null,
): Promise<void> {
  const { analysis_id } = data;

  const existing = await findContractByAnalysisId(db, organizationId, analysis_id);

  if (existing === null) {
    logger.debug(
      { analysis_id, organization_id: organizationId },
      'auto-contract: análise recusada sem contrato vinculado — skip',
    );
    return;
  }

  if (existing.status !== 'draft') {
    logger.info(
      {
        analysis_id,
        contract_id: existing.id,
        contract_status: existing.status,
        organization_id: organizationId,
      },
      'auto-contract: contrato já em status não-draft — skip (preserva estado)',
    );
    return;
  }

  await db.transaction(async (tx) => {
    const txDb = tx as unknown as Database;
    const txForAudit = tx as unknown as AuditTx;

    const cancelled = await cancelAutoContractDraft(txDb, existing.id, organizationId);

    logger.info(
      {
        contract_id: cancelled.id,
        analysis_id,
        organization_id: organizationId,
      },
      'auto-contract: contrato draft cancelado por recusa da análise',
    );

    // Audit log — sem PII
    await auditLog(txForAudit, {
      organizationId,
      actor: null,
      action: 'contract.auto_cancelled',
      resource: { type: 'contract', id: cancelled.id },
      before: { status: existing.status },
      after: { status: 'cancelled', analysis_id },
      correlationId,
    });
  });
}

// ---------------------------------------------------------------------------
// Handler principal (aceita EventOutbox — padrão canônico do outbox-publisher)
// ---------------------------------------------------------------------------

/**
 * Processa um evento credit_analysis.status_changed:
 *   - aprovado  → cria ou atualiza contrato draft por (org, analysis_id)
 *   - recusado  → cancela draft vinculado (se existir)
 *   - outros    → ignora silenciosamente
 *
 * Recebe EventOutbox (raw DB record, payload: unknown) — mesmo padrão de
 * kanban-on-analysis.ts. Extrai e valida campos antes de usar.
 *
 * @param event  Registro bruto do outbox (payload: unknown).
 * @param db     Instância Drizzle injetável (facilita testes).
 */
export async function handleAutoContractFromAnalysis(
  event: EventOutbox,
  db: Database = defaultDb,
): Promise<void> {
  const childLogger = logger.child({ correlation_id: event.id });

  // Justificativa do `as`: event.payload é unknown por design do outbox (§8.5).
  // Validamos os campos essenciais antes de usá-los.
  const payload = event.payload as Partial<CreditAnalysisStatusChangedData>;

  const analysisId = payload.analysis_id;
  const toStatus = payload.to_status;
  const fromStatus = payload.from_status ?? '';
  const versionId = payload.version_id;
  const leadId = payload.lead_id;
  const organizationId = event.organizationId;

  if (!analysisId || !toStatus) {
    childLogger.warn(
      {
        eventId: event.id,
        hasAnalysisId: Boolean(analysisId),
        hasToStatus: Boolean(toStatus),
      },
      'auto-contract: payload inválido — analysis_id ou to_status ausente; skip',
    );
    return;
  }

  childLogger.info(
    {
      event_id: event.id,
      analysis_id: analysisId,
      from_status: fromStatus,
      to_status: toStatus,
      organization_id: organizationId,
    },
    'auto-contract: processando evento credit_analysis.status_changed',
  );

  // Monta dados tipados para os sub-handlers (que precisam dos campos validados)
  const data: CreditAnalysisStatusChangedData = {
    analysis_id: analysisId,
    lead_id: leadId ?? '',
    from_status: fromStatus,
    to_status: toStatus,
    version_id: versionId ?? '',
  };

  // correlationId: usa event.id como correlação ao evento de origem
  const correlationId = event.id;

  if (toStatus === 'aprovado') {
    await handleAprovado(db, data, organizationId, correlationId);
    return;
  }

  if (toStatus === 'recusado') {
    await handleRecusado(db, data, organizationId, correlationId);
    return;
  }

  childLogger.debug(
    { analysis_id: analysisId, to_status: toStatus },
    'auto-contract: to_status não requer ação — ignorando',
  );
}

// ---------------------------------------------------------------------------
// Fábrica de EventHandler — compatível com RegisteredHandler.fn
// ---------------------------------------------------------------------------

/**
 * Retorna um EventHandler pronto para registrar via registerHandler().
 *
 * Usa db singleton de db/client.js. Chamado em workers/index.ts → setupWorkerHandlers().
 * Injeção via argumento _db disponível apenas em testes.
 */
export function buildAutoContractFromAnalysisHandler(
  _db: Database = defaultDb,
): (event: EventOutbox) => Promise<void> {
  return (event: EventOutbox) => handleAutoContractFromAnalysis(event, _db);
}
