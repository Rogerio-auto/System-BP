// =============================================================================
// workers/followup-sender.ts — Worker de envio de follow-ups via Meta WhatsApp (F5-S03).
//
// Processo Node.js SEPARADO. Iniciado via: pnpm --filter @elemento/api worker:followup:sender
//
// F20-S03: credenciais WhatsApp agora resolvidas da tabela `channels` via
//   resolveChannelForSend(db, orgId, job.channelId). Credenciais de env não são
//   mais usadas. Jobs com channel_id=NULL fazem fallback para canal default da org.
//
// Responsabilidade:
//   Para cada tick, busca lote de followup_jobs com status='scheduled' e
//   scheduled_at <= now(). Para cada job:
//     1. Valida lead ativo (não deletado, não arquivado).
//     2. Verifica consentimento: customer.consent_revoked_at IS NULL.
//     3. Renderiza variáveis do template a partir dos dados do lead.
//     4. Resolve canal WhatsApp via resolveChannelForSend.
//     5. Chama Meta WhatsApp Cloud API via MetaWhatsAppClient.
//     6. Atualiza job: status='sent', sent_message_id=wamid, attempt_count++.
//     7. Emite outbox 'followup.sent' + auditLog na mesma transação.
//
// Em caso de erro:
//     - attempt_count++ + last_error
//     - Se attempt_count >= rule.max_attempts: status='failed' (terminal)
//     - Backoff exponencial: scheduled_at = now() + exponential_backoff(attempt_count)
//     - Emite outbox 'followup.failed' (terminal=true se final)
//
// Flag-gating em 2 camadas:
//   Camada 1 — followup.enabled=disabled:
//     Worker sai cedo. Nenhuma query de jobs executada.
//   Camada 2 — followup.sender.enabled=disabled:
//     Lógica roda completa (identifica jobs, renderiza variáveis), mas NÃO
//     chama a Meta API. Loga dry_run=true com mensagem composta para auditoria.
//
// LGPD §8.3/§8.5:
//   - Telefone (`phoneE164`) NUNCA em logs — MetaWhatsAppClient usa `to_hash` internamente.
//   - Outbox sem PII bruta: payloads carregam apenas IDs opacos + template_key + wamid.
//   - Consentimento verificado antes de qualquer chamada à Meta.
//   - Audit log por envio (janela 24h: template é única forma de mensagem fora da janela).
// =============================================================================

import { and, eq, lte } from 'drizzle-orm';

import { env } from '../config/env.js';
import { db as defaultDb } from '../db/client.js';
import type { Database } from '../db/client.js';
import {
  creditSimulations,
  customers,
  followupJobs,
  followupRules,
  leads,
  whatsappTemplates,
} from '../db/schema/index.js';
import type { FollowupJob, FollowupRule } from '../db/schema/index.js';
import type { WhatsappTemplate } from '../db/schema/index.js';
import { emit } from '../events/emit.js';
import type { DrizzleTx } from '../events/emit.js';
import type { FollowupFailedData, FollowupSentData } from '../events/types.js';
import { MetaWhatsAppClient } from '../integrations/meta-whatsapp/client.js';
import type { SendTemplateParams } from '../integrations/meta-whatsapp/types.js';
import { auditLog } from '../lib/audit.js';
import type { AuditTx } from '../lib/audit.js';
import { resolveChannelForSend } from '../modules/channels/channel-selection.service.js';
import { isFlagEnabled } from '../modules/featureFlags/service.js';
import { ExternalServiceError } from '../shared/errors.js';

import { createWorkerRuntime } from './_runtime.js';

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

const WORKER_NAME = 'followup-sender';

/** Tamanho do lote por tick. */
const BATCH_SIZE = 50;

/** Default do tick em ms. Sobrescrito por FOLLOWUP_SENDER_TICK_MS. */
const DEFAULT_TICK_MS = 30_000;

/** Base do backoff exponencial para re-agendamento em falha (ms). */
const BACKOFF_BASE_MS = 5 * 60 * 1000; // 5 minutos

/** Cap máximo do backoff (ms). */
const BACKOFF_MAX_MS = 24 * 60 * 60 * 1000; // 24 horas

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

/**
 * Contexto completo carregado para processar um job.
 */
export interface JobContext {
  job: FollowupJob;
  rule: FollowupRule;
  template: WhatsappTemplate;
  lead: {
    id: string;
    organizationId: string;
    name: string;
    phoneE164: string;
    status: string;
    deletedAt: Date | null;
    lastSimulationId: string | null;
  };
  /** null se lead não tem customer associado. */
  customer: {
    id: string;
    consentRevokedAt: Date | null;
  } | null;
  /** null se lead não tem simulação. */
  simulation: {
    id: string;
    amountRequested: string;
    monthlyPayment: string;
    termMonths: number;
  } | null;
}

/**
 * Resultado do processamento de um job no tick.
 */
export interface JobTickResult {
  jobId: string;
  leadId: string;
  templateKey: string;
  outcome: 'sent' | 'dry_run' | 'skipped' | 'failed' | 'consent_blocked';
  wamid?: string;
  error?: string;
  attemptCount: number;
  terminal: boolean;
}

// ---------------------------------------------------------------------------
// Interface mínima de logger
// ---------------------------------------------------------------------------

export interface SenderLogger {
  info(obj: object, msg?: string): void;
  debug(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

// ---------------------------------------------------------------------------
// Cálculo de backoff exponencial para re-agendamento
// ---------------------------------------------------------------------------

/**
 * Calcula o delay de backoff para re-agendar um job após falha.
 *
 * delay = min(base * 2^(attemptCount - 1), maxMs)
 * Ex: attempt=1 → 5min, attempt=2 → 10min, attempt=3 → 20min (cap=24h)
 *
 * @param attemptCount Número de tentativas já realizadas (1-indexed após a tentativa falha).
 */
export function calcJobBackoff(attemptCount: number): number {
  const exponential = BACKOFF_BASE_MS * Math.pow(2, attemptCount - 1);
  return Math.min(exponential, BACKOFF_MAX_MS);
}

// ---------------------------------------------------------------------------
// Renderização de variáveis do template
// ---------------------------------------------------------------------------

/**
 * Renderiza as variáveis do template a partir do contexto do lead.
 *
 * Mapeamento canônico de variáveis semânticas → valores:
 *   customer_name          → lead.name (nome do cliente)
 *   simulation_amount      → simulation.amountRequested formatado em BRL
 *   simulation_installment → simulation.monthlyPayment formatado em BRL
 *   simulation_term        → simulation.termMonths + " meses"
 *
 * LGPD: valores de variáveis não são logados em nível info.
 */
export function renderTemplateVariables(
  variables: string[],
  ctx: JobContext,
): Array<{ type: 'text'; text: string }> {
  const formatBrl = (value: string): string => {
    const num = parseFloat(value);
    if (!Number.isFinite(num)) return value;
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
    }).format(num);
  };

  return variables.map((varName) => {
    let text: string;

    switch (varName) {
      case 'customer_name':
        text = ctx.lead.name;
        break;
      case 'simulation_amount':
        text = ctx.simulation !== null ? formatBrl(ctx.simulation.amountRequested) : '';
        break;
      case 'simulation_installment':
        text = ctx.simulation !== null ? formatBrl(ctx.simulation.monthlyPayment) : '';
        break;
      case 'simulation_term':
        text = ctx.simulation !== null ? `${String(ctx.simulation.termMonths)} meses` : '';
        break;
      default:
        // Variável não mapeada — string vazia.
        // O template Meta falhará se o parâmetro for obrigatório e vazio.
        text = '';
    }

    return { type: 'text' as const, text };
  });
}

// ---------------------------------------------------------------------------
// Construção do payload de envio
// ---------------------------------------------------------------------------

/**
 * Monta os parâmetros para MetaWhatsAppClient.sendTemplate().
 * Componentes: apenas body com variáveis posicionais (MVP).
 * Header/buttons são suportados pela Meta mas não necessários no MVP.
 */
export function buildSendTemplateParams(ctx: JobContext): SendTemplateParams {
  const parameters = renderTemplateVariables(ctx.template.variables, ctx);

  return {
    to: ctx.lead.phoneE164,
    templateName: ctx.template.name,
    language: ctx.template.language,
    components: parameters.length > 0 ? [{ type: 'body', parameters }] : [],
  };
}

// ---------------------------------------------------------------------------
// Carregamento de contexto
// ---------------------------------------------------------------------------

/**
 * Carrega o contexto completo para processar um job.
 * Faz queries separadas para regra+template, lead, customer e simulação.
 *
 * Retorna null se regra, template ou lead não forem encontrados.
 *
 * LGPD: lead.name e lead.phone_e164 são carregados apenas para renderização —
 * nunca logados diretamente. Os logs usam apenas IDs.
 */
export async function loadJobContext(
  database: Database,
  job: FollowupJob,
): Promise<JobContext | null> {
  // 1. Carregar regra + template em join
  const ruleRows = await database
    .select({
      rule: followupRules,
      template: whatsappTemplates,
    })
    .from(followupRules)
    .innerJoin(whatsappTemplates, eq(followupRules.templateId, whatsappTemplates.id))
    .where(eq(followupRules.id, job.ruleId))
    .limit(1);

  const ruleRow = ruleRows[0];
  if (ruleRow === undefined) return null;

  // 2. Carregar lead
  const leadRows = await database
    .select({
      id: leads.id,
      organizationId: leads.organizationId,
      name: leads.name,
      phoneE164: leads.phoneE164,
      status: leads.status,
      deletedAt: leads.deletedAt,
      lastSimulationId: leads.lastSimulationId,
    })
    .from(leads)
    .where(eq(leads.id, job.leadId))
    .limit(1);

  const leadData = leadRows[0];
  if (leadData === undefined) return null;

  // 3. Verificar customer + consentimento (via primaryLeadId)
  const customerRows = await database
    .select({
      id: customers.id,
      consentRevokedAt: customers.consentRevokedAt,
    })
    .from(customers)
    .where(eq(customers.primaryLeadId, job.leadId))
    .limit(1);

  const customerData = customerRows[0] ?? null;

  // 4. Carregar simulação (opcional — só se lead tem lastSimulationId)
  let simulationData: JobContext['simulation'] = null;
  if (leadData.lastSimulationId !== null) {
    const simRows = await database
      .select({
        id: creditSimulations.id,
        amountRequested: creditSimulations.amountRequested,
        monthlyPayment: creditSimulations.monthlyPayment,
        termMonths: creditSimulations.termMonths,
      })
      .from(creditSimulations)
      .where(eq(creditSimulations.id, leadData.lastSimulationId))
      .limit(1);

    const simData = simRows[0];
    if (simData !== undefined) {
      simulationData = {
        id: simData.id,
        amountRequested: simData.amountRequested,
        monthlyPayment: simData.monthlyPayment,
        termMonths: simData.termMonths,
      };
    }
  }

  return {
    job,
    rule: ruleRow.rule,
    template: ruleRow.template,
    lead: leadData,
    customer: customerData,
    simulation: simulationData,
  };
}

// ---------------------------------------------------------------------------
// Processamento de um job
// ---------------------------------------------------------------------------

/**
 * Processa um único job de follow-up.
 *
 * @param database    Instância Drizzle (injetável para testes).
 * @param metaClient  Cliente Meta (injetável para testes). null = dry-run forçado.
 * @param job         Job a processar.
 * @param dryRun      Se true, não chama Meta API (flag followup.sender.enabled=disabled).
 * @param logger      Logger do worker.
 */
export async function processJob(
  database: Database,
  metaClient: MetaWhatsAppClient | null,
  job: FollowupJob,
  dryRun: boolean,
  logger: SenderLogger,
): Promise<JobTickResult> {
  // -------------------------------------------------------------------------
  // 1. Carregar contexto
  // -------------------------------------------------------------------------
  const ctx = await loadJobContext(database, job);

  if (ctx === null) {
    await database
      .update(followupJobs)
      .set({
        status: 'failed',
        attemptCount: job.attemptCount + 1,
        lastError: 'Contexto não encontrado: regra, template ou lead removidos',
        updatedAt: new Date(),
      })
      .where(eq(followupJobs.id, job.id));

    logger.warn(
      { event: 'sender.job_context_missing', job_id: job.id, lead_id: job.leadId },
      `job ${job.id}: contexto não encontrado — marcado como failed`,
    );

    return {
      jobId: job.id,
      leadId: job.leadId,
      templateKey: 'unknown',
      outcome: 'failed',
      error: 'contexto_missing',
      attemptCount: job.attemptCount + 1,
      terminal: true,
    };
  }

  // -------------------------------------------------------------------------
  // 2. Validar lead ativo
  // -------------------------------------------------------------------------
  if (ctx.lead.deletedAt !== null) {
    await database
      .update(followupJobs)
      .set({
        status: 'cancelled',
        lastError: 'Lead removido (soft-delete)',
        updatedAt: new Date(),
      })
      .where(eq(followupJobs.id, job.id));

    logger.info(
      { event: 'sender.job_skipped_deleted_lead', job_id: job.id, lead_id: job.leadId },
      `job ${job.id}: lead deletado — job cancelado`,
    );

    return {
      jobId: job.id,
      leadId: job.leadId,
      templateKey: ctx.template.name,
      outcome: 'skipped',
      attemptCount: job.attemptCount,
      terminal: true,
    };
  }

  if (ctx.lead.status === 'archived') {
    await database
      .update(followupJobs)
      .set({
        status: 'cancelled',
        lastError: 'Lead arquivado',
        updatedAt: new Date(),
      })
      .where(eq(followupJobs.id, job.id));

    logger.info(
      { event: 'sender.job_skipped_archived_lead', job_id: job.id, lead_id: job.leadId },
      `job ${job.id}: lead arquivado — job cancelado`,
    );

    return {
      jobId: job.id,
      leadId: job.leadId,
      templateKey: ctx.template.name,
      outcome: 'skipped',
      attemptCount: job.attemptCount,
      terminal: true,
    };
  }

  // -------------------------------------------------------------------------
  // 3. Verificar consentimento LGPD (doc 17)
  // Template fora da janela 24h requer consentimento ativo.
  // Se customer existe e revogou consentimento, não enviar.
  // -------------------------------------------------------------------------
  if (ctx.customer !== null && ctx.customer.consentRevokedAt !== null) {
    await database
      .update(followupJobs)
      .set({
        status: 'cancelled',
        lastError: 'Consentimento revogado pelo titular',
        updatedAt: new Date(),
      })
      .where(eq(followupJobs.id, job.id));

    logger.info(
      { event: 'sender.job_consent_blocked', job_id: job.id, lead_id: job.leadId },
      `job ${job.id}: consentimento revogado — job cancelado (LGPD)`,
    );

    return {
      jobId: job.id,
      leadId: job.leadId,
      templateKey: ctx.template.name,
      outcome: 'consent_blocked',
      attemptCount: job.attemptCount,
      terminal: true,
    };
  }

  // -------------------------------------------------------------------------
  // 4. Validar template aprovado
  // -------------------------------------------------------------------------
  if (ctx.template.status !== 'approved') {
    const newAttemptCount = job.attemptCount + 1;
    const errorMsg = `Template ${ctx.template.name} não está aprovado (status: ${ctx.template.status})`;

    await database
      .update(followupJobs)
      .set({
        status: 'failed',
        attemptCount: newAttemptCount,
        lastError: errorMsg,
        updatedAt: new Date(),
      })
      .where(eq(followupJobs.id, job.id));

    return {
      jobId: job.id,
      leadId: job.leadId,
      templateKey: ctx.template.name,
      outcome: 'failed',
      error: errorMsg,
      attemptCount: newAttemptCount,
      terminal: true,
    };
  }

  // -------------------------------------------------------------------------
  // 5. Lock otimista: marcar job como 'triggered' para evitar double-processing
  // UPDATE WHERE status='scheduled' falha silenciosamente se já processado.
  // -------------------------------------------------------------------------
  const lockResult = await database
    .update(followupJobs)
    .set({ status: 'triggered', updatedAt: new Date() })
    .where(and(eq(followupJobs.id, job.id), eq(followupJobs.status, 'scheduled')))
    .returning({ id: followupJobs.id });

  if (lockResult.length === 0) {
    logger.debug(
      { event: 'sender.job_lock_missed', job_id: job.id },
      `job ${job.id}: lock não obtido — processado por outra instância`,
    );

    return {
      jobId: job.id,
      leadId: job.leadId,
      templateKey: ctx.template.name,
      outcome: 'skipped',
      attemptCount: job.attemptCount,
      terminal: false,
    };
  }

  // -------------------------------------------------------------------------
  // 6. Renderizar variáveis e montar payload
  // -------------------------------------------------------------------------
  const sendParams = buildSendTemplateParams(ctx);
  const newAttemptCount = job.attemptCount + 1;

  // -------------------------------------------------------------------------
  // 7. Dry-run: logar mensagem composta sem chamar API
  // LGPD: não logar `to` — apenas template_name + component_count.
  // -------------------------------------------------------------------------
  if (dryRun) {
    logger.info(
      {
        event: 'sender.dry_run',
        job_id: job.id,
        lead_id: job.leadId,
        template_name: sendParams.templateName,
        language: sendParams.language,
        component_count: sendParams.components.length,
        dry_run: true,
      },
      `dry-run: job ${job.id} — template ${sendParams.templateName} composto mas não enviado`,
    );

    // Reverter para scheduled para ser reprocessado quando flag ligar.
    // Cooldown: avança scheduledAt em DEFAULT_TICK_MS para evitar log spam quando
    // a flag fica oscilando off entre ticks consecutivos.
    // Nota: em dry-run, não incrementamos attempt_count para preservar as tentativas reais.
    await database
      .update(followupJobs)
      .set({
        status: 'scheduled',
        scheduledAt: new Date(Date.now() + DEFAULT_TICK_MS),
        updatedAt: new Date(),
      })
      .where(eq(followupJobs.id, job.id));

    return {
      jobId: job.id,
      leadId: job.leadId,
      templateKey: ctx.template.name,
      outcome: 'dry_run',
      attemptCount: job.attemptCount,
      terminal: false,
    };
  }

  // -------------------------------------------------------------------------
  // 8. Resolver canal WhatsApp (quando nenhum cliente foi injetado externamente).
  //
  // `metaClient` é não-null apenas em testes que injetam o cliente diretamente.
  // Em produção, sempre será null → resolvedClient é instanciado aqui.
  //
  // Prioridade: job.channelId (canal explícito da regra) → canal default da org.
  // Jobs históricos com channel_id=NULL fazem fallback para canal default da org.
  //
  // LGPD §8.3: accessToken nunca logado — apenas channelId e channelName.
  // -------------------------------------------------------------------------
  let resolvedClient = metaClient;
  if (resolvedClient === null) {
    const resolved = await resolveChannelForSend(database, job.organizationId, job.channelId).catch(
      (err: unknown) => {
        logger.error(
          {
            event: 'sender.channel_not_found',
            job_id: job.id,
            channel_id: job.channelId,
            err: { message: err instanceof Error ? err.message : String(err) },
          },
          `job ${job.id}: nenhum canal WhatsApp ativo encontrado`,
        );
        return null;
      },
    );

    if (resolved === null) {
      const reason = 'Nenhum canal WhatsApp ativo configurado para esta organização';
      await database
        .update(followupJobs)
        .set({
          status: 'failed',
          attemptCount: newAttemptCount,
          lastError: reason,
          updatedAt: new Date(),
        })
        .where(eq(followupJobs.id, job.id));

      return {
        jobId: job.id,
        leadId: job.leadId,
        templateKey: ctx.template.name,
        outcome: 'failed',
        error: reason,
        attemptCount: newAttemptCount,
        terminal: true,
      };
    }

    logger.info(
      {
        event: 'sender.channel_resolved',
        job_id: job.id,
        channel_id: resolved.channelId,
        channel_name: resolved.channelName,
      },
      `job ${job.id}: canal resolvido — ${resolved.channelName}`,
    );

    resolvedClient = new MetaWhatsAppClient({
      accessToken: resolved.accessToken,
      phoneNumberId: resolved.phoneNumberId,
    });
  }

  // -------------------------------------------------------------------------
  // 9. Envio real via Meta WhatsApp Cloud API
  // -------------------------------------------------------------------------
  let wamid: string;
  try {
    const result = await resolvedClient.sendTemplate(sendParams);
    wamid = result.wamid;
  } catch (err: unknown) {
    const errorMsg =
      err instanceof ExternalServiceError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Erro desconhecido na Meta API';

    const isTerminal = newAttemptCount >= ctx.rule.maxAttempts;
    const nextScheduledAt = isTerminal
      ? null
      : new Date(Date.now() + calcJobBackoff(newAttemptCount));

    await database.transaction(async (tx) => {
      // Justificativa dos casts: Drizzle não exporta NodePgTransaction como tipo público.
      // DrizzleTx e AuditTx são interfaces estruturais compatíveis com a transação.
      const txForEmit = tx as unknown as DrizzleTx;
      const txForAudit = tx as unknown as AuditTx;

      await tx
        .update(followupJobs)
        .set({
          status: isTerminal ? 'failed' : 'scheduled',
          attemptCount: newAttemptCount,
          lastError: errorMsg.slice(0, 1000),
          ...(nextScheduledAt !== null ? { scheduledAt: nextScheduledAt } : {}),
          updatedAt: new Date(),
        })
        .where(eq(followupJobs.id, job.id));

      const failedData: FollowupFailedData = {
        followup_job_id: job.id,
        lead_id: job.leadId,
        rule_id: job.ruleId,
        last_error: errorMsg.slice(0, 500),
        attempt_count: newAttemptCount,
        terminal: isTerminal,
      };

      await emit(txForEmit, {
        eventName: 'followup.failed',
        aggregateType: 'followup_job',
        aggregateId: job.id,
        organizationId: job.organizationId,
        actor: { kind: 'worker', id: null, ip: null },
        idempotencyKey: `followup.failed:${job.id}:${String(newAttemptCount)}`,
        data: failedData,
      });

      await auditLog(txForAudit, {
        organizationId: job.organizationId,
        actor: null,
        action: 'followup.send_failed',
        resource: { type: 'followup_job', id: job.id },
        after: {
          job_id: job.id,
          lead_id: job.leadId,
          template_name: ctx.template.name,
          attempt_count: newAttemptCount,
          terminal: isTerminal,
          // Truncar error para evitar acúmulo de PII acidental de stack traces
          error_truncated: errorMsg.slice(0, 200),
        },
      });
    });

    // Sanitizar err: serializar apenas campos seguros para evitar que
    // err.details.response (body bruto da Meta) vaze PII em logs futuros.
    logger.error(
      {
        event: 'sender.job_failed',
        job_id: job.id,
        lead_id: job.leadId,
        template_name: ctx.template.name,
        attempt_count: newAttemptCount,
        terminal: isTerminal,
        err: {
          message: err instanceof Error ? err.message : String(err),
          code: err instanceof ExternalServiceError ? err.code : undefined,
          upstreamStatus: (err as { details?: { upstreamStatus?: number } } | null)?.details
            ?.upstreamStatus,
          meta_code: (err as { details?: { meta_error_code?: number } } | null)?.details
            ?.meta_error_code,
        },
      },
      `job ${job.id}: falha no envio (tentativa ${String(newAttemptCount)}/${String(ctx.rule.maxAttempts)})`,
    );

    return {
      jobId: job.id,
      leadId: job.leadId,
      templateKey: ctx.template.name,
      outcome: 'failed',
      error: errorMsg,
      attemptCount: newAttemptCount,
      terminal: isTerminal,
    };
  }

  // -------------------------------------------------------------------------
  // 10. Sucesso — atualizar job + outbox + auditLog em transação atômica
  // -------------------------------------------------------------------------
  await database.transaction(async (tx) => {
    // Justificativa dos casts: ver comentário acima na transação de falha.
    const txForEmit = tx as unknown as DrizzleTx;
    const txForAudit = tx as unknown as AuditTx;

    await tx
      .update(followupJobs)
      .set({
        status: 'sent',
        attemptCount: newAttemptCount,
        sentMessageId: wamid,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(followupJobs.id, job.id));

    const sentData: FollowupSentData = {
      followup_job_id: job.id,
      lead_id: job.leadId,
      rule_id: job.ruleId,
      template_key: ctx.template.name,
      wamid,
      attempt_count: newAttemptCount,
    };

    await emit(txForEmit, {
      eventName: 'followup.sent',
      aggregateType: 'followup_job',
      aggregateId: job.id,
      organizationId: job.organizationId,
      actor: { kind: 'worker', id: null, ip: null },
      // Idempotência: wamid é único por envio — chave determinística.
      idempotencyKey: `followup.sent:${job.id}:${wamid}`,
      data: sentData,
    });

    // Audit log obrigatório por envio (LGPD — janela 24h auditável).
    // `after` não inclui telefone — apenas wamid + template_key para correlação.
    await auditLog(txForAudit, {
      organizationId: job.organizationId,
      actor: null,
      action: 'followup.sent',
      resource: { type: 'followup_job', id: job.id },
      after: {
        job_id: job.id,
        lead_id: job.leadId,
        template_name: ctx.template.name,
        wamid,
        attempt_count: newAttemptCount,
      },
    });
  });

  logger.info(
    {
      event: 'sender.job_sent',
      job_id: job.id,
      lead_id: job.leadId,
      template_name: ctx.template.name,
      wamid,
      attempt_count: newAttemptCount,
    },
    `job ${job.id}: template ${ctx.template.name} enviado (wamid: ${wamid})`,
  );

  return {
    jobId: job.id,
    leadId: job.leadId,
    templateKey: ctx.template.name,
    outcome: 'sent',
    wamid,
    attemptCount: newAttemptCount,
    terminal: false,
  };
}

// ---------------------------------------------------------------------------
// Tick principal
// ---------------------------------------------------------------------------

/**
 * Executa um tick do sender:
 *   1. Verifica flag followup.enabled → sai cedo se disabled.
 *   2. Verifica flag followup.sender.enabled → define dryRun.
 *   3. Busca lote de jobs scheduled + scheduled_at <= now().
 *   4. Para cada job: chama processJob().
 *   5. Loga resultado estruturado por tick.
 *
 * @param database    Instância Drizzle (injetável para testes).
 * @param metaClient  Cliente Meta (injetável para testes). null em dry-run.
 * @param logger      Logger do worker.
 */
export async function runSenderTick(
  database: Database,
  metaClient: MetaWhatsAppClient | null,
  logger: SenderLogger,
): Promise<JobTickResult[]> {
  // -------------------------------------------------------------------------
  // Camada 1: followup.enabled — gate total.
  // -------------------------------------------------------------------------
  const { enabled: followupEnabled } = await isFlagEnabled(database, 'followup.enabled');
  if (!followupEnabled) {
    logger.debug(
      { event: 'sender.skipped', flag: 'followup.enabled' },
      'followup.enabled=disabled — tick ignorado',
    );
    return [];
  }

  // -------------------------------------------------------------------------
  // Camada 2: followup.sender.enabled — gate de envio real (dry-run).
  // -------------------------------------------------------------------------
  const { enabled: senderEnabled } = await isFlagEnabled(database, 'followup.sender.enabled');
  const dryRun = !senderEnabled;

  if (dryRun) {
    logger.info(
      { event: 'sender.dry_run_mode', flag: 'followup.sender.enabled' },
      'followup.sender.enabled=disabled — tick em dry-run (sem chamadas à Meta API)',
    );
  }

  // -------------------------------------------------------------------------
  // Buscar lote de jobs agendados prontos para envio
  // -------------------------------------------------------------------------
  const now = new Date();
  // multi-tenant batch; isolamento per-job via organizationId carregado no contexto
  const batch = await database
    .select()
    .from(followupJobs)
    .where(and(eq(followupJobs.status, 'scheduled'), lte(followupJobs.scheduledAt, now)))
    .limit(BATCH_SIZE);

  if (batch.length === 0) {
    logger.debug({ event: 'sender.no_jobs' }, 'nenhum job agendado para este tick');
    return [];
  }

  logger.info(
    { event: 'sender.batch_loaded', batch_size: batch.length, dry_run: dryRun },
    `lote de ${String(batch.length)} jobs carregado`,
  );

  // -------------------------------------------------------------------------
  // Processar cada job do lote
  // -------------------------------------------------------------------------
  const results: JobTickResult[] = [];

  for (const job of batch) {
    try {
      const result = await processJob(database, dryRun ? null : metaClient, job, dryRun, logger);
      results.push(result);
    } catch (err: unknown) {
      logger.error(
        {
          event: 'sender.job_unexpected_error',
          job_id: job.id,
          lead_id: job.leadId,
          err: {
            message: err instanceof Error ? err.message : String(err),
            code: err instanceof ExternalServiceError ? err.code : undefined,
            upstreamStatus: (err as { details?: { upstreamStatus?: number } } | null)?.details
              ?.upstreamStatus,
            meta_code: (err as { details?: { meta_error_code?: number } } | null)?.details
              ?.meta_error_code,
          },
        },
        `erro inesperado ao processar job ${job.id}`,
      );

      try {
        await database
          .update(followupJobs)
          .set({
            status: 'failed',
            attemptCount: job.attemptCount + 1,
            lastError: err instanceof Error ? err.message.slice(0, 1000) : 'Erro inesperado',
            updatedAt: new Date(),
          })
          .where(eq(followupJobs.id, job.id));
      } catch {
        // Ignorar falha no fallback
      }

      results.push({
        jobId: job.id,
        leadId: job.leadId,
        templateKey: 'unknown',
        outcome: 'failed',
        error: 'unexpected_error',
        attemptCount: job.attemptCount + 1,
        terminal: true,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Log de resumo do tick
  // -------------------------------------------------------------------------
  const sent = results.filter((r) => r.outcome === 'sent').length;
  const dryRunCount = results.filter((r) => r.outcome === 'dry_run').length;
  const skipped = results.filter((r) => r.outcome === 'skipped').length;
  const failed = results.filter((r) => r.outcome === 'failed').length;
  const consentBlocked = results.filter((r) => r.outcome === 'consent_blocked').length;

  logger.info(
    {
      event: 'sender.tick_complete',
      total: results.length,
      sent,
      dry_run: dryRunCount,
      skipped,
      failed,
      consent_blocked: consentBlocked,
      is_dry_run: dryRun,
    },
    `tick concluído: ${String(results.length)} jobs — ${String(sent)} enviados, ${String(failed)} falhas`,
  );

  return results;
}

// ---------------------------------------------------------------------------
// Main — loop periódico
// ---------------------------------------------------------------------------

const runtime = createWorkerRuntime(WORKER_NAME);

export { runtime as _workerRuntime };

async function main(): Promise<void> {
  const tickMs = env.FOLLOWUP_SENDER_TICK_MS ?? DEFAULT_TICK_MS;

  // F20-S03: credenciais não mais resolvidas de env vars — cada job resolve o canal
  // via resolveChannelForSend(db, orgId, job.channelId) dentro de processJob.
  // Passamos null para que o worker use o mecanismo de resolução por job.
  const metaClient: MetaWhatsAppClient | null = null;

  runtime.logger.info(
    { event: 'sender.started', tick_ms: tickMs },
    'followup-sender iniciado — canal resolvido da tabela channels por job',
  );

  while (!runtime.isShuttingDown()) {
    try {
      await runSenderTick(defaultDb, metaClient, runtime.logger);
    } catch (err: unknown) {
      runtime.logger.error(
        {
          err: {
            message: err instanceof Error ? err.message : String(err),
            code: err instanceof ExternalServiceError ? err.code : undefined,
            upstreamStatus: (err as { details?: { upstreamStatus?: number } } | null)?.details
              ?.upstreamStatus,
          },
        },
        'followup-sender: erro inesperado no tick',
      );
    }
    await sleep(tickMs);
  }
}

if (process.argv[1] !== undefined && process.argv[1].includes('followup-sender')) {
  main().catch((err: unknown) => {
    runtime.logger.fatal(
      { err: { message: err instanceof Error ? err.message : String(err) } },
      'followup-sender: falha fatal',
    );
    process.exit(1);
  });
}
