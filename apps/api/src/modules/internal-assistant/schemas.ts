// =============================================================================
// modules/internal-assistant/schemas.ts — Zod schemas para o copiloto interno
// público (F6-S08).
//
// Endpoint: POST /api/internal-assistant/query
// Acesso: jwt autenticado + permissão ai_assistant:use + flag ai.internal_assistant.enabled
//
// Design (doc 22 §12.4/§12.5):
//   - Pergunta passa por DLP antes de qualquer persistência.
//   - Principal derivado do JWT — nunca do corpo da requisição.
//   - Resposta inclui answer + sources[] para rastreabilidade.
//
// LGPD (doc 17 §14.2):
//   - question_redacted: pergunta com DLP aplicado antes de persistir.
//   - tools_called / city_scope_snapshot: apenas IDs de entidades e agregados.
//   - Sem CPF, telefone, nome completo bruto em logs ou DB.
//
// Histórico de sessão (F6-S17):
//   - `history` é memória de sessão pura do cliente -- nunca persistido no
//     backend (nem em assistant_queries) e nunca logado (pode conter PII de
//     respostas anteriores). Repassado ao LangGraph para dar continuidade
//     conversacional; a DLP do gateway (F6-S18) redige antes do LLM.
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

/**
 * Um turno do histórico de conversa enviado pelo cliente (memória de sessão).
 * Nunca persistido, nunca logado.
 */
export const AssistantHistoryTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(4000),
});

export type AssistantHistoryTurn = z.infer<typeof AssistantHistoryTurnSchema>;

/**
 * Corpo do POST /api/internal-assistant/query.
 * `question` + `history` opcional (máx 10 turnos ~ 5 idas-e-voltas) --
 * principal é derivado do JWT pelo controller.
 */
export const AssistantQueryBodySchema = z.object({
  /** Pergunta do usuário. Max 2000 chars — limite alinhado ao grafo Python. */
  question: z.string().min(1).max(2000),
  /**
   * Histórico dos turnos anteriores da sessão, mais antigo primeiro.
   * Opcional e retrocompatível -- chamadas sem history seguem funcionando.
   * `.max(10)` é o contrato público do endpoint (rejeitado com 400 pela
   * validação Zod da rota se excedido). O service.ts também trunca
   * defensivamente para os últimos 10 antes de montar o payload do
   * LangGraph -- linha de defesa extra para qualquer chamador do
   * service que não passe pela validação HTTP da rota.
   */
  history: z.array(AssistantHistoryTurnSchema).max(10).optional(),
});

export type AssistantQueryBody = z.infer<typeof AssistantQueryBodySchema>;

// ---------------------------------------------------------------------------
// Payload interno para o LangGraph service
// ---------------------------------------------------------------------------

/**
 * Principal injetado pelo backend a partir do JWT.
 * Nunca lido do corpo da requisição (doc 22 §12.2).
 */
export const PrincipalSchema = z.object({
  user_id: z.string().uuid(),
  organization_id: z.string().uuid(),
  permissions: z.array(z.string().min(1)).min(1),
  /** null = global; [] = sem cidade; [...] = cidades filtradas */
  city_scope_ids: z.array(z.string().uuid()).nullable(),
});

export type Principal = z.infer<typeof PrincipalSchema>;

/**
 * Payload enviado ao LangGraph service (POST /process/assistant/query).
 */
export const LangGraphAssistantRequestSchema = z.object({
  principal: PrincipalSchema,
  question: z.string().min(1).max(2000),
  /** Já truncado para os últimos 10 turnos pelo service antes do envio. */
  history: z.array(AssistantHistoryTurnSchema).max(10).optional(),
  correlation_id: z.string().nullable().optional(),
});

export type LangGraphAssistantRequest = z.infer<typeof LangGraphAssistantRequestSchema>;

// ---------------------------------------------------------------------------
// Response do LangGraph service
// ---------------------------------------------------------------------------

export const LangGraphAssistantResponseSchema = z.object({
  answer: z.string(),
  sources: z.array(z.string()).default([]),
  tools_called: z.array(z.record(z.unknown())).default([]),
  metadata: z.record(z.unknown()).default({}),
  error: z.string().nullable().default(null),
});

export type LangGraphAssistantResponse = z.infer<typeof LangGraphAssistantResponseSchema>;

// ---------------------------------------------------------------------------
// Response pública (para o frontend)
// ---------------------------------------------------------------------------

/**
 * Resposta do POST /api/internal-assistant/query.
 */
export const AssistantQueryResponseSchema = z.object({
  answer: z.string().describe('Resposta gerada pelo copiloto'),
  sources: z.array(z.string()).describe('Fontes de dados consultadas'),
});

export type AssistantQueryResponse = z.infer<typeof AssistantQueryResponseSchema>;
