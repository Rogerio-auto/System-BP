// =============================================================================
// integrations/channels/meta/whatsapp/webhook.parser.ts
//
// Parser do envelope de webhook Meta WhatsApp Cloud API.
//
// Responsabilidades:
//   - Validar estrutura do envelope com Zod (sem `any`).
//   - Extrair InboundEvent[] normalizados para cada entrada no array `messages`
//     e `statuses` de cada entry.
//   - Suportar os tipos: text, image, video, audio, voice, document, sticker,
//     location, contact, interactive (button_reply / list_reply), reaction,
//     order (→ 'interactive'), flow_completion, status updates.
//   - Tipos desconhecidos → retornam event com messageType='text' e content
//     descrevendo o tipo, OU são silenciosamente omitidos quando não há payload
//     utilizável (ex: deleted).
//
// LGPD (doc 17 §8.3):
//   - NÃO logar o corpo do webhook (pode ter PII: número de telefone, texto).
//   - O campo `contactRemoteId` (phone E.164) não deve aparecer em logs.
//   - `metadata` nunca inclui PII bruta.
//
// Portado de packages/channels/src/meta/whatsapp/webhook.parser.ts (tagix).
// Adaptado para os InboundEvent schemas de packages/shared-schemas/src/livechat.ts.
// =============================================================================

import type { InboundEvent } from '@elemento/shared-schemas';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Zod schemas do envelope Meta WhatsApp
//
// Usamos `.passthrough()` nos objetos onde a Meta pode adicionar campos sem aviso.
// Mantemos apenas os campos que o parser precisa extrair — o `raw` carrega o resto.
// ---------------------------------------------------------------------------

const MetaContactSchema = z
  .object({
    wa_id: z.string(),
    profile: z.object({ name: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

const MetaTextSchema = z.object({ body: z.string() }).passthrough();

const MetaMediaSchema = z
  .object({
    id: z.string().optional(),
    url: z.string().optional(),
    mime_type: z.string().optional(),
    sha256: z.string().optional(),
    filename: z.string().optional(),
    caption: z.string().optional(),
    voice: z.boolean().optional(),
  })
  .passthrough();

const MetaLocationSchema = z
  .object({
    latitude: z.number(),
    longitude: z.number(),
    name: z.string().optional(),
    address: z.string().optional(),
  })
  .passthrough();

const MetaContactCardSchema = z
  .object({
    name: z.object({ formatted_name: z.string().optional() }).passthrough().optional(),
    phones: z.array(z.object({ phone: z.string().optional() }).passthrough()).optional(),
  })
  .passthrough();

const MetaInteractiveSchema = z
  .object({
    type: z.enum(['button_reply', 'list_reply', 'nfm_reply']),
    button_reply: z.object({ id: z.string(), title: z.string() }).passthrough().optional(),
    list_reply: z
      .object({ id: z.string(), title: z.string(), description: z.string().optional() })
      .passthrough()
      .optional(),
    nfm_reply: z
      .object({ response_json: z.string().optional(), name: z.string().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

const MetaReactionSchema = z.object({ message_id: z.string(), emoji: z.string() }).passthrough();

const MetaContextSchema = z
  .object({ id: z.string().optional(), from: z.string().optional() })
  .passthrough()
  .optional();

const MetaOrderSchema = z
  .object({
    catalog_id: z.string().optional(),
    product_items: z.array(z.unknown()).optional(),
  })
  .passthrough();

// Interface explícita para MetaMessage — necessária para contornar TS7056:
// o tipo inferido do schema aninhado excede o tamanho máximo de serialização.
interface MetaMessage {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body: string; [k: string]: unknown };
  image?: {
    id?: string;
    url?: string;
    mime_type?: string;
    sha256?: string;
    caption?: string;
    voice?: boolean;
    [k: string]: unknown;
  };
  video?: {
    id?: string;
    url?: string;
    mime_type?: string;
    sha256?: string;
    caption?: string;
    [k: string]: unknown;
  };
  audio?: {
    id?: string;
    url?: string;
    mime_type?: string;
    sha256?: string;
    voice?: boolean;
    [k: string]: unknown;
  };
  document?: {
    id?: string;
    url?: string;
    mime_type?: string;
    sha256?: string;
    filename?: string;
    caption?: string;
    [k: string]: unknown;
  };
  sticker?: {
    id?: string;
    url?: string;
    mime_type?: string;
    sha256?: string;
    [k: string]: unknown;
  };
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
    [k: string]: unknown;
  };
  contacts?: Array<{
    name?: { formatted_name?: string; [k: string]: unknown };
    phones?: Array<{ phone?: string; [k: string]: unknown }>;
    [k: string]: unknown;
  }>;
  interactive?: {
    type: 'button_reply' | 'list_reply' | 'nfm_reply';
    button_reply?: { id: string; title: string; [k: string]: unknown };
    list_reply?: { id: string; title: string; description?: string; [k: string]: unknown };
    nfm_reply?: { response_json?: string; name?: string; [k: string]: unknown };
    [k: string]: unknown;
  };
  reaction?: { message_id: string; emoji: string; [k: string]: unknown };
  order?: { catalog_id?: string; product_items?: unknown[]; [k: string]: unknown };
  context?: { id?: string; from?: string; [k: string]: unknown };
  [k: string]: unknown;
}

// Mensagem individual dentro de messages[]
const MetaMessageSchema: z.ZodType<MetaMessage> = z
  .object({
    id: z.string(),
    from: z.string(),
    timestamp: z.string(),
    type: z.string(),
    text: MetaTextSchema.optional(),
    image: MetaMediaSchema.optional(),
    video: MetaMediaSchema.optional(),
    audio: MetaMediaSchema.optional(),
    document: MetaMediaSchema.optional(),
    sticker: MetaMediaSchema.optional(),
    location: MetaLocationSchema.optional(),
    contacts: z.array(MetaContactCardSchema).optional(),
    interactive: MetaInteractiveSchema.optional(),
    reaction: MetaReactionSchema.optional(),
    order: MetaOrderSchema.optional(),
    context: MetaContextSchema,
  })
  .passthrough() as z.ZodType<MetaMessage>;

// Status update dentro de statuses[]
const MetaStatusSchema = z
  .object({
    id: z.string(),
    recipient_id: z.string(),
    status: z.enum(['sent', 'delivered', 'read', 'failed']),
    timestamp: z.string(),
    errors: z
      .array(z.object({ code: z.number(), title: z.string().optional() }).passthrough())
      .optional(),
  })
  .passthrough();

// Value dentro de cada entry (contém messages e statuses)
const MetaValueSchema = z
  .object({
    messaging_product: z.string().optional(),
    metadata: z
      .object({ display_phone_number: z.string().optional(), phone_number_id: z.string() })
      .passthrough()
      .optional(),
    contacts: z.array(MetaContactSchema).optional(),
    messages: z.array(MetaMessageSchema).optional(),
    statuses: z.array(MetaStatusSchema).optional(),
  })
  .passthrough();

const MetaChangeSchema = z
  .object({
    value: MetaValueSchema,
    field: z.string().optional(),
  })
  .passthrough();

const MetaEntrySchema = z
  .object({
    id: z.string(),
    changes: z.array(MetaChangeSchema),
  })
  .passthrough();

/**
 * Schema do envelope raiz do webhook Meta WhatsApp.
 * Validado no boundary de entrada — antes de qualquer processamento.
 */
export const MetaWebhookEnvelopeSchema = z
  .object({
    object: z.string(),
    entry: z.array(MetaEntrySchema),
  })
  .passthrough();

export type MetaWebhookEnvelope = z.infer<typeof MetaWebhookEnvelopeSchema>;

// ---------------------------------------------------------------------------
// ParseInboundOptions — contexto injetado pelo webhook handler
// ---------------------------------------------------------------------------

/**
 * Contexto necessário para normalizar o envelope.
 * organizationId e channelId são UUID do banco — resolvidos pelo dispatcher
 * via WABA id do envelope.
 */
export interface ParseInboundOptions {
  /** UUID da organização dona do canal. */
  readonly organizationId: string;
  /** UUID do canal (channels.id no DB). */
  readonly channelId: string;
}

// ---------------------------------------------------------------------------
// parseMetaWebhookEnvelope — função principal
// ---------------------------------------------------------------------------

/**
 * Valida e normaliza o envelope de webhook Meta WhatsApp em InboundEvent[].
 *
 * Retorna array vazio se o envelope não contiver eventos de mensagem ou status
 * relevantes (ex: verificação de webhook, entry vazia).
 *
 * LGPD: não logar `envelope` — pode conter número de telefone e conteúdo.
 *
 * @param rawEnvelope  Payload bruto parseado de JSON (desconhecido).
 * @param opts         Contexto injetado pelo dispatcher.
 * @returns            Array de eventos normalizados (zero ou mais).
 * @throws ZodError    Se o envelope não passar na validação estrutural.
 */
export function parseMetaWebhookEnvelope(
  rawEnvelope: unknown,
  opts: ParseInboundOptions,
): ReadonlyArray<InboundEvent> {
  const envelope = MetaWebhookEnvelopeSchema.parse(rawEnvelope);
  const events: InboundEvent[] = [];

  for (const entry of envelope.entry) {
    for (const change of entry.changes) {
      const { value } = change;

      // ── Messages ─────────────────────────────────────────────────────────
      for (const msg of value.messages ?? []) {
        const parsed = parseMessage(msg, opts);
        if (parsed !== null) {
          events.push(parsed);
        }
      }

      // ── Status updates ────────────────────────────────────────────────────
      for (const status of value.statuses ?? []) {
        const parsed = parseStatus(status, opts);
        if (parsed !== null) {
          events.push(parsed);
        }
      }
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// parseMessage — normaliza uma mensagem individual
// ---------------------------------------------------------------------------

// MetaMessage interface defined above MetaMessageSchema to break TS7056 inference chain

function parseMessage(msg: MetaMessage, opts: ParseInboundOptions): InboundEvent | null {
  const { organizationId, channelId } = opts;
  const base = {
    organizationId,
    channelId,
    provider: 'meta_whatsapp' as const,
    contactRemoteId: msg.from,
    externalId: msg.id,
    rawTimestamp: msg.timestamp,
  };

  switch (msg.type) {
    // ── Text ──────────────────────────────────────────────────────────────
    case 'text':
      return {
        type: 'message',
        ...base,
        messageType: 'text',
        content: msg.text?.body ?? '',
        metadata: msg.context?.id !== undefined ? { replyToExternalId: msg.context.id } : undefined,
      };

    // ── Image ─────────────────────────────────────────────────────────────
    case 'image':
      return {
        type: 'message',
        ...base,
        messageType: 'image',
        content: msg.image?.caption,
        mediaRef: buildMediaRef(msg.image),
        metadata: msg.context?.id !== undefined ? { replyToExternalId: msg.context.id } : undefined,
      };

    // ── Video ─────────────────────────────────────────────────────────────
    case 'video':
      return {
        type: 'message',
        ...base,
        messageType: 'video',
        content: msg.video?.caption,
        mediaRef: buildMediaRef(msg.video),
        metadata: msg.context?.id !== undefined ? { replyToExternalId: msg.context.id } : undefined,
      };

    // ── Audio (voz PTT vs áudio regular) ──────────────────────────────────
    case 'audio': {
      const isVoice = msg.audio?.voice === true;
      return {
        type: 'message',
        ...base,
        messageType: isVoice ? 'voice' : 'audio',
        mediaRef: buildMediaRef(msg.audio),
        metadata: msg.context?.id !== undefined ? { replyToExternalId: msg.context.id } : undefined,
      };
    }

    // ── Document ──────────────────────────────────────────────────────────
    case 'document':
      return {
        type: 'message',
        ...base,
        messageType: 'document',
        content: msg.document?.caption,
        mediaRef: buildMediaRef(msg.document),
        metadata: msg.context?.id !== undefined ? { replyToExternalId: msg.context.id } : undefined,
      };

    // ── Sticker ───────────────────────────────────────────────────────────
    case 'sticker':
      return {
        type: 'message',
        ...base,
        messageType: 'sticker',
        mediaRef: buildMediaRef(msg.sticker),
      };

    // ── Location ──────────────────────────────────────────────────────────
    case 'location': {
      if (msg.location === undefined) return null;
      const { latitude, longitude, name, address } = msg.location;
      return {
        type: 'message',
        ...base,
        messageType: 'location',
        metadata: {
          latitude,
          longitude,
          ...(name !== undefined ? { name } : {}),
          ...(address !== undefined ? { address } : {}),
        },
      };
    }

    // ── Contact ───────────────────────────────────────────────────────────
    case 'contacts': {
      const contacts = msg.contacts ?? [];
      return {
        type: 'message',
        ...base,
        messageType: 'contact',
        // Serialize contact names only (no phone numbers in metadata — LGPD)
        metadata: {
          contactCount: contacts.length,
          names: contacts.map((c) => c.name?.formatted_name ?? '').filter(Boolean),
        },
      };
    }

    // ── Interactive (button_reply / list_reply / flow reply) ──────────────
    case 'interactive': {
      const interactive = msg.interactive;
      if (interactive === undefined) return null;

      const replyData: Record<string, unknown> = { interactiveType: interactive.type };

      if (interactive.type === 'button_reply' && interactive.button_reply !== undefined) {
        replyData['buttonId'] = interactive.button_reply.id;
        replyData['buttonTitle'] = interactive.button_reply.title;
      } else if (interactive.type === 'list_reply' && interactive.list_reply !== undefined) {
        replyData['rowId'] = interactive.list_reply.id;
        replyData['rowTitle'] = interactive.list_reply.title;
        if (interactive.list_reply.description !== undefined) {
          replyData['rowDescription'] = interactive.list_reply.description;
        }
      } else if (interactive.type === 'nfm_reply' && interactive.nfm_reply !== undefined) {
        // Flow submission (WhatsApp Flows)
        replyData['flowName'] = interactive.nfm_reply.name;
        // response_json is a JSON string from the flow — parse it safely
        if (interactive.nfm_reply.response_json !== undefined) {
          try {
            replyData['responseJson'] = JSON.parse(interactive.nfm_reply.response_json) as unknown;
          } catch {
            replyData['responseJson'] = interactive.nfm_reply.response_json;
          }
        }
      }

      return {
        type: 'message',
        ...base,
        messageType: 'interactive',
        metadata: replyData,
        ...(msg.context?.id !== undefined ? { content: msg.context.id } : {}),
      };
    }

    // ── Order (e-commerce catalog) ────────────────────────────────────────
    case 'order': {
      if (msg.order === undefined) return null;
      return {
        type: 'message',
        ...base,
        messageType: 'interactive', // orders mapeiam para interactive no schema
        metadata: {
          orderKind: 'catalog',
          catalogId: msg.order.catalog_id,
          itemCount: (msg.order.product_items ?? []).length,
        },
      };
    }

    // ── Reaction ─────────────────────────────────────────────────────────
    case 'reaction': {
      if (msg.reaction === undefined) return null;
      return {
        type: 'reaction',
        organizationId,
        channelId,
        provider: 'meta_whatsapp' as const,
        contactRemoteId: msg.from,
        targetExternalId: msg.reaction.message_id,
        emoji: msg.reaction.emoji,
      };
    }

    // ── Unsupported / unknown ─────────────────────────────────────────────
    case 'system':
    case 'button': // legacy button type (pre-interactive)
    case 'unsupported':
      // Silently drop — no actionable content
      return null;

    default:
      // Unknown future type — return as 'text' with type hint in metadata
      return {
        type: 'message',
        ...base,
        messageType: 'text',
        content: `[unsupported type: ${msg.type}]`,
        metadata: { originalType: msg.type },
      };
  }
}

// ---------------------------------------------------------------------------
// parseStatus — normaliza um status update
// ---------------------------------------------------------------------------

type MetaStatus = z.infer<typeof MetaStatusSchema>;

function parseStatus(status: MetaStatus, opts: ParseInboundOptions): InboundEvent | null {
  // Só processar status que o schema suporta
  if (!['sent', 'delivered', 'read', 'failed'].includes(status.status)) {
    return null;
  }

  return {
    type: 'status',
    organizationId: opts.organizationId,
    channelId: opts.channelId,
    provider: 'meta_whatsapp' as const,
    externalId: status.id,
    status: status.status,
    rawTimestamp: status.timestamp,
  };
}

// ---------------------------------------------------------------------------
// buildMediaRef — constrói MediaRef a partir de campos de mídia WA
// ---------------------------------------------------------------------------

type MetaMedia = z.infer<typeof MetaMediaSchema>;

function buildMediaRef(
  media: MetaMedia | undefined,
): { refOrUrl: string; mimeType?: string; sha256?: string; fileName?: string } | undefined {
  if (media === undefined) return undefined;

  // Preferir mediaId (sem URL pública com PII) conforme adapter.types.ts
  const refOrUrl = media.id ?? media.url;
  if (refOrUrl === undefined) return undefined;

  return {
    refOrUrl,
    ...(media.mime_type !== undefined ? { mimeType: media.mime_type } : {}),
    ...(media.sha256 !== undefined ? { sha256: media.sha256 } : {}),
    ...(media.filename !== undefined ? { fileName: media.filename } : {}),
  };
}
