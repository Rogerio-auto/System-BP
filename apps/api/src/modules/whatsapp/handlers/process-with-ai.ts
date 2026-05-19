// =============================================================================
// whatsapp/handlers/process-with-ai.ts — Handler do evento whatsapp.message_received.
//
// Responsabilidade:
//   Consumir whatsapp.message_received (via outbox-publisher) e orquestrar o
//   fluxo de IA: chama o LangGraph e envia a reply ao cliente via Chatwoot.
//
// Fluxo (doc 06 §4.1, §4.2, §4.4):
//   1. Extrair whatsapp_message_id e lead_id do payload do evento.
//   2. Carregar o payload bruto da mensagem de whatsapp_messages (contém PII).
//   3. Garantir/criar conversation_id em ai_conversation_states.
//   4. Montar o request LangGraph com correlation_id + idempotency_key.
//   5. Chamar LangGraph via LangGraphClient (timeout 8s).
//   6. Validar response (Zod — já feito no client).
//   7. Se reply.type != 'none' e chatwoot_conversation_id disponível:
//      enviar resposta ao cliente via ChatwootClient.createMessage().
//   8. Atualizar ai_conversation_states com lead_id e last_message_at.
//
// Caminho de falha (F3-S34):
//   Se o LangGraph falhar em qualquer etapa (timeout, erro HTTP, response
//   inválido), triggerAiFallback() é chamado — sem re-throw do erro original.
//   triggerAiFallback() executa em 3 passos (doc 06 §4.4):
//     a. Envia mensagem padrão ao cliente via Chatwoot.
//     b. Registra decisão com `error` via POST /internal/ai/decisions.
//     c. Cria handoff com reason='ai_unavailable' via POST /internal/handoffs.
//   Se o próprio fallback falhar, o erro é propagado para o outbox-publisher
//   que contabiliza a tentativa e reexecuta conforme a política de retry.
//
// Idempotência:
//   O outbox-publisher garante dedupe via event_processing_logs (event_id, handler_name).
//   O LangGraph recebe idempotency_key = "wa_msg_<wa_message_id>"; caso ele também
//   duplique, o estado persistido no Postgres garante consistência.
//
// LGPD §8.3 / §8.4:
//   - Logs NÃO incluem customer_phone, message_text ou reply.content.
//   - pino.redact cobre os paths globalmente em app.ts; este módulo usa
//     campos de log seguros (correlation_id, conversation_id, waMessageId).
//   - DLP é responsabilidade do grafo LangGraph antes de qualquer chamada LLM.
//   - outbox NOT emitido com PII bruta — apenas IDs (§8.5).
// =============================================================================
import { and, eq, isNull } from 'drizzle-orm';
import pino from 'pino';
import { ZodError } from 'zod';

import { env } from '../../../config/env.js';
import { db } from '../../../db/client.js';
import type { Database } from '../../../db/client.js';
import type { EventOutbox } from '../../../db/schema/events.js';
import { aiConversationStates, whatsappMessages } from '../../../db/schema/index.js';
import type { AiConversationState } from '../../../db/schema/index.js';
import type { WhatsappMessageReceivedData } from '../../../events/types.js';
import { ChatwootClient } from '../../../integrations/chatwoot/client.js';
import type { ChatwootClientOptions } from '../../../integrations/chatwoot/client.js';
import { LangGraphClient } from '../../../integrations/langgraph/client.js';
import type { LangGraphClientOptions } from '../../../integrations/langgraph/client.js';
import type { LangGraphWhatsAppRequest } from '../../../integrations/langgraph/schemas.js';
import { normalizePhone } from '../../../shared/phone.js';

import { triggerAiFallback } from './ai-fallback.js';
import type { AiFallbackOptions } from './ai-fallback.js';

// ---------------------------------------------------------------------------
// Logger auto-suficiente
// ---------------------------------------------------------------------------

/**
 * Lista canônica de paths redactados (doc 17 §8.3).
 * LGPD: customer_phone, message_text e reply.content são PII bruta.
 * Adicionados aqui como camada de defesa em profundidade — pino.redact
 * global em app.ts também cobre estes campos.
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
  name: 'process-with-ai',
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
// Tipos internos
// ---------------------------------------------------------------------------

/**
 * Subconjunto tipado do payload bruto do webhook Meta que o handler precisa.
 * O payload completo é jsonb opaco em whatsapp_messages.payload.
 *
 * Justificativa do cast em uso: payload é `unknown` por design (LGPD §8.5).
 * Extraímos apenas os campos estritamente necessários para montar o request
 * LangGraph, sem copiar dados sensíveis para outras estruturas.
 */
interface WaMessagePayload {
  entry?: Array<{
    changes?: Array<{
      value?: {
        metadata?: {
          phone_number_id?: string;
        };
        messages?: Array<{
          id?: string;
          from?: string;
          timestamp?: string;
          type?: string;
          text?: { body?: string };
        }>;
      };
    }>;
  }>;
}

// ---------------------------------------------------------------------------
// Configuração injetável (facilita mocking em testes)
// ---------------------------------------------------------------------------

export interface ProcessWithAiOptions {
  langGraphOptions?: LangGraphClientOptions;
  chatwootOptions?: ChatwootClientOptions;
  /** Opções injetáveis para o fallback de handoff (F3-S34). Útil em testes. */
  fallbackOptions?: AiFallbackOptions;
}

// ---------------------------------------------------------------------------
// Queries locais
// ---------------------------------------------------------------------------

/**
 * Carrega ou cria o ai_conversation_states para o número de telefone.
 *
 * Usa INSERT ... ON CONFLICT DO NOTHING para idempotência — chamadas
 * paralelas com o mesmo phone resultam em apenas 1 registro.
 *
 * @param database  Instância Drizzle injetável.
 * @param phone     Número de telefone normalizado (apenas dígitos).
 * @param organizationId UUID da organização.
 * @returns         AiConversationState carregado ou recém-criado.
 */
async function getOrCreateConversationState(
  database: Database,
  phone: string,
  organizationId: string,
): Promise<AiConversationState> {
  // Tenta carregar estado existente para este telefone na org.
  // CRÍTICO: filtra por (organizationId, phone) para evitar cross-tenant leak (regra #3, #8).
  // CRÍTICO: filtra deleted_at IS NULL para não reativar conversas soft-deletadas.
  const [existing] = await database
    .select()
    .from(aiConversationStates)
    .where(
      and(
        eq(aiConversationStates.organizationId, organizationId),
        eq(aiConversationStates.phone, phone),
        isNull(aiConversationStates.deletedAt),
      ),
    )
    .limit(1);

  if (existing !== undefined) {
    return existing;
  }

  // Nenhum estado encontrado — criar novo.
  // O conversation_id é gerado pelo Postgres (gen_random_uuid()).
  const [created] = await database
    .insert(aiConversationStates)
    .values({
      organizationId,
      conversationId: crypto.randomUUID(),
      phone,
      state: {},
    })
    .onConflictDoNothing()
    .returning();

  if (created !== undefined) {
    return created;
  }

  // ON CONFLICT DO NOTHING — outra instância inseriu durante a corrida.
  // Recarregar o estado criado pelo concorrente.
  // CRÍTICO: filtra por (organizationId, phone) para evitar cross-tenant leak (regra #3, #8).
  // CRÍTICO: filtra deleted_at IS NULL para não reativar conversas soft-deletadas.
  const [reloaded] = await database
    .select()
    .from(aiConversationStates)
    .where(
      and(
        eq(aiConversationStates.organizationId, organizationId),
        eq(aiConversationStates.phone, phone),
        isNull(aiConversationStates.deletedAt),
      ),
    )
    .limit(1);

  if (reloaded === undefined) {
    // Impossível em condições normais — lançar para acionar retry do outbox.
    // LGPD §8.3: não incluir phone (PII) na mensagem de erro — usar eventId/organizationId.
    throw new Error(
      `ai_conversation_states: estado não encontrado após INSERT para organizationId=${organizationId} — inconsistência`,
    );
  }

  return reloaded;
}

// ---------------------------------------------------------------------------
// Handler principal
// ---------------------------------------------------------------------------

/**
 * Processa um evento whatsapp.message_received:
 *   1. Carrega payload bruto da mensagem.
 *   2. Obtém/cria conversation_id em ai_conversation_states.
 *   3. Chama LangGraph.
 *   4. Envia reply via Chatwoot (se disponível).
 *   5. Atualiza ai_conversation_states com lead_id e last_message_at.
 *
 * Idempotente: múltiplas execuções do mesmo evento resultam na mesma resposta
 * ao cliente (LangGraph recebe o mesmo idempotency_key e retorna estado consistente).
 *
 * Erros propagados → outbox-publisher registra falha e recontabiliza tentativas.
 * Tratamento de timeout/error com handoff automático: F3-S34.
 *
 * @param database  Instância Drizzle injetável (facilita mocking em testes).
 * @param options   Opções de configuração injetáveis para clientes HTTP.
 * @param event     EventOutbox com eventName = 'whatsapp.message_received'.
 */
export async function handleProcessWithAi(
  database: Database,
  options: ProcessWithAiOptions,
  event: EventOutbox,
): Promise<void> {
  const logger = baseLogger.child({ correlation_id: event.correlationId ?? event.id });

  // -------------------------------------------------------------------------
  // 1. Extrair payload tipado do evento
  // -------------------------------------------------------------------------
  // Justificativa do cast: event.payload é unknown por design do outbox (§8.5).
  // WhatsappMessageReceivedData contém apenas IDs opacos (sem PII).
  const eventPayload = event.payload as Partial<WhatsappMessageReceivedData>;

  const waMessageId = eventPayload.whatsapp_message_id;
  const organizationId = event.organizationId;

  if (!waMessageId) {
    logger.warn(
      { eventId: event.id, hasWaMessageId: Boolean(waMessageId) },
      'payload inválido — whatsapp_message_id ausente; skip',
    );
    return;
  }

  // -------------------------------------------------------------------------
  // 2. Carregar payload bruto da mensagem em whatsapp_messages
  //    O payload completo (com PII) está em whatsapp_messages.payload.
  //    Não logar nenhum campo do payload — LGPD §8.3.
  //    CRÍTICO: filtra por (waMessageId, organizationId) para evitar cross-tenant leak (regra #3, #8).
  // -------------------------------------------------------------------------
  const [waMessageRow] = await database
    .select()
    .from(whatsappMessages)
    .where(
      and(
        eq(whatsappMessages.waMessageId, waMessageId),
        eq(whatsappMessages.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (waMessageRow === undefined) {
    logger.warn(
      { eventId: event.id, waMessageId },
      'whatsapp_messages: registro não encontrado; skip',
    );
    return;
  }

  // -------------------------------------------------------------------------
  // 3. Extrair campos do payload bruto
  //    Apenas os campos estritamente necessários para o request LangGraph.
  //    Justificativa do cast: payload é jsonb opaco (Record<string, unknown>)
  //    mas segue a estrutura do webhook Meta validada no webhook handler.
  // -------------------------------------------------------------------------
  const rawPayload = waMessageRow.payload as unknown as WaMessagePayload;

  const firstEntry = rawPayload.entry?.[0];
  const firstChange = firstEntry?.changes?.[0];
  const waMsg = firstChange?.value?.messages?.[0];

  if (!waMsg) {
    logger.warn(
      { eventId: event.id, waMessageId },
      'payload: mensagem não encontrada no entry; skip',
    );
    return;
  }

  // `from` é o número do remetente entregue pela Meta (PII — apenas usado internamente, não logado).
  // ATENÇÃO: a Meta entrega `from` SEM o prefixo `+` (ex: '5569988887777').
  // O schema LangGraph exige E.164 com `+` — normalizar antes de montar o request.
  const customerPhoneRaw = waMsg.from;
  const messageText = waMsg.text?.body ?? '';
  const messageTimestamp = waMsg.timestamp;

  if (!customerPhoneRaw) {
    logger.warn({ eventId: event.id }, 'from ausente no payload; skip');
    return;
  }

  // Normalizar para E.164 usando o utilitário canônico (libphonenumber-js).
  // normalizePhone() lida com entradas com e sem `+`, validando o número contra BR por padrão.
  // `phoneNormalized` (apenas dígitos) é usado como chave em ai_conversation_states;
  // `customerPhoneE164` (com `+`) é o contrato do LangGraph (LangGraphWhatsAppRequestSchema).
  const phoneResult = normalizePhone(customerPhoneRaw);

  // Se o número for inválido para libphonenumber-js, tentamos prefixar `+` como fallback
  // (garante que números válidos mas não reconhecidos pela lib não bloqueiem o fluxo).
  // O schema Zod ainda valida a regex E.164 antes de enviar ao LangGraph.
  const customerPhoneE164 =
    phoneResult.isValid && phoneResult.e164 !== null
      ? phoneResult.e164
      : customerPhoneRaw.startsWith('+')
        ? customerPhoneRaw
        : `+${customerPhoneRaw}`;

  // `phoneNormalized` — apenas dígitos — chave usada em ai_conversation_states.
  const phoneNormalized = customerPhoneE164.replace(/\D/g, '');

  // -------------------------------------------------------------------------
  // 4. Carregar/criar conversation_id em ai_conversation_states
  // -------------------------------------------------------------------------
  const convState = await getOrCreateConversationState(database, phoneNormalized, organizationId);
  const conversationId = convState.conversationId;

  // chatwoot_conversation_id necessário para enviar reply via Chatwoot
  const chatwootConversationId = convState.chatwootConversationId ?? '0';
  const leadId = eventPayload.lead_id ?? convState.leadId ?? null;

  logger.info({ eventId: event.id, conversationId, waMessageId }, 'iniciando processamento com IA');

  // -------------------------------------------------------------------------
  // 5. Montar request LangGraph (doc 06 §4.1)
  // -------------------------------------------------------------------------
  const correlationId = event.correlationId ?? event.id;
  const idempotencyKey = `wa_msg_${waMessageId}`;

  // Parsear timestamp do webhook (Unix epoch string → ISO 8601)
  let messageTimestampIso: string;
  if (messageTimestamp !== undefined) {
    const tsEpoch = parseInt(messageTimestamp, 10);
    messageTimestampIso = Number.isFinite(tsEpoch)
      ? new Date(tsEpoch * 1000).toISOString()
      : new Date().toISOString();
  } else {
    messageTimestampIso = new Date().toISOString();
  }

  const langGraphRequest: LangGraphWhatsAppRequest = {
    conversation_id: conversationId,
    lead_id: leadId,
    // PII: customer_phone é necessário pelo contrato — não é logado pelo handler.
    // Sempre no formato E.164 (normalizado acima via normalizePhone).
    customer_phone: customerPhoneE164,
    message_text: messageText,
    message_attachments: [],
    message_timestamp: messageTimestampIso,
    channel: 'whatsapp',
    chatwoot_conversation_id: chatwootConversationId,
    chatwoot_account_id: String(env.CHATWOOT_ACCOUNT_ID ?? '1'),
    metadata: {
      city_id: null,
      city_name: null,
      customer_name: null,
      previous_state_loaded:
        convState.state !== null && Object.keys(convState.state as object).length > 0,
    },
    correlation_id: correlationId,
    idempotency_key: idempotencyKey,
  };

  // -------------------------------------------------------------------------
  // 6. Chamar LangGraph (timeout 8s — doc 06 §4.4)
  //    Sem retry no cliente — o outbox-publisher orquestra retries em falha.
  //
  //    Caminho de FALHA (F3-S34):
  //    Qualquer erro (timeout = ExternalServiceError com AbortError interno,
  //    erro HTTP = ExternalServiceError, response inválido = ZodError) aciona
  //    triggerAiFallback() em vez de propagar o erro ao outbox.
  //    O fallback garante que o cliente não fica sem resposta.
  // -------------------------------------------------------------------------
  const langGraph = new LangGraphClient(options.langGraphOptions);

  let aiResponse: Awaited<ReturnType<typeof langGraph.processWhatsAppMessage>>;
  try {
    aiResponse = await langGraph.processWhatsAppMessage(langGraphRequest, correlationId);
  } catch (lgErr) {
    // Sanitizar errMsg: ZodError.message despeja o JSON completo dos erros de validação
    // (estrutura interna do schema + valores recebidos), o que vaza topologia interna
    // em logs de produção. Substituímos por uma mensagem sintética.
    // Para outros erros, mantemos .message (já truncado ao passar ao fallback abaixo).
    const errMsg =
      lgErr instanceof ZodError
        ? `ZodError: schema violation (${lgErr.issues.length} issue${lgErr.issues.length !== 1 ? 's' : ''})`
        : lgErr instanceof Error
          ? lgErr.message
          : String(lgErr);

    logger.error(
      {
        eventId: event.id,
        conversationId,
        waMessageId,
        errName: lgErr instanceof Error ? lgErr.name : 'unknown',
        errMsg,
      },
      'LangGraph falhou — acionando fallback de handoff automático (F3-S34)',
    );

    // chatwootConversationId: '0' significa não sincronizado; parseInt retorna 0
    const chatwootConvIdForFallback = parseInt(chatwootConversationId, 10);

    // triggerAiFallback() pode lançar ExternalServiceError se o próprio
    // fallback falhar — propagamos para o outbox-publisher contabilizar.
    await triggerAiFallback(
      {
        eventId: event.id,
        correlationId,
        conversationId,
        chatwootConversationId: isNaN(chatwootConvIdForFallback) ? 0 : chatwootConvIdForFallback,
        organizationId,
        leadId,
        waMessageId,
        // Truncar a mensagem de erro para evitar vazamento de PII residual
        // e respeitar o limite de 2000 chars do schema (§8.3).
        aiErrorMessage: (lgErr instanceof Error ? lgErr.message : String(lgErr)).slice(0, 500),
      },
      options.fallbackOptions,
    );

    // Fallback concluído — evento processado com sucesso (sem re-throw).
    return;
  }

  logger.info(
    {
      eventId: event.id,
      conversationId,
      graphVersion: aiResponse.graph_version,
      latencyMs: aiResponse.latency_ms,
      replyType: aiResponse.reply.type,
      handoffRequired: aiResponse.handoff.required,
      actionsCount: aiResponse.actions.length,
    },
    'LangGraph respondeu com sucesso',
  );

  // -------------------------------------------------------------------------
  // 7. Enviar reply ao cliente via Chatwoot
  //    Apenas quando:
  //      a) reply.type != 'none'
  //      b) reply.content tem conteúdo
  //      c) chatwootConversationId é um número válido (conversa sincronizada)
  //
  //    LGPD: reply.content pode conter dados de contexto do cidadão após DLP
  //    no grafo. Não logar o conteúdo — apenas o tipo e tamanho.
  // -------------------------------------------------------------------------
  const chatwootConvId = parseInt(chatwootConversationId, 10);
  const canSendReply =
    aiResponse.reply.type !== 'none' &&
    aiResponse.reply.content.trim().length > 0 &&
    !isNaN(chatwootConvId) &&
    chatwootConvId > 0;

  if (canSendReply) {
    try {
      const chatwoot = new ChatwootClient(options.chatwootOptions);
      await chatwoot.createMessage(chatwootConvId, aiResponse.reply.content);
      logger.info(
        { eventId: event.id, conversationId, chatwootConvId, replyType: aiResponse.reply.type },
        'reply enviada ao cliente via Chatwoot',
      );
    } catch (chatwootErr) {
      // Log do erro de Chatwoot mas não propagar — a resposta da IA foi obtida
      // com sucesso. Falha de envio ao Chatwoot é tratada separadamente (F3-S34).
      // O evento permanece pendente e o outbox reprocessa em falha total.
      logger.error(
        { eventId: event.id, conversationId, err: chatwootErr },
        'falha ao enviar reply via Chatwoot — continuando',
      );
      // Re-throw: o outbox-publisher deve saber desta falha para contabilizar
      // tentativas e eventualmente mover para DLQ (segurança de entrega).
      throw chatwootErr;
    }
  } else {
    logger.info(
      {
        eventId: event.id,
        conversationId,
        replyType: aiResponse.reply.type,
        chatwootConvId,
      },
      'reply não enviada — type=none ou chatwoot_conversation_id inválido',
    );
  }

  // -------------------------------------------------------------------------
  // 8. Atualizar ai_conversation_states
  //    - lead_id (se a IA identificou/criou o lead neste turno)
  //    - last_message_at (para job de expiração)
  //    - currentNode (snapshot do estado do grafo)
  //    - graphVersion
  // -------------------------------------------------------------------------
  const updatedLeadId = aiResponse.lead_id ?? convState.leadId;

  await database
    .update(aiConversationStates)
    .set({
      leadId: updatedLeadId,
      currentNode: aiResponse.state.current_stage ?? convState.currentNode,
      graphVersion: aiResponse.graph_version,
      lastMessageAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(aiConversationStates.conversationId, conversationId));

  logger.info(
    { eventId: event.id, conversationId, leadId: updatedLeadId },
    'processamento com IA concluído',
  );
}

// ---------------------------------------------------------------------------
// Fábrica de EventHandler — compatível com RegisteredHandler.fn
// ---------------------------------------------------------------------------

/**
 * Retorna um EventHandler pronto para registrar via registerHandler().
 *
 * Usa db singleton de db/client.js. Chamado em workers/index.ts → setupWorkerHandlers().
 * Injeção de `_db` e `_options` disponível apenas em testes.
 */
export function buildProcessWithAiHandler(
  _db: Database = db,
  _options: ProcessWithAiOptions = {},
): (event: EventOutbox) => Promise<void> {
  return (event: EventOutbox) => handleProcessWithAi(_db, _options, event);
}
