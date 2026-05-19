// =============================================================================
// internal/chatwoot/schemas.ts — Schemas Zod para POST /internal/chatwoot/notes (F3-S08).
//
// Canal M2M: consumido pela tool `create_chatwoot_note` (F3-S18, LangGraph).
// Autenticação: X-Internal-Token (não JWT).
//
// LGPD (doc 17 §8.3):
//   - `body` pode conter texto livre de atendimento (resumo, orientações, PII interna).
//   - É dado interno de atendimento — não visível ao cliente (nota interna Chatwoot).
//   - Logs devem redact do campo 'body' via pino.redact em app.ts.
//   - Resposta retorna apenas ID opaco — sem PII.
//   - chatwootConversationId é ID técnico de sistema — não é PII direta.
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Body do request
// ---------------------------------------------------------------------------

/**
 * Payload enviado pela tool `create_chatwoot_note` (F3-S18) para criar uma
 * nota interna em uma conversa do Chatwoot.
 *
 * `type: 'internal'` é o único valor aceito — o endpoint é especializado em
 * notas internas (não visíveis ao cliente). Não há endpoint genérico de mensagem.
 *
 * LGPD: `body` pode conter resumo de atendimento com PII (nome, cidade,
 * orientações geradas pela IA). Nota interna = dado interno de atendimento.
 */
export const CreateChatwootNoteBodySchema = z.object({
  /**
   * ID numérico da conversa no Chatwoot onde a nota será criada.
   * LGPD: ID técnico de sistema — não é PII.
   */
  chatwootConversationId: z.coerce
    .number({ required_error: 'chatwootConversationId é obrigatório' })
    .int('chatwootConversationId deve ser inteiro')
    .positive('chatwootConversationId deve ser positivo'),

  /**
   * Conteúdo da nota interna. Aceita markdown.
   *
   * O caller (tool `create_chatwoot_note`) é responsável por:
   *   - Usar o formato de markdown padrão (doc 07 §2.4) quando aplicável.
   *   - Aplicar DLP antes de chamar este endpoint (doc 17 §8.4).
   *
   * LGPD: dado interno de atendimento — coberto por pino.redact.
   */
  body: z
    .string({ required_error: 'body é obrigatório' })
    .min(1, 'body não pode ser vazio')
    .max(10_000, 'body não pode exceder 10.000 caracteres'),

  /**
   * Tipo da nota. Sempre 'internal' — endpoint especializado em notas internas.
   * Notas internas não são visíveis ao cliente no Chatwoot.
   */
  type: z.literal('internal', {
    required_error: 'type é obrigatório',
    invalid_type_error: "type deve ser 'internal'",
  }),
});

export type CreateChatwootNoteBody = z.infer<typeof CreateChatwootNoteBodySchema>;

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

/**
 * Resposta do endpoint de criação de nota.
 *
 * LGPD: retorna apenas ID opaco. Nenhuma PII (conteúdo da nota, dados do
 * cliente) é incluída na resposta — minimização de dados (doc 17 §3.4).
 */
export const CreateChatwootNoteResponseSchema = z.object({
  /**
   * ID numérico da nota criada no Chatwoot.
   * Corresponde ao `id` da mensagem retornado pela API Chatwoot.
   */
  note_id: z.number().int().positive(),
});

export type CreateChatwootNoteResponse = z.infer<typeof CreateChatwootNoteResponseSchema>;
