// =============================================================================
// internal/leads/schemas.ts — Schemas Zod para POST /internal/leads/get-or-create.
//
// Canal M2M: consumido pela tool `get_or_create_lead` (F3-S13, LangGraph).
// Não usa JWT — autenticação via X-Internal-Token.
//
// LGPD (doc 17 §8.1, §3.4):
//   - phone e name são PII. Cobertos por pino.redact em app.ts.
//   - A resposta retorna apenas IDs opacos (lead_id, city_id, assigned_agent_id).
//   - Nenhuma PII do lead é retornada — conforme doc 06 §7.1.
//   - chatwoot_conversation_id e correlation_id são IDs opacos (não PII).
//
// Erros tipados:
//   - INVALID_PHONE: telefone não reconhecido como E.164 válido.
//   - LEAD_MERGE_REQUIRED: >1 candidato com mesmo telefone (requer ação humana).
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Body do request
// ---------------------------------------------------------------------------

/**
 * Telefone E.164 com validação mínima de formato.
 * Validação semântica (DDD válido, operadora) é feita na service layer
 * para poder retornar o erro tipado INVALID_PHONE.
 */
const phoneSchema = z
  .string({ required_error: 'phone é obrigatório' })
  .regex(/^\+\d{10,15}$/, 'phone deve estar no formato E.164 (ex: +5569999999999)');

/** Canais de origem reconhecidos pelo endpoint interno. */
const internalLeadSourceSchema = z.enum(['whatsapp', 'chatwoot', 'api'], {
  errorMap: () => ({ message: 'source deve ser whatsapp, chatwoot ou api' }),
});

export const InternalGetOrCreateLeadBodySchema = z.object({
  /**
   * UUID da organização. Obrigatório — não há JWT para derivar.
   * Consistente com /internal/simulations que também exige organizationId no body.
   * LGPD: UUID opaco — não é PII.
   */
  organization_id: z
    .string({ required_error: 'organization_id é obrigatório' })
    .uuid('organization_id deve ser UUID'),

  /**
   * Telefone do lead no formato E.164.
   * LGPD: PII — canal de comunicação principal.
   */
  phone: phoneSchema,

  /**
   * Nome do lead (opcional na primeira mensagem — pode ser desconhecido).
   * LGPD: PII — identificação direta da pessoa.
   */
  name: z.string().min(1).max(255).optional(),

  /**
   * Canal de origem da conversa.
   * Limitado a canais internos (whatsapp, chatwoot, api).
   * 'manual' e 'import' não fazem sentido para este endpoint.
   */
  source: internalLeadSourceSchema,

  /**
   * ID da conversa no Chatwoot (opaco).
   * Armazenado em metadata do lead para rastreabilidade.
   * LGPD: não é PII — é um ID técnico de sistema.
   */
  chatwoot_conversation_id: z.string().optional(),

  /**
   * UUID de correlação gerado pela IA para rastreamento distribuído.
   * Permite correlacionar logs entre LangGraph e backend.
   * LGPD: ID opaco — não é PII.
   */
  correlation_id: z.string().uuid('correlation_id deve ser UUID').optional(),

  /**
   * UUID da cidade do lead.
   *
   * Opcional conforme doc 06 §7.1 (input não inclui city_id).
   * Porém, a criação de novo lead requer city_id (leads.city_id NOT NULL no schema atual).
   * Tech debt F3-S04: migration 23+ tornará nullable. Enquanto isso, quando ausente
   * e lead não existe, a service layer retorna 422 com detalhe claro.
   * Quando lead já existe, city_id é ignorado no lookup (usa o valor armazenado).
   *
   * LGPD: UUID opaco — não é PII.
   */
  city_id: z.string().uuid('city_id deve ser UUID').optional(),
});

export type InternalGetOrCreateLeadBody = z.infer<typeof InternalGetOrCreateLeadBodySchema>;

// ---------------------------------------------------------------------------
// Response — conforme doc 06 §7.1
// ---------------------------------------------------------------------------

/**
 * Resposta de get-or-create conforme especificado em doc 06 §7.1.
 *
 * LGPD: retorna apenas IDs opacos. Nenhuma PII (nome, telefone, email) é
 * incluída na resposta — a IA já possui esses dados via payload de entrada
 * e não precisa recebê-los de volta.
 */
export const InternalGetOrCreateLeadResponseSchema = z.object({
  /** UUID do lead encontrado ou criado. */
  lead_id: z.string().uuid(),

  /**
   * UUID do registro de customer (pessoa identificada com CPF).
   * NULL em F3 — a vinculação customer↔lead ocorre em F4 (análise de crédito).
   */
  customer_id: z.string().uuid().nullable(),

  /** true = lead foi criado agora; false = lead existente retornado. */
  created: z.boolean(),

  /**
   * Nome do stage atual no kanban (ex: "Pré-atendimento").
   * NULL se o lead não possui kanban card (situação transitória pós-criação).
   */
  current_stage: z.string().nullable(),

  /**
   * UUID da cidade do lead.
   * NULL quando desconhecida (comum no primeiro contato via WhatsApp).
   */
  city_id: z.string().uuid().nullable(),

  /**
   * UUID do agente atribuído ao lead.
   * NULL quando não atribuído.
   */
  assigned_agent_id: z.string().uuid().nullable(),
});

export type InternalGetOrCreateLeadResponse = z.infer<typeof InternalGetOrCreateLeadResponseSchema>;

// ---------------------------------------------------------------------------
// Respostas de erro tipadas (doc 06 §7.1)
// ---------------------------------------------------------------------------

export const InternalLeadErrorResponseSchema = z.object({
  error: z.enum(['INVALID_PHONE', 'LEAD_MERGE_REQUIRED', 'VALIDATION_ERROR', 'INTERNAL_ERROR']),
  message: z.string(),
  details: z.unknown().optional(),
});
