// =============================================================================
// integrations/langgraph/schemas.ts — Zod schemas para o contrato backend ↔
// LangGraph (doc 06 §4.1 e §4.2).
//
// REGRA: estes schemas DEVEM ser mantidos em sincronia com os modelos Pydantic
// em apps/langgraph-service/app/schemas/inbound.py e outbound.py.
// Qualquer quebra de contrato entre os dois lados DEVE ser detectada em testes.
//
// LGPD §8.3 / §8.4:
//   - `customer_phone` e `message_text` são PII bruta.
//     Nunca logar estes campos — usar pino.redact na camada de log.
//   - `reply.content` pode conter dados de contexto do cidadão após DLP no grafo.
//     Não logar em nível info — apenas debug com redact habilitado.
//   - `handoff.summary` pode conter resumo de atendimento; tratar como PII.
//   - `messages[]` contém texto da resposta — não logar conteúdo (LGPD).
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Request: POST /process/whatsapp/message (doc 06 §4.1)
// ---------------------------------------------------------------------------

/** Metadados opcionais propagados ao estado inicial do grafo. */
export const LangGraphMessageMetadataSchema = z.object({
  city_id: z.string().nullable().default(null),
  city_name: z.string().nullable().default(null),
  customer_name: z.string().nullable().default(null),
  previous_state_loaded: z.boolean().default(false),
});

export type LangGraphMessageMetadata = z.infer<typeof LangGraphMessageMetadataSchema>;

/** Representação de um anexo de mensagem WhatsApp. */
export const LangGraphMessageAttachmentSchema = z.object({
  type: z.string(),
  url: z.string().nullable().optional(),
  caption: z.string().nullable().optional(),
  mime_type: z.string().nullable().optional(),
});

export type LangGraphMessageAttachment = z.infer<typeof LangGraphMessageAttachmentSchema>;

/**
 * Payload de request para POST /process/whatsapp/message.
 *
 * Replica fielmente WhatsAppMessageRequest do langgraph-service (inbound.py).
 * LGPD: `customer_phone` e `message_text` são PII — não logar.
 * Multi-tenant: `organization_id` obrigatório — repassado a todas as escritas /internal/*.
 */
export const LangGraphWhatsAppRequestSchema = z.object({
  /** UUID da organização — obrigatório para todas as escritas /internal/* (multi-tenant). Não é PII. */
  organization_id: z.string().uuid(),
  conversation_id: z.string().min(1),
  lead_id: z.string().nullable().default(null),
  // PII — NUNCA logar diretamente
  // E.164: + seguido de código de país (1-3 dígitos) + número (total 8-15 dígitos, ex: +5569999999999)
  customer_phone: z
    .string()
    .regex(/^\+[1-9]\d{7,14}$/, 'customer_phone deve estar no formato E.164 (ex: +5569999999999)'),
  message_text: z.string().default(''),
  message_attachments: z.array(LangGraphMessageAttachmentSchema).default([]),
  message_timestamp: z.string().datetime({ offset: true }),
  channel: z.literal('whatsapp').default('whatsapp'),
  chatwoot_conversation_id: z.string().min(1),
  chatwoot_account_id: z.string().min(1),
  metadata: LangGraphMessageMetadataSchema.default({}),
  correlation_id: z.string().min(1),
  idempotency_key: z.string().min(1),
});

export type LangGraphWhatsAppRequest = z.infer<typeof LangGraphWhatsAppRequestSchema>;

// ---------------------------------------------------------------------------
// Response: POST /process/whatsapp/message (doc 06 §4.2)
// ---------------------------------------------------------------------------

/** Resposta a ser enviada ao cliente via canal WhatsApp. */
export const LangGraphReplyPayloadSchema = z.object({
  type: z.enum(['text', 'template', 'none']),
  content: z.string().default(''),
  template_name: z.string().nullable().default(null),
  template_variables: z.array(z.string()).nullable().default(null),
});

export type LangGraphReplyPayload = z.infer<typeof LangGraphReplyPayloadSchema>;

/**
 * Ação de domínio emitida pelo grafo.
 * `extra="ignore"` no Pydantic equivale a `.passthrough()` + campos selecionados.
 * Usamos `.strip()` implícito do Zod (padrão) — campos extras são descartados.
 */
export const LangGraphActionItemSchema = z.object({
  type: z.string(),
  status: z.enum(['success', 'error', 'skipped']).default('success'),
  entity_id: z.string().nullable().default(null),
  data: z.record(z.string(), z.unknown()).nullable().default(null),
});

export type LangGraphActionItem = z.infer<typeof LangGraphActionItemSchema>;

/** Informações de handoff para atendimento humano. */
export const LangGraphHandoffInfoSchema = z.object({
  required: z.boolean(),
  reason: z.string().nullable().default(null),
  // LGPD: pode conter resumo de contexto — tratar como PII; não logar sem redact
  summary: z.string().nullable().default(null),
});

export type LangGraphHandoffInfo = z.infer<typeof LangGraphHandoffInfoSchema>;

/** Snapshot resumido do estado de fluxo do grafo após o turno. */
export const LangGraphStateSnapshotSchema = z.object({
  current_stage: z.string().nullable().default(null),
  current_intent: z.string().nullable().default(null),
  next_expected_input: z.string().nullable().default(null),
  missing_fields: z.array(z.string()).default([]),
});

export type LangGraphStateSnapshot = z.infer<typeof LangGraphStateSnapshotSchema>;

/**
 * Response completo de POST /process/whatsapp/message (doc 06 §4.2).
 *
 * Replica fielmente WhatsAppMessageResponse do langgraph-service (outbound.py).
 * Validado com .parse() antes de qualquer uso — lança ZodError se contrato quebrar.
 *
 * F16-S44: `messages` array de strings para envio multi-mensagem (pipeline agêntica Ana Clara).
 * LGPD: não logar conteúdo de `messages[]` — apenas IDs/contadores.
 * Retrocompat: quando `messages` vazio, worker usa `reply.content` (funil antigo/flag OFF).
 */
export const LangGraphWhatsAppResponseSchema = z.object({
  conversation_id: z.string(),
  lead_id: z.string().nullable().default(null),
  reply: LangGraphReplyPayloadSchema,
  /**
   * Array de mensagens a enviar ao cliente, na ordem.
   * Pipeline agêntica (Ana Clara): o grafo retorna N mensagens curtas.
   * Default `[]` para retrocompat com funil antigo (flag OFF).
   * LGPD: não logar conteúdo — apenas length.
   */
  messages: z.array(z.string()).default([]),
  actions: z.array(LangGraphActionItemSchema).default([]),
  handoff: LangGraphHandoffInfoSchema,
  state: LangGraphStateSnapshotSchema,
  model: z.string().nullable().default(null),
  prompt_version: z.string().nullable().default(null),
  graph_version: z.string(),
  latency_ms: z.number().int().nonnegative(),
  errors: z.array(z.record(z.string(), z.unknown())).default([]),
});

export type LangGraphWhatsAppResponse = z.infer<typeof LangGraphWhatsAppResponseSchema>;
