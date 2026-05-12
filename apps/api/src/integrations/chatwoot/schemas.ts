// =============================================================================
// integrations/chatwoot/schemas.ts — Zod schemas para respostas da API Chatwoot.
//
// Toda resposta da API Chatwoot DEVE passar por .parse() antes de ser usada.
// Use .strip() implícito do Zod para ignorar campos extras — garante que campos
// desconhecidos adicionados por versões futuras do Chatwoot não causem erros.
//
// Referência: https://www.chatwoot.com/docs/api
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Primitivas compartilhadas
// ---------------------------------------------------------------------------

/** Atributos customizados de uma conversa: chaves arbitrárias, valores escalares. */
export const ChatwootCustomAttributesSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);

/** Agente atribuído retornado em respostas de conversa. */
export const ChatwootAgentSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  email: z.string().optional(),
  availability_status: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Mensagem
// ---------------------------------------------------------------------------

/**
 * Schema de resposta para criação/leitura de mensagem no Chatwoot.
 * Usado por createMessage() e createNote().
 *
 * LGPD §8.3: `content` pode conter texto livre do cidadão (PII).
 * NÃO logar este objeto em nível info — apenas debug, com redact habilitado.
 */
export const ChatwootMessageResponseSchema = z.object({
  id: z.number().int(),
  content: z.string(),
  // 'outgoing' | 'incoming' — string aberta para tolerar novos valores
  message_type: z.string(),
  // true = nota interna, false = mensagem visível ao cliente
  private: z.boolean(),
  created_at: z.number().int(),
  conversation_id: z.number().int().optional(),
  account_id: z.number().int().optional(),
});

export type ChatwootMessageResponse = z.infer<typeof ChatwootMessageResponseSchema>;

// ---------------------------------------------------------------------------
// Conversa (retorno de updateAttributes)
// ---------------------------------------------------------------------------

/**
 * Schema de resposta parcial de conversa.
 * Retornado pelo PATCH de custom_attributes.
 *
 * Usamos .passthrough() intencionalmente: a API Chatwoot retorna muitos
 * campos adicionais que não precisamos; Zod descarta com strip (padrão),
 * mantemos apenas o que usamos.
 */
export const ChatwootConversationResponseSchema = z.object({
  id: z.number().int(),
  status: z.string(),
  custom_attributes: ChatwootCustomAttributesSchema.optional(),
  meta: z
    .object({
      assignee: ChatwootAgentSchema.optional(),
      sender: z
        .object({
          id: z.number().int(),
          name: z.string(),
        })
        .optional(),
    })
    .optional(),
});

export type ChatwootConversationResponse = z.infer<typeof ChatwootConversationResponseSchema>;

// ---------------------------------------------------------------------------
// Atribuição de agente
// ---------------------------------------------------------------------------

/**
 * Schema de resposta para atribuição de agente a uma conversa.
 * POST /api/v1/accounts/:account_id/conversations/:id/assignments
 */
export const ChatwootAssignmentResponseSchema = z.object({
  assignee: ChatwootAgentSchema,
});

export type ChatwootAssignmentResponse = z.infer<typeof ChatwootAssignmentResponseSchema>;

// ---------------------------------------------------------------------------
// Corpo das requisições de saída (para documentação interna e testes)
// ---------------------------------------------------------------------------

/** Payload para PATCH de custom_attributes de conversa. */
export const ChatwootUpdateAttributesBodySchema = z.object({
  custom_attributes: ChatwootCustomAttributesSchema,
});

export type ChatwootUpdateAttributesBody = z.infer<typeof ChatwootUpdateAttributesBodySchema>;

/** Payload para criação de mensagem ou nota. */
export const ChatwootCreateMessageBodySchema = z.object({
  content: z.string().min(1),
  message_type: z.enum(['outgoing', 'incoming']).default('outgoing'),
  private: z.boolean().default(false),
});

export type ChatwootCreateMessageBody = z.infer<typeof ChatwootCreateMessageBodySchema>;

/** Payload para atribuição de agente. */
export const ChatwootAssignAgentBodySchema = z.object({
  assignee_id: z.number().int().positive(),
});

export type ChatwootAssignAgentBody = z.infer<typeof ChatwootAssignAgentBodySchema>;
