// =============================================================================
// ai-console/playground/service.ts — Regras de negócio do módulo playground (F9-S04).
//
// Responsabilidades:
//   1. Aplica DLP (redactPii) na mensagem digitada pelo operador antes do LangGraph.
//   2. Carrega contexto real de lead/city (se use_real_context=true).
//   3. Chama o LangGraphPlaygroundClient (dry-run, sem persistência, sem Chatwoot).
//   4. Aplica masking defensivo no trace retornado pelo LangGraph.
//   5. Emite audit + outbox na mesma transação.
//
// LGPD (doc 17 §8.4):
//   - Mensagem do operador: redactPii() ANTES de qualquer repasse ao LangGraph.
//   - Logs: SEM mensagem do operador, mesmo mascarada. Apenas trace_id + counts.
//   - Audit: SEM mensagem no metadata — apenas actor_id + trace_id + tokens.
//   - Outbox payload: SEM PII bruta (apenas IDs e métricas).
//   - dlp_tokens retornados à UI: apenas os placeholders gerados (<CPF_1> etc.),
//     nunca os valores originais.
//
// Sem escopo de cidade no service:
//   - O playground é admin-only. Admin tem acesso global.
//   - O middleware authorize({ permissions: ['ai_playground:run'] }) é a barreira.
//
// Idempotência:
//   - Header Idempotency-Key opcional passado pelo controller.
//   - Se presente, usado como idempotency_key no outbox.
//   - Se ausente, gerado como `ai_playground.run_executed:<trace_id>`.
// =============================================================================
import { randomUUID } from 'node:crypto';

import type { Database } from '../../../db/client.js';
import type { auditLogs } from '../../../db/schema/auditLogs.js';
import { eventOutbox } from '../../../db/schema/events.js';
import type { LangGraphPlaygroundClient } from '../../../integrations/langgraph/playground-client.js';
import { auditLog } from '../../../lib/audit.js';
import type { AuditTx } from '../../../lib/audit.js';
import { maskPiiInValue, redactPii } from '../../../lib/dlp.js';
import { NotFoundError } from '../../../shared/errors.js';

import { loadCityContext, loadLeadContext } from './repository.js';
import type { CityContext, LeadContext } from './repository.js';
import type { PlaygroundBody, PlaygroundResponse } from './schemas.js';

// ---------------------------------------------------------------------------
// Interface de transação mínima para o service
// Justificativa: Drizzle não exporta tipo público da transação.
// Esta interface cobre exatamente os métodos usados aqui (auditLogs + eventOutbox).
//
// Não estende AuditTx porque o TypeScript em strict mode não permite extends com
// sobrecarga conflitante de `insert` (tabelas diferentes). Declaramos os dois
// overloads diretamente aqui.
// ---------------------------------------------------------------------------

interface PlaygroundServiceTx {
  insert(table: typeof auditLogs): {
    values(row: typeof auditLogs.$inferInsert): Promise<unknown>;
  };
  insert(table: typeof eventOutbox): {
    values(row: typeof eventOutbox.$inferInsert): Promise<unknown>;
  };
}

// ---------------------------------------------------------------------------
// Payload do evento de outbox (sem PII bruta — LGPD §8.5)
// events/types.ts não está em files_allowed: definimos tipo local.
// ---------------------------------------------------------------------------

interface AiPlaygroundRunPayload {
  event_id: string;
  event_name: 'ai_playground.run_executed';
  event_version: 1;
  occurred_at: string;
  actor: { kind: string; id: string; ip: string | null };
  correlation_id: string | null;
  aggregate: { type: 'ai_playground_run'; id: string };
  data: {
    trace_id: string;
    tokens_total: number;
    graph_version: string;
    latency_ms: number;
    handoff_required: boolean;
    dlp_applied: boolean;
    has_real_context: boolean;
  };
}

// ---------------------------------------------------------------------------
// Contexto do usuário para o service
// ---------------------------------------------------------------------------

export interface PlaygroundUserCtx {
  userId: string;
  organizationId: string;
  /**
   * Role snapshot para audit log.
   * O playground é admin-only — o caller pode passar 'admin' como default.
   * Não está em request.user; o caller usa literal ou inferência da permissão.
   */
  role: string;
  ip?: string | null;
  userAgent?: string | null;
}

// ---------------------------------------------------------------------------
// Service principal
// ---------------------------------------------------------------------------

/**
 * Executa uma simulação dry-run do playground.
 *
 * Fluxo:
 *   1. DLP: redactPii() na mensagem do operador.
 *   2. Contexto: loadLeadContext/loadCityContext se use_real_context=true.
 *   3. LangGraph: chama playground-client com mensagem redactada.
 *   4. Masking defensivo: maskPiiInValue() no trace retornado.
 *   5. Transação: auditLog + emit(outbox) atomicamente.
 *
 * @param db           Database instance.
 * @param client       LangGraphPlaygroundClient injetável.
 * @param userCtx      Contexto do usuário autenticado.
 * @param body         Body validado pelo Zod (mensagem + opções).
 * @param idempotencyKey Chave de idempotência opcional do header.
 * @returns PlaygroundResponse com trace mascarado + metadados DLP.
 */
export async function runPlaygroundSvc(
  db: Database,
  client: LangGraphPlaygroundClient,
  userCtx: PlaygroundUserCtx,
  body: PlaygroundBody,
  idempotencyKey?: string,
): Promise<PlaygroundResponse> {
  const traceId = randomUUID();
  const correlationId = traceId; // correlação = trace_id para rastreabilidade distribuída

  // -------------------------------------------------------------------------
  // 1. DLP — redactPii na mensagem do operador
  //    LGPD §8.4: nenhum dado pessoal bruto deve sair para o LangGraph.
  //    Logs não incluem a mensagem original nem a redactada.
  // -------------------------------------------------------------------------
  const { redactedText, dlpTokens, dlpApplied, counts: dlpCounts } = redactPii(body.message);

  // -------------------------------------------------------------------------
  // 2. Contexto real de lead/city (somente leitura)
  //    Apenas se use_real_context=true E lead_id/city_id presentes.
  // -------------------------------------------------------------------------
  let leadCtx: LeadContext | null = null;
  let cityCtx: CityContext | null = null;

  if (body.use_real_context) {
    if (body.lead_id !== null && body.lead_id !== undefined) {
      leadCtx = await loadLeadContext(db, userCtx.organizationId, body.lead_id);
      if (!leadCtx) {
        throw new NotFoundError('Lead não encontrado');
      }
      // Se o lead tem cidade e não foi passado city_id explicitamente, usar a do lead
      if (leadCtx.cityId !== null && (body.city_id === null || body.city_id === undefined)) {
        cityCtx = await loadCityContext(db, userCtx.organizationId, leadCtx.cityId);
      }
    }
    if (body.city_id !== null && body.city_id !== undefined) {
      cityCtx = await loadCityContext(db, userCtx.organizationId, body.city_id);
      if (!cityCtx) {
        throw new NotFoundError(`Cidade '${body.city_id}' não encontrada`);
      }
    }
  }

  // -------------------------------------------------------------------------
  // 3. Montar payload para o LangGraph
  //    - message_text: já redactada por DLP
  //    - customer_phone: sintético (operador não fornece telefone real)
  //    - conversation_id: sintético (dry-run não reusa conversas reais)
  //    - Metadados reais de lead/city quando use_real_context=true
  // -------------------------------------------------------------------------
  const syntheticPhone = '+5569999990000'; // Placeholder sintético para dry-run
  const syntheticConversationId = randomUUID();
  const syntheticChatwootId = `playground-${traceId}`;

  const playgroundRequest = {
    dry_run: true as const,
    conversation_id: syntheticConversationId,
    lead_id: leadCtx?.leadId ?? body.lead_id ?? null,
    customer_phone: syntheticPhone,
    message_text: redactedText, // LGPD: já redactada
    message_attachments: [] as Record<string, unknown>[],
    message_timestamp: new Date().toISOString(),
    channel: 'whatsapp' as const,
    chatwoot_conversation_id: syntheticChatwootId,
    chatwoot_account_id: 'playground-account',
    allow_real_reads: body.use_real_context,
    metadata: {
      city_id: cityCtx?.cityId ?? null,
      city_name: cityCtx?.cityName ?? null,
      customer_name: null,
      previous_state_loaded: leadCtx !== null,
    },
    correlation_id: correlationId,
    idempotency_key: idempotencyKey ?? `playground-${traceId}`,
  };

  // -------------------------------------------------------------------------
  // 4. Chamar LangGraph dry-run
  //    Timeout: 12s (maior que produção — operador espera).
  //    Lança ExternalServiceError em timeout/falha de rede.
  // -------------------------------------------------------------------------
  const lgResponse = await client.runPlayground(playgroundRequest, correlationId);

  // -------------------------------------------------------------------------
  // 5. Masking defensivo no trace retornado
  //    LGPD §8.4: defesa em profundidade — o LangGraph promete não incluir PII,
  //    mas mascaramos como segunda linha de defesa.
  //    Logs: apenas trace_id e entrada count — nunca o trace completo.
  // -------------------------------------------------------------------------
  const maskedTrace = maskPiiInValue(lgResponse.trace) as typeof lgResponse.trace;
  const maskedErrors = maskPiiInValue(lgResponse.errors) as typeof lgResponse.errors;
  const maskedReplyContent =
    typeof lgResponse.reply_content === 'string'
      ? (maskPiiInValue(lgResponse.reply_content) as string)
      : lgResponse.reply_content;

  // -------------------------------------------------------------------------
  // 6. Audit + Outbox na mesma transação
  //    Audit: actor_id + action + trace_id — SEM mensagem do operador.
  //    Outbox: apenas IDs e métricas — sem PII (LGPD §8.5).
  // -------------------------------------------------------------------------
  const effectiveIdempotencyKey = idempotencyKey ?? `ai_playground.run_executed:${traceId}`;

  await db.transaction(async (tx) => {
    // Audit — LGPD: NÃO registrar a mensagem do operador, mesmo mascarada.
    // Justificativa do cast: tx é a transação Drizzle, estruturalmente compatível com AuditTx.
    // O mesmo padrão é usado em prompts/service.ts e cidades/service.ts.
    await auditLog(tx as unknown as AuditTx, {
      organizationId: userCtx.organizationId,
      actor: {
        userId: userCtx.userId,
        role: userCtx.role,
        ip: userCtx.ip ?? null,
        userAgent: userCtx.userAgent ?? null,
      },
      action: 'ai_playground.run_executed',
      resource: { type: 'ai_playground_run', id: traceId },
      // before/after: não aplicável — nenhuma mutação de domínio.
      // metadata: apenas IDs e métricas, sem PII.
      after: {
        trace_id: traceId,
        tokens_total: lgResponse.tokens_total,
        graph_version: lgResponse.graph_version,
        latency_ms: lgResponse.latency_ms,
        prompt_versions_used: lgResponse.prompt_versions_used,
        handoff_required: lgResponse.handoff_required,
        dlp_applied: dlpApplied,
        dlp_counts: dlpCounts,
        has_real_context: body.use_real_context,
      },
      correlationId,
    });

    // Outbox — sem PII bruta (LGPD §8.5)
    const eventId = randomUUID();
    const occurredAt = new Date().toISOString();

    const payload: AiPlaygroundRunPayload = {
      event_id: eventId,
      event_name: 'ai_playground.run_executed',
      event_version: 1,
      occurred_at: occurredAt,
      actor: { kind: 'user', id: userCtx.userId, ip: userCtx.ip ?? null },
      correlation_id: correlationId,
      aggregate: { type: 'ai_playground_run', id: traceId },
      data: {
        trace_id: traceId,
        tokens_total: lgResponse.tokens_total,
        graph_version: lgResponse.graph_version,
        latency_ms: lgResponse.latency_ms,
        handoff_required: lgResponse.handoff_required,
        dlp_applied: dlpApplied,
        has_real_context: body.use_real_context,
      },
    };

    await (tx as unknown as PlaygroundServiceTx).insert(eventOutbox).values({
      id: eventId,
      organizationId: userCtx.organizationId,
      eventName: 'ai_playground.run_executed',
      eventVersion: 1,
      aggregateType: 'ai_playground_run',
      aggregateId: traceId,
      payload,
      correlationId,
      idempotencyKey: effectiveIdempotencyKey,
      attempts: 0,
      lastError: null,
      processedAt: null,
      failedAt: null,
    });
  });

  // -------------------------------------------------------------------------
  // 7. Montar resposta
  // -------------------------------------------------------------------------
  return {
    trace_id: traceId,
    dry_run: true,
    reply_type: lgResponse.reply_type,
    reply_content: maskedReplyContent,
    handoff_required: lgResponse.handoff_required,
    handoff_reason: lgResponse.handoff_reason,
    trace: maskedTrace,
    prompt_versions_used: lgResponse.prompt_versions_used,
    tokens_total: lgResponse.tokens_total,
    graph_version: lgResponse.graph_version,
    latency_ms: lgResponse.latency_ms,
    errors: maskedErrors,
    dlp_applied: dlpApplied,
    dlp_tokens: dlpTokens,
  };
}
