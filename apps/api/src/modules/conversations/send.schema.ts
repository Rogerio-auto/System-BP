// =============================================================================
// conversations/send.schema.ts — Schemas Zod para envio de mensagem outbound.
//
// Este módulo é o ponto de entrada da composição humana (atendente).
// Discrimina por tipo (text | media | template | interactive) para garantir
// que cada variante tem apenas os campos necessários — sem campos extras.
//
// Regras LGPD (doc 17 §8.1, §8.3, §8.5):
//   - `content` (texto da mensagem) é PII — nunca logar sem redact.
//   - Idempotency-Key: header obrigatório — evita duplo envio.
//   - Signed-URL de upload: key R2 gerada com orgId no path (sem PII).
//
// Sem `any`. Sem `as` sem justificativa.
// =============================================================================
import {
  InteractivePayloadSchema,
  MEDIA_MAX_BYTES_ANY,
  formatMaxBytes,
  maxUploadBytesForMime,
} from '@elemento/shared-schemas';
import type { MessageTypeSchema } from '@elemento/shared-schemas';
import { z } from 'zod';

import { ConversationStatusSchema } from './schemas.js';

// ---------------------------------------------------------------------------
// SendMessageBody — discriminated union por tipo de mensagem
//
// Campos ausentes de cada variante:
//   organizationId, channelId, conversationId: vêm do JWT e do path param.
//   messageId: gerado pelo service ao persistir (antes de enfileirar).
//   contactRemoteId: recuperado da conversa no DB.
// ---------------------------------------------------------------------------

/** Mensagem de texto livre. */
const SendTextSchema = z.object({
  type: z.literal('text'),
  /** Texto da mensagem. LGPD: PII — não logar. */
  content: z.string().min(1).max(4_096).describe('Corpo da mensagem de texto'),
  /** ID externo da mensagem que está sendo respondida (opcional). */
  replyToExternalId: z.string().optional().describe('ID externo da mensagem citada'),
});

/** Mensagem com mídia (imagem, vídeo, áudio, documento, sticker). */
const SendMediaSchema = z.object({
  type: z.literal('media'),
  mediaKind: z
    .enum(['image', 'video', 'audio', 'voice', 'document', 'sticker'])
    .describe('Tipo de mídia'),
  /**
   * URL pública do arquivo no R2.
   * O atendente deve fazer upload via POST /conversations/:id/uploads/signed-url
   * e usar a publicMediaUrl retornada aqui.
   */
  publicMediaUrl: z.string().url().describe('URL pública do arquivo no R2'),
  mime: z.string().min(1).describe('MIME type do arquivo (ex: image/jpeg)'),
  caption: z.string().max(1_024).optional().describe('Legenda da mídia'),
  replyToExternalId: z.string().optional().describe('ID externo da mensagem citada'),
});

/** Template pré-aprovado Meta. Obrigatório fora da janela 24h (WhatsApp). */
const SendTemplateSchema = z.object({
  type: z.literal('template'),
  templateName: z.string().min(1).describe('Nome do template aprovado na Meta'),
  languageCode: z.string().min(2).max(8).describe('Código de idioma (ex: pt_BR)'),
  // components mantido como array aberto — ver comentário em shared-schemas/livechat.ts
  components: z.array(z.unknown()).describe('Componentes do template (header/body/buttons)'),
});

/** Mensagem interativa (botões ou lista). */
const SendInteractiveSchema = z.object({
  type: z.literal('interactive'),
  payload: InteractivePayloadSchema.describe('Payload da mensagem interativa'),
  replyToExternalId: z.string().optional().describe('ID externo da mensagem citada'),
});

/** Resposta privada a comentário do Instagram. */
const SendIgPrivateReplySchema = z.object({
  type: z.literal('ig_private_reply'),
  commentId: z.string().min(1).describe('ID do comentário Instagram a responder privadamente'),
  content: z.string().min(1).max(4_096).describe('Corpo da mensagem privada'),
});

export const SendMessageBodySchema = z.discriminatedUnion('type', [
  SendTextSchema,
  SendMediaSchema,
  SendTemplateSchema,
  SendInteractiveSchema,
  SendIgPrivateReplySchema,
]);

export type SendMessageBody = z.infer<typeof SendMessageBodySchema>;

// ---------------------------------------------------------------------------
// Mapeamento de type → MessageType (para inserção na tabela messages)
// ---------------------------------------------------------------------------

/**
 * Converte o `type` do payload de envio para o `MessageType` da tabela messages.
 * Para `media`, usa o `mediaKind` como tipo específico (ex: 'image', 'video').
 *
 * TypeScript verifica exaustão de casos — switch nunca tem um case inesperado.
 */
export function toMessageType(body: SendMessageBody): z.infer<typeof MessageTypeSchema> {
  switch (body.type) {
    case 'text':
      return 'text';
    case 'media':
      // mediaKind é o tipo específico: 'image' | 'video' | 'audio' | ...
      return body.mediaKind;
    case 'template':
      return 'template';
    case 'interactive':
      return 'interactive';
    case 'ig_private_reply':
      return 'text';
  }
}

// ---------------------------------------------------------------------------
// SendMessageResponse — resposta 202 Accepted
// ---------------------------------------------------------------------------

export const SendMessageResponseSchema = z.object({
  messageId: z.string().uuid().describe('ID interno da mensagem enfileirada'),
  status: z.literal('queued').describe('Status inicial: mensagem aguardando envio'),
});

export type SendMessageResponse = z.infer<typeof SendMessageResponseSchema>;

// ---------------------------------------------------------------------------
// ConversationIdParam — param :id validado como UUID
// ---------------------------------------------------------------------------

export const ConversationIdParamSchema = z.object({
  id: z.string().uuid().describe('UUID da conversa'),
});

export type ConversationIdParam = z.infer<typeof ConversationIdParamSchema>;

// ---------------------------------------------------------------------------
// AssignBody — corpo do PATCH /conversations/:id/assign
// ---------------------------------------------------------------------------

export const AssignBodySchema = z.object({
  agentId: z.string().uuid().nullable().describe('UUID do agente ou null para desatribuir'),
});

export type AssignBody = z.infer<typeof AssignBodySchema>;

export const AssignResponseSchema = z.object({
  conversationId: z.string().uuid(),
  assignedUserId: z.string().uuid().nullable(),
  updatedAt: z.string().datetime(),
});

export type AssignResponse = z.infer<typeof AssignResponseSchema>;

// ---------------------------------------------------------------------------
// ResolveResponse — resposta do PATCH /conversations/:id/resolve
// ---------------------------------------------------------------------------

export const ResolveResponseSchema = z.object({
  conversationId: z.string().uuid(),
  status: z.literal('resolved'),
  updatedAt: z.string().datetime(),
});

export type ResolveResponse = z.infer<typeof ResolveResponseSchema>;

// ---------------------------------------------------------------------------
// SignedUrlBody — corpo do POST /conversations/:id/uploads/signed-url
// ---------------------------------------------------------------------------

export const SignedUrlBodySchema = z
  .object({
    /** Nome do arquivo (sem path). Usado para Content-Disposition. */
    fileName: z.string().min(1).max(255).describe('Nome do arquivo (ex: imagem.jpg)'),
    /** MIME type do arquivo. */
    mime: z.string().min(1).describe('MIME type (ex: image/jpeg)'),
    /** Tamanho em bytes. Validado contra o limite por tipo de mídia. */
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(MEDIA_MAX_BYTES_ANY)
      .describe('Tamanho em bytes (teto absoluto do deploy)'),
  })
  // Limite por tipo (WhatsApp): imagem 5MB, áudio/vídeo 16MB, documento 50MB.
  // Fonte única em @elemento/shared-schemas (maxUploadBytesForMime).
  .superRefine((data, ctx) => {
    const limit = maxUploadBytesForMime(data.mime);
    if (data.sizeBytes > limit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sizeBytes'],
        message: `Arquivo excede o limite de ${formatMaxBytes(limit)} para este tipo de mídia.`,
      });
    }
  });

export type SignedUrlBody = z.infer<typeof SignedUrlBodySchema>;

export const SignedUrlResponseSchema = z.object({
  /** URL pré-assinada para upload direto (método PUT, válida por 15 minutos). */
  uploadUrl: z.string().url().describe('URL pré-assinada para PUT direto no R2 (15 min)'),
  /** URL pública permanente para usar como `publicMediaUrl` no envio. */
  publicMediaUrl: z.string().url().describe('URL pública do objeto após upload'),
  /** Chave R2 do objeto. */
  key: z.string().min(1).describe('Chave do objeto no bucket R2'),
});

export type SignedUrlResponse = z.infer<typeof SignedUrlResponseSchema>;

// ---------------------------------------------------------------------------
// SetStatusBody — corpo do PATCH /conversations/:id/status
// ---------------------------------------------------------------------------

/**
 * Body do PATCH /api/conversations/:id/status.
 *
 * Aceita qualquer um dos 4 status canônicos. Idempotente:
 * enviar o mesmo status que já está gravado retorna 200 sem erro.
 */
export const SetStatusBodySchema = z.object({
  status: ConversationStatusSchema.describe(
    'Novo status da conversa: open | pending | resolved | snoozed.',
  ),
});

export type SetStatusBody = z.infer<typeof SetStatusBodySchema>;

/**
 * Resposta do PATCH /api/conversations/:id/status.
 *
 * Padrão dos outros PATCH do módulo (assign/resolve): IDs opacos + timestamp.
 */
export const SetStatusResponseSchema = z.object({
  conversationId: z.string().uuid().describe('UUID da conversa alterada.'),
  status: ConversationStatusSchema.describe('Status atual da conversa após a alteração.'),
  updatedAt: z.string().datetime().describe('Timestamp da última atualização.'),
});

export type SetStatusResponse = z.infer<typeof SetStatusResponseSchema>;
