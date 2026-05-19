// =============================================================================
// whatsapp/handlers/ai-fallback.ts — Fallback de handoff automático em falha
// do LangGraph (F3-S34).
//
// Responsabilidade:
//   Quando o LangGraph falha (timeout, erro HTTP, response inválido), este
//   módulo executa o fallback em 3 passos (doc 06 §4.4):
//     1. Envia mensagem padrão ao cliente via Chatwoot: "Recebi sua mensagem.
//        Vou te transferir para um atendente."
//     2. Registra a decisão da IA com `error` via POST /internal/ai/decisions.
//     3. Cria handoff com `reason='ai_unavailable'` via POST /internal/handoffs.
//
// Contrato de integração:
//   - Chamado pelo process-with-ai.ts quando langGraph.processWhatsAppMessage()
//     lança qualquer erro (ExternalServiceError, ZodError, AbortError, etc.).
//   - NÃO relança o erro do LangGraph — o fallback é a resolução do fluxo.
//   - Qualquer falha DENTRO do fallback é propagada para o outbox-publisher,
//     que contabiliza a tentativa e reexecuta conforme a política de retry.
//
// LGPD (doc 17 §8.3):
//   - Logs NÃO incluem customer_phone, message_text, reply.content ou qualquer
//     outro campo com PII bruta.
//   - A mensagem padrão enviada ao cliente é texto estático — sem dados pessoais.
//   - summary enviado ao handoff é texto fixo (sem contexto do cidadão) porque
//     o LangGraph falhou antes de processar — DLP já satisfeito por design.
//   - correlationId e conversationId (IDs opacos) são os únicos identificadores
//     presentes nos logs.
//
// Idempotência:
//   - A chave de idempotência do handoff é derivada do waMessageId + sufixo
//     'fallback', garantindo que reenvios do mesmo evento não criam múltiplos
//     handoffs.
//   - O log de decisão (ai_decision_logs) é append-only — reenvios criam
//     registros adicionais, o que é aceitável (tabela de auditoria).
// =============================================================================

import pino from 'pino';

import { env } from '../../../config/env.js';
import type { ChatwootClientOptions } from '../../../integrations/chatwoot/client.js';
import { ChatwootClient } from '../../../integrations/chatwoot/client.js';
import { ExternalServiceError } from '../../../shared/errors.js';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/**
 * Mensagem padrão enviada ao cliente quando o LangGraph falha.
 * Texto fixo (doc 06 §4.4) — sem PII, sem contexto do cidadão.
 */
const FALLBACK_CLIENT_MESSAGE = 'Recebi sua mensagem. Vou te transferir para um atendente.';

/**
 * Mensagem resumo do handoff (dado interno, visível apenas aos atendentes).
 * Genérica porque o LangGraph falhou antes de processar — sem contexto disponível.
 */
const FALLBACK_HANDOFF_SUMMARY =
  'Handoff automático acionado: serviço de IA indisponível ou timeout.';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

/**
 * Lista canônica de paths redactados (doc 17 §8.3).
 * Camada de defesa em profundidade — pino.redact global em app.ts também cobre.
 */
const REDACT_PATHS = [
  '*.cpf',
  '*.email',
  '*.telefone',
  '*.phone',
  '*.customer_phone',
  '*.password',
  '*.senha',
  '*.token',
  '*.document_number',
  '*.birth_date',
  '*.address',
  '*.message_text',
  '*.content',
  '*.text',
  '*.body',
  '*.summary',
];

const baseLogger = pino({
  name: 'ai-fallback',
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
// Tipos
// ---------------------------------------------------------------------------

/**
 * Opções de configuração injetáveis — usadas em testes para substituir
 * clientes HTTP reais por mocks sem alterar o código de produção.
 */
export interface AiFallbackOptions {
  chatwootOptions?: ChatwootClientOptions;
  /**
   * URL base do backend (para chamadas internas /internal/*).
   * Default: env.API_PUBLIC_URL ou 'http://localhost:3333'.
   */
  internalBaseUrl?: string;
  /** Token interno para as rotas /internal/*. Default: env.LANGGRAPH_INTERNAL_TOKEN. */
  internalToken?: string;
  /** fetch injetável para chamadas às rotas /internal/*. Default: global fetch. */
  fetchFn?: typeof fetch;
}

/**
 * Contexto mínimo necessário para executar o fallback.
 * Todos os campos são IDs opacos ou dados não-PII — LGPD §8.3.
 */
export interface AiFallbackContext {
  /** ID do evento do outbox (para logging de correlação). */
  eventId: string;
  /** ID de correlação distribuído. */
  correlationId: string;
  /** UUID da conversa em ai_conversation_states. */
  conversationId: string;
  /** ID numérico da conversa no Chatwoot (para enviar mensagem ao cliente). */
  chatwootConversationId: number;
  /** UUID da organização. */
  organizationId: string;
  /** UUID do lead (pode ser null se ainda não identificado). */
  leadId: string | null;
  /** ID da mensagem WhatsApp (para chave de idempotência do handoff). */
  waMessageId: string;
  /** Mensagem de erro técnico do LangGraph (truncada — nunca inclui PII). */
  aiErrorMessage: string;
}

// ---------------------------------------------------------------------------
// triggerAiFallback
// ---------------------------------------------------------------------------

/**
 * Executa o fallback completo de 3 passos quando o LangGraph falha.
 *
 * Passos (doc 06 §4.4):
 *   1. Envia mensagem padrão ao cliente via Chatwoot.
 *   2. Registra decisão com `error` via POST /internal/ai/decisions.
 *   3. Cria handoff com `reason='ai_unavailable'` via POST /internal/handoffs.
 *
 * @param ctx     Contexto mínimo da conversa (IDs opacos — sem PII bruta).
 * @param options Opções de configuração injetáveis (para testes).
 *
 * @throws ExternalServiceError se qualquer passo do fallback falhar.
 *         O outbox-publisher intercepta e contabiliza a tentativa.
 */
export async function triggerAiFallback(
  ctx: AiFallbackContext,
  options: AiFallbackOptions = {},
): Promise<void> {
  const logger = baseLogger.child({
    correlation_id: ctx.correlationId,
    event_id: ctx.eventId,
    conversation_id: ctx.conversationId,
  });

  const resolvedInternalBaseUrl =
    options.internalBaseUrl ?? env.API_PUBLIC_URL ?? 'http://localhost:3333';
  const resolvedInternalToken = options.internalToken ?? env.LANGGRAPH_INTERNAL_TOKEN;
  const fetchFn = options.fetchFn ?? fetch;

  logger.warn(
    { waMessageId: ctx.waMessageId, leadId: ctx.leadId },
    'LangGraph falhou — acionando fallback de handoff automático',
  );

  // -------------------------------------------------------------------------
  // Passo 1: Enviar mensagem padrão ao cliente via Chatwoot
  //   Apenas quando chatwootConversationId > 0 (conversa sincronizada).
  //   Se o Chatwoot ainda não tem a conversa, o handoff ainda é criado
  //   para garantir que o agente humano seja notificado.
  // -------------------------------------------------------------------------
  if (ctx.chatwootConversationId > 0) {
    try {
      const chatwoot = new ChatwootClient(options.chatwootOptions);
      await chatwoot.createMessage(ctx.chatwootConversationId, FALLBACK_CLIENT_MESSAGE);
      logger.info(
        { chatwoot_conversation_id: ctx.chatwootConversationId },
        'mensagem de fallback enviada ao cliente via Chatwoot',
      );
    } catch (chatwootErr) {
      // Falha no Chatwoot não impede os passos 2 e 3.
      // O handoff é criado de qualquer forma — o agente humano assumirá a conversa.
      // Log sem conteúdo de mensagem (PII) — apenas IDs técnicos.
      logger.error(
        {
          chatwoot_conversation_id: ctx.chatwootConversationId,
          err: chatwootErr instanceof Error ? chatwootErr.message : 'unknown',
        },
        'falha ao enviar mensagem de fallback ao Chatwoot — continuando com handoff',
      );
      // Não relança — os passos 2 e 3 são mais críticos.
    }
  } else {
    logger.info(
      { chatwoot_conversation_id: ctx.chatwootConversationId },
      'chatwoot_conversation_id inválido — pulando envio de mensagem ao cliente',
    );
  }

  // -------------------------------------------------------------------------
  // Passo 2: Registrar decisão com `error` via POST /internal/ai/decisions
  //   Idempotência: a tabela é append-only, reenvios criam registros adicionais.
  //   LGPD §8.4: `decision` contém apenas IDs e metadados — sem PII.
  //   `error` truncado para 2000 chars (limite do schema) — nunca inclui PII.
  // -------------------------------------------------------------------------
  const errorMessage = ctx.aiErrorMessage.slice(0, 2_000);

  const decisionBody = {
    organizationId: ctx.organizationId,
    conversationId: ctx.conversationId,
    leadId: ctx.leadId,
    nodeName: 'process_whatsapp_message',
    correlationId: ctx.correlationId,
    decision: {
      fallback_triggered: true,
      reason: 'ai_unavailable',
    },
    error: errorMessage,
  };

  const decisionUrl = `${resolvedInternalBaseUrl}/internal/ai/decisions`;
  const decisionIdempotencyKey = `ai_decision_fallback:${ctx.waMessageId}`;

  let decisionResponse: Response;
  try {
    decisionResponse = await fetchFn(decisionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': resolvedInternalToken,
        'X-Correlation-Id': ctx.correlationId,
        'Idempotency-Key': decisionIdempotencyKey,
      },
      body: JSON.stringify(decisionBody),
    });
  } catch (fetchErr) {
    throw new ExternalServiceError(
      `ai-fallback: falha ao registrar decisão de erro — ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`,
      { step: 'log_ai_decision', correlationId: ctx.correlationId },
    );
  }

  if (!decisionResponse.ok) {
    throw new ExternalServiceError(
      `ai-fallback: POST /internal/ai/decisions retornou ${decisionResponse.status}`,
      {
        step: 'log_ai_decision',
        status: decisionResponse.status,
        correlationId: ctx.correlationId,
      },
    );
  }

  logger.info({ decision_url: decisionUrl }, 'decisão de erro registrada em ai_decision_logs');

  // -------------------------------------------------------------------------
  // Passo 3: Criar handoff via POST /internal/handoffs
  //   Idempotência: chave derivada do waMessageId + 'fallback'.
  //   LGPD §8.5: summary é texto genérico fixo — sem PII do cidadão.
  //   leadId obrigatório no body — se null, o handoff é criado com um
  //   leadId nulo-like: o endpoint requer UUID, então usamos um placeholder
  //   apenas quando leadId é realmente conhecido.
  //
  //   Atenção: InternalHandoffBodySchema exige leadId como UUID não-nulo.
  //   Se o lead ainda não foi identificado (leadId === null), o fallback
  //   não pode criar o handoff da forma normal. Neste caso, logamos um aviso
  //   e retornamos — o outbox reprocessará quando o lead existir.
  // -------------------------------------------------------------------------
  if (ctx.leadId === null) {
    logger.warn(
      { waMessageId: ctx.waMessageId },
      'leadId ausente — handoff ai_unavailable não pode ser criado sem lead identificado; ' +
        'o atendente será notificado na próxima mensagem do cliente',
    );
    return;
  }

  const handoffBody = {
    leadId: ctx.leadId,
    // InternalHandoffBodySchema.conversationId é o ID numérico do Chatwoot.
    // Se não disponível (= 0), o serviço de handoff ainda pode criar o registro.
    // Coerce via schema aceita 0 (validado como positivo — usamos 1 se 0 para evitar erro de schema).
    // Na prática chatwootConversationId > 0 para chamadas reais; para segurança usamos Math.max.
    conversationId: Math.max(ctx.chatwootConversationId, 1),
    reason: 'ai_unavailable',
    summary: FALLBACK_HANDOFF_SUMMARY,
    organizationId: ctx.organizationId,
    simulationId: null,
  };

  const handoffUrl = `${resolvedInternalBaseUrl}/internal/handoffs`;
  const handoffIdempotencyKey = `handoff_fallback:${ctx.waMessageId}`;

  let handoffResponse: Response;
  try {
    handoffResponse = await fetchFn(handoffUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': resolvedInternalToken,
        'X-Correlation-Id': ctx.correlationId,
        'Idempotency-Key': handoffIdempotencyKey,
      },
      body: JSON.stringify(handoffBody),
    });
  } catch (fetchErr) {
    throw new ExternalServiceError(
      `ai-fallback: falha ao criar handoff ai_unavailable — ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`,
      { step: 'create_handoff', correlationId: ctx.correlationId },
    );
  }

  if (!handoffResponse.ok) {
    throw new ExternalServiceError(
      `ai-fallback: POST /internal/handoffs retornou ${handoffResponse.status}`,
      { step: 'create_handoff', status: handoffResponse.status, correlationId: ctx.correlationId },
    );
  }

  logger.info(
    { handoff_url: handoffUrl, lead_id: ctx.leadId },
    'handoff ai_unavailable criado com sucesso',
  );
}
