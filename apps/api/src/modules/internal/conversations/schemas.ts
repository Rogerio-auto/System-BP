// =============================================================================
// internal/conversations/schemas.ts — Schemas Zod para
// GET /internal/conversations/:id/state e PUT /internal/conversations/:id/state.
//
// Canal M2M: consumido pelas tools `get_conversation_state` e `save_conversation_state`
// do serviço LangGraph (doc 06 §5.2).
// Autenticação via X-Internal-Token — sem JWT.
//
// LGPD (doc 17 §8.4, §8.12):
//   - `state` jsonb NÃO deve conter CPF, RG ou document_number brutos.
//     A política de DLP é aplicada pelo serviço Python ANTES de chamar este endpoint.
//     O backend persiste o snapshot como recebido — responsabilidade de sanitização
//     é do produtor (LangGraph). Comentário aqui serve como contrato de interface.
//   - `phone` é PII de contato — coberto por pino.redact em app.ts.
//     Não exposto na resposta do GET (retornamos apenas IDs + state opaco).
//   - Resposta do GET retorna state jsonb opaco — o LangGraph é o único consumidor,
//     e os dados já foram sanitizados na escrita.
//
// Upsert (PUT):
//   - Idempotente por `conversation_id` (UNIQUE constraint na DB).
//   - LangGraph pode chamar PUT múltiplas vezes para o mesmo conversation_id
//     (ex: restart após falha) — o último estado vence.
//   - `updated_at` atualizado automaticamente pelo Drizzle via `new Date()`.
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Parâmetros de path
// ---------------------------------------------------------------------------

export const ConversationIdParamSchema = z.object({
  /**
   * UUID da conversa (conversation_id na tabela ai_conversation_states).
   * Gerado pelo backend no momento de criação da conversa (F3-S06).
   */
  id: z.string().uuid('id deve ser UUID válido'),
});

export type ConversationIdParam = z.infer<typeof ConversationIdParamSchema>;

// ---------------------------------------------------------------------------
// GET /internal/conversations/:id/state — Response
// ---------------------------------------------------------------------------

/**
 * Resposta do GET state.
 *
 * LGPD: `phone` não é incluído na resposta — PII necessária apenas para
 * roteamento interno (doc 17 §8.12 minimização). O LangGraph já possui o phone
 * via payload de entrada e não precisa recebê-lo de volta.
 * `state` é um snapshot opaco — sanitizado pelo LangGraph antes da escrita.
 */
export const ConversationStateResponseSchema = z.object({
  /** UUID do registro na tabela ai_conversation_states. */
  id: z.string().uuid(),

  /** UUID da organização (multi-tenant). */
  organization_id: z.string().uuid(),

  /** UUID da conversa — chave de lookup idempotente. */
  conversation_id: z.string().uuid(),

  /**
   * ID da conversa no Chatwoot (string opaca — pode ser numérico serializado).
   * null = ainda não sincronizado com o Chatwoot.
   */
  chatwoot_conversation_id: z.string().nullable(),

  /**
   * UUID do lead identificado nesta conversa.
   * null = lead ainda não criado (primeiro contato).
   * LGPD: ID opaco — não é PII.
   */
  lead_id: z.string().uuid().nullable(),

  /**
   * UUID do customer (lead identificado com CPF).
   * null = ainda não convertido em customer.
   * LGPD: ID opaco — não é PII.
   */
  customer_id: z.string().uuid().nullable(),

  /**
   * Nome do nó LangGraph onde a conversa está pausada.
   * null = conversa recém-criada, ainda não processou nenhum nó.
   */
  current_node: z.string().nullable(),

  /**
   * Versão SemVer do grafo que gerou este estado (ex: "v1.0.0").
   * null = versão não registrada (conversas legadas).
   */
  graph_version: z.string().nullable(),

  /**
   * Snapshot serializado do ConversationState (TypedDict Python).
   * Conteúdo opaco — o LangGraph serializa e desserializa.
   * LGPD: DLP aplicado pelo produtor antes de persistir. Sem CPF/RG brutos.
   */
  state: z.record(z.unknown()),

  /**
   * Momento da última mensagem recebida.
   * null = conversa recém-criada.
   */
  last_message_at: z.string().datetime({ offset: true }).nullable(),

  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

export type ConversationStateResponse = z.infer<typeof ConversationStateResponseSchema>;

// ---------------------------------------------------------------------------
// PUT /internal/conversations/:id/state — Body
// ---------------------------------------------------------------------------

/**
 * Body do upsert de estado.
 *
 * `organization_id` é obrigatório: o token interno não carrega contexto de org
 * (consistente com /internal/leads e /internal/simulations).
 *
 * `phone` é obrigatório mesmo no update: a constraint DB exige NOT NULL,
 * e o LangGraph sempre possui o phone desde o primeiro turno.
 * LGPD: PII de contato — coberto por pino.redact.
 *
 * Campos de FK (`lead_id`, `customer_id`) são opcionais: o LangGraph os
 * preenche à medida que identifica o lead e o customer durante o fluxo.
 */
export const UpsertConversationStateBodySchema = z.object({
  /**
   * UUID da organização.
   * Obrigatório — o token interno não carrega contexto de org.
   */
  organization_id: z
    .string({ required_error: 'organization_id é obrigatório' })
    .uuid('organization_id deve ser UUID'),

  /**
   * Telefone do interlocutor (apenas dígitos, ex: 5569912345678).
   * Obrigatório: necessário para roteamento e exibição antes de lead_id.
   * LGPD: PII de contato — não logar sem redact.
   */
  phone: z
    .string({ required_error: 'phone é obrigatório' })
    .min(10, 'phone deve ter ao menos 10 dígitos')
    .max(20, 'phone deve ter no máximo 20 dígitos')
    .regex(/^\d+$/, 'phone deve conter apenas dígitos'),

  /**
   * ID da conversa no Chatwoot.
   * null = ainda não sincronizado.
   */
  chatwoot_conversation_id: z.string().nullable().optional(),

  /**
   * UUID do lead identificado nesta conversa.
   * null = lead ainda não criado.
   */
  lead_id: z.string().uuid('lead_id deve ser UUID').nullable().optional(),

  /**
   * UUID do customer.
   * null = lead não convertido em customer.
   */
  customer_id: z.string().uuid('customer_id deve ser UUID').nullable().optional(),

  /**
   * Nome do nó LangGraph atual (ex: "classify_intent").
   */
  current_node: z.string().max(255).nullable().optional(),

  /**
   * Versão SemVer do grafo (ex: "v1.0.0").
   */
  graph_version: z.string().max(50).nullable().optional(),

  /**
   * Snapshot serializado do ConversationState.
   * LGPD CRÍTICO: DLP obrigatório antes de chamar este endpoint.
   * Sem CPF, RG, document_number em texto puro. Apenas IDs internos.
   */
  state: z.record(z.unknown()).optional().default({}),

  /**
   * Momento da última mensagem recebida.
   * ISO 8601 com timezone.
   */
  last_message_at: z.string().datetime({ offset: true }).nullable().optional(),
});

export type UpsertConversationStateBody = z.infer<typeof UpsertConversationStateBodySchema>;

// ---------------------------------------------------------------------------
// PUT /internal/conversations/:id/state — Response
// ---------------------------------------------------------------------------

/**
 * Resposta do upsert.
 * Retorna o registro completo após criação ou atualização.
 * Mesmo shape da resposta do GET para consistência de interface.
 */
export const UpsertConversationStateResponseSchema = ConversationStateResponseSchema.extend({
  /** true = registro criado agora; false = registro existente atualizado. */
  created: z.boolean(),
});

export type UpsertConversationStateResponse = z.infer<typeof UpsertConversationStateResponseSchema>;
