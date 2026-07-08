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
// Schemas para PATCH /internal/leads/:id (update_lead_profile — F3-S12)
// ---------------------------------------------------------------------------

/**
 * Params do PATCH /internal/leads/:id.
 */
export const InternalLeadParamsSchema = z.object({
  id: z.string().uuid('id deve ser UUID'),
});

export type InternalLeadParams = z.infer<typeof InternalLeadParamsSchema>;

/**
 * Body do PATCH /internal/leads/:id.
 *
 * Campos atualizáveis pela IA (tool update_lead_profile, F3-S22).
 * Campos sensíveis de negócio (status, source, agentId, cpf, email) são
 * deliberadamente EXCLUÍDOS — IA só pode atualizar perfil coletado na conversa.
 *
 * LGPD (doc 17 §8.1):
 *   - name é PII — coberto por pino.redact.
 *   - cityId, requestedAmount, requestedTermMonths são dados de crédito, não PII direta.
 *   - Resposta retorna IDs opacos e campos não-PII.
 *
 * Política de campos não permitidos:
 *   Qualquer campo fora deste schema retorna 422 VALIDATION_ERROR.
 *   Implementado via z.object().strict() — rejeita chaves desconhecidas.
 */
export const InternalUpdateLeadBodySchema = z
  .object({
    /**
     * UUID da organização. Obrigatório — não há JWT para derivar o contexto de org.
     * Consistente com /internal/leads/get-or-create.
     */
    organization_id: z
      .string({ required_error: 'organization_id é obrigatório' })
      .uuid('organization_id deve ser UUID'),

    /**
     * Nome atualizado do lead (coletado na conversa).
     * LGPD: PII — coberto por pino.redact.
     * Vazio não é aceito — min(1) garante que o nome não seja string vazia.
     */
    name: z.string().min(1, 'name não pode ser vazio').max(255).optional(),

    /**
     * UUID da cidade identificada na conversa.
     * LGPD: UUID opaco — não é PII.
     */
    city_id: z.string().uuid('city_id deve ser UUID').optional(),

    /**
     * Valor de crédito solicitado pelo lead (em reais, dois decimais).
     * Coletado pelo nó collect_missing_profile_data do grafo.
     * Armazenado em leads.metadata['requested_amount'] até promoção a coluna própria.
     */
    requested_amount: z
      .number({ invalid_type_error: 'requested_amount deve ser número' })
      .positive('requested_amount deve ser positivo')
      .optional(),

    /**
     * Prazo solicitado em meses (ex: 12, 24, 36, 48, 60).
     * Coletado pelo nó collect_missing_profile_data do grafo.
     * Armazenado em leads.metadata['requested_term_months'] até promoção a coluna própria.
     */
    requested_term_months: z
      .number({ invalid_type_error: 'requested_term_months deve ser inteiro' })
      .int('requested_term_months deve ser inteiro')
      .positive('requested_term_months deve ser positivo')
      .optional(),
  })
  .strict(); // rejeita chaves desconhecidas → 400 VALIDATION_ERROR

export type InternalUpdateLeadBody = z.infer<typeof InternalUpdateLeadBodySchema>;

/**
 * Resposta de PATCH /internal/leads/:id.
 *
 * LGPD: retorna apenas IDs opacos e campos não-PII.
 * name e phone não são incluídos — a IA já os conhece pelo estado da conversa.
 */
export const InternalUpdateLeadResponseSchema = z.object({
  /** UUID do lead atualizado. */
  lead_id: z.string().uuid(),

  /** UUID da cidade do lead (atualizado ou existente). */
  city_id: z.string().uuid().nullable(),

  /** UUID do agente atribuído (inalterado por este endpoint). */
  assigned_agent_id: z.string().uuid().nullable(),

  /** Nome do stage atual no kanban (inalterado por este endpoint). */
  current_stage: z.string().nullable(),
});

export type InternalUpdateLeadResponse = z.infer<typeof InternalUpdateLeadResponseSchema>;

// ---------------------------------------------------------------------------
// Respostas de erro tipadas (doc 06 §7.1)
// ---------------------------------------------------------------------------

export const InternalLeadErrorResponseSchema = z.object({
  error: z.enum(['INVALID_PHONE', 'LEAD_MERGE_REQUIRED', 'VALIDATION_ERROR', 'INTERNAL_ERROR']),
  message: z.string(),
  details: z.unknown().optional(),
});

// ---------------------------------------------------------------------------
// Schemas para POST /internal/leads/:id/qualify (F25-S03)
// ---------------------------------------------------------------------------

/**
 * Params do POST /internal/leads/:id/qualify.
 * LGPD: id é UUID opaco — não é PII.
 */
export const InternalQualifyLeadParamsSchema = z.object({
  id: z.string().uuid('id deve ser UUID'),
});

export type InternalQualifyLeadParams = z.infer<typeof InternalQualifyLeadParamsSchema>;

/**
 * Body do POST /internal/leads/:id/qualify.
 * organization_id obrigatório — não há JWT para derivar contexto de org.
 */
export const InternalQualifyLeadBodySchema = z.object({
  organization_id: z
    .string({ required_error: 'organization_id é obrigatório' })
    .uuid('organization_id deve ser UUID'),
});

export type InternalQualifyLeadBody = z.infer<typeof InternalQualifyLeadBodySchema>;

/**
 * Resposta de POST /internal/leads/:id/qualify.
 *
 * LGPD: retorna apenas IDs opacos e campos não-PII.
 * Idempotente: se lead já estava em qualifying+, retorna current_status sem erro.
 */
export const InternalQualifyLeadResponseSchema = z.object({
  /** UUID do lead qualificado. */
  lead_id: z.string().uuid(),
  /** Status anterior à qualificação (ex: 'new'). */
  previous_status: z.string(),
  /** Status após a qualificação (ex: 'qualifying'). No-op se já qualifying+. */
  current_status: z.string(),
  /** UUID do kanban card do lead, ou null se o card não existir. */
  card_id: z.string().uuid().nullable(),
  /** UUID do stage kanban atual do card, ou null. */
  stage_id: z.string().uuid().nullable(),
  /** Role canônica do stage atual (ex: 'pre_atendimento'), ou null. */
  canonical_role: z.string().nullable(),
});

export type InternalQualifyLeadResponse = z.infer<typeof InternalQualifyLeadResponseSchema>;
