// =============================================================================
// internal/handoffs/schemas.ts — Schemas Zod para POST /internal/handoffs (F3-S07).
//
// Canal M2M: consumido pela tool `request_handoff` (F3-S17, LangGraph) e pelo
// fallback de falha da IA (F3-S34).
//
// Autenticação: X-Internal-Token (não JWT).
// Idempotência: Idempotency-Key obrigatório — a IA pode reenviar em retry.
//
// LGPD (doc 17 §8.1, §3.4):
//   - leadId, conversationId, simulationId são UUIDs opacos — não são PII.
//   - summary pode conter texto livre com dados de atendimento (nome, cidade,
//     valor). É dado interno de atendimento, não exposto externamente.
//   - Logs devem redact o campo 'summary' via pino.redact em app.ts.
//   - Resposta retorna apenas IDs opacos — nenhuma PII é retornada.
//   - O evento outbox 'chatwoot.handoff_requested' também usa apenas IDs opacos
//     no payload (conforme LGPD §8.5 — ver events/types.ts ChatwootHandoffRequestedData).
//
// Catálogo de razões (doc 06 §7.4, §4.4):
//   - cliente_solicitou_atendente: lead pediu explicitamente falar com humano.
//   - consultar_andamento:         lead quer saber status do pedido (humano resolve).
//   - cobranca:                    lead com intenção de cobrança.
//   - reclamacao:                  lead com reclamação (humano resolve).
//   - nao_entendeu:                IA não entendeu após 3 tentativas.
//   - fora_de_escopo:              pergunta fora do escopo do agente.
//   - ai_unavailable:              fallback: IA indisponível ou timeout (F3-S34).
//   - loop_detected:               IA detectou loop de conversa.
//   - tool_error:                  falha irrecuperável em tool call.
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Catálogo de razões de handoff (doc 06 §7.4)
// ---------------------------------------------------------------------------

const handoffReasonSchema = z.enum(
  [
    'cliente_solicitou_atendente',
    'consultar_andamento',
    'cobranca',
    'reclamacao',
    'nao_entendeu',
    'fora_de_escopo',
    'ai_unavailable',
    'loop_detected',
    'tool_error',
  ],
  {
    errorMap: () => ({
      message:
        'reason deve ser um dos valores: cliente_solicitou_atendente, consultar_andamento, ' +
        'cobranca, reclamacao, nao_entendeu, fora_de_escopo, ai_unavailable, loop_detected, tool_error',
    }),
  },
);

export type HandoffReason = z.infer<typeof handoffReasonSchema>;

// ---------------------------------------------------------------------------
// Body do request
// ---------------------------------------------------------------------------

/**
 * Payload de handoff enviado pela tool `request_handoff` (F3-S17) ou pelo
 * fallback F3-S34. Todos os campos são IDs opacos exceto reason, summary.
 *
 * LGPD: summary pode conter texto livre com dados do atendimento.
 *   - Não é retornado na resposta (dado interno apenas).
 *   - Deve ser coberto por pino.redact antes de qualquer log externo.
 *   - É armazenado como nota interna no Chatwoot (dado interno de atendimento).
 */
export const InternalHandoffBodySchema = z.object({
  /**
   * UUID do lead a ser transferido.
   * Obrigatório — identifica o lead no kanban e no Chatwoot.
   * LGPD: UUID opaco — não é PII diretamente.
   */
  leadId: z.string({ required_error: 'leadId é obrigatório' }).uuid('leadId deve ser UUID'),

  /**
   * ID numérico da conversa no Chatwoot.
   * Usado para atualizar assignee, custom attributes e nota interna.
   * LGPD: ID técnico de sistema — não é PII.
   */
  conversationId: z.coerce
    .number({ required_error: 'conversationId é obrigatório' })
    .int('conversationId deve ser inteiro')
    .positive('conversationId deve ser positivo'),

  /**
   * Razão do handoff. Catálogo fechado — ver handoffReasonSchema acima.
   * ai_unavailable é usado pelo fallback F3-S34.
   */
  reason: handoffReasonSchema,

  /**
   * Resumo gerado pela IA ou pelo sistema para o agente humano.
   * Texto livre em markdown — pode conter nome, cidade, valor da simulação, etc.
   *
   * LGPD: dado interno de atendimento. Não retornado na resposta.
   *   Criado como nota interna no Chatwoot (não visível ao cliente).
   *   Coberto por pino.redact.
   */
  summary: z
    .string({ required_error: 'summary é obrigatório' })
    .min(1, 'summary não pode ser vazio')
    .max(4_000, 'summary não pode exceder 4.000 caracteres'),

  /**
   * UUID da organização. Obrigatório — não há JWT para derivar.
   * LGPD: UUID opaco — não é PII.
   */
  organizationId: z
    .string({ required_error: 'organizationId é obrigatório' })
    .uuid('organizationId deve ser UUID'),

  /**
   * UUID da última simulação realizada, se houver.
   * null = handoff sem simulação prévia (ex: cliente pediu atendente no início).
   * LGPD: UUID opaco — não é PII.
   */
  simulationId: z.string().uuid('simulationId deve ser UUID').nullable().optional(),
});

export type InternalHandoffBody = z.infer<typeof InternalHandoffBodySchema>;

// ---------------------------------------------------------------------------
// Response (conforme doc 06 §7.4)
// ---------------------------------------------------------------------------

/**
 * Resposta do handoff conforme especificado em doc 06 §7.4.
 *
 * LGPD: retorna apenas IDs opacos. Nenhuma PII (nome, telefone, summary)
 * é incluída na resposta — a IA já possui esses dados e não precisa recebê-los.
 */
export const InternalHandoffResponseSchema = z.object({
  /**
   * UUID do registro do handoff.
   * Serve como chave de referência para F3-S34 (fallback) e logs.
   */
  handoff_id: z.string().uuid(),

  /**
   * ID numérico da conversa no Chatwoot (ecoa o input para confirmação).
   * String para compatibilidade com callers que usam string na serialização.
   */
  chatwoot_conversation_id: z.string(),

  /**
   * UUID do agente atribuído no Chatwoot após o handoff.
   * null = Chatwoot não atribuiu automaticamente (sem agentes disponíveis).
   * LGPD: UUID interno — não expõe dados pessoais do agente.
   */
  assigned_agent_id: z.string().uuid().nullable(),

  /** Status do handoff após criação. Sempre 'requested' na resposta imediata. */
  status: z.literal('requested'),
});

export type InternalHandoffResponse = z.infer<typeof InternalHandoffResponseSchema>;
