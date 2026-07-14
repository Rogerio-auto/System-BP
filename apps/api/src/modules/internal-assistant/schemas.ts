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
//
// Contrato estruturado narrativa + blocos (F6-S21, acompanha o LangGraph F6-S20):
//   - `narrative`: comentário/estrutura da resposta SEM PII de cliente.
//   - `blocks`: dados de cliente da resposta, referenciados por entidade
//     (`ref`, persistível na Fase 2 do histórico -- docs/anexos/lgpd/
//     dpia-historico-copiloto.md) + `value` (efêmero, só para exibição
//     imediata -- descartado quando a persistência da Fase 2 existir).
//     `ref` e `value` são campos propositalmente distintos, nunca colapsados.
//   - Bloco com `type` desconhecido é tolerado (forward-compat): `type` NÃO é
//     um enum fechado -- um bloco novo do LangGraph nunca deve quebrar o
//     parse aqui.
//   - `answer`: RETROCOMPAT -- narrative + blocks já vêm renderizados em
//     texto plano pelo LangGraph. Mantido para não quebrar callers que ainda
//     leem só `answer` durante a transição (F6-S22 migra o frontend).
//   - `blocks[].value` NUNCA é logado (pode conter dado de cliente/PII).
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
// Blocos referenciados (F6-S21, forma acordada com o LangGraph F6-S20)
// ---------------------------------------------------------------------------

/**
 * Referência de entidade de um bloco -- o que será persistido na Fase 2 do
 * histórico (docs/anexos/lgpd/dpia-historico-copiloto.md). Sem PII: apenas
 * `kind` + o UUID da entidade.
 */
export const BlockRefSchema = z.object({
  kind: z.enum(['lead', 'none']).describe('Tipo de entidade referenciada pelo bloco'),
  lead_id: z
    .string()
    .uuid()
    .nullable()
    .describe("UUID do lead (presente apenas quando kind='lead')"),
});

export type BlockRef = z.infer<typeof BlockRefSchema>;

/**
 * Bloco de dado de cliente referenciado por entidade (F6-S20/F6-S21).
 *
 * `type` NÃO é um enum fechado de propósito -- um `type` novo/desconhecido
 * vindo do LangGraph deve ser tolerado (forward-compat), nunca rejeitado
 * pelo parse do Zod.
 *
 * `ref` (persistível, sem PII) e `value` (efêmero, dado hidratado para
 * exibição imediata -- descartado quando a Fase 2 persistir histórico) são
 * campos propositalmente distintos, nunca colapsados. `value` nunca deve ser
 * logado.
 */
export const BlockSchema = z.object({
  type: z.string().min(1).describe('Tipo do bloco (ex.: lead_summary, funnel_metrics)'),
  ref: BlockRefSchema,
  value: z.unknown().describe('Dado hidratado para exibição imediata (efêmero, nunca logar)'),
});

export type Block = z.infer<typeof BlockSchema>;

// ---------------------------------------------------------------------------
// Response do LangGraph service
// ---------------------------------------------------------------------------

export const LangGraphAssistantResponseSchema = z.object({
  narrative: z.string(),
  blocks: z.array(BlockSchema).default([]),
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
 *
 * `narrative` + `blocks` são a forma estruturada (F6-S21) repassada do
 * LangGraph (F6-S20) sem alteração. `answer` é derivado/legado -- mantido
 * durante a transição para não quebrar chamadas antigas que só leem `answer`
 * (o LangGraph já entrega `answer` pronto como narrative+blocks renderizados
 * em texto plano; o Node apenas repassa).
 */
export const AssistantQueryResponseSchema = z.object({
  narrative: z
    .string()
    .describe('Comentário/estrutura da resposta do copiloto, sem PII de cliente'),
  blocks: z.array(BlockSchema).describe('Dados de cliente da resposta, referenciados por entidade'),
  answer: z
    .string()
    .describe(
      '[Legado] narrative + blocks renderizados em texto plano -- mantido para compatibilidade retroativa',
    ),
  sources: z.array(z.string()).describe('Fontes de dados consultadas'),
});

export type AssistantQueryResponse = z.infer<typeof AssistantQueryResponseSchema>;
