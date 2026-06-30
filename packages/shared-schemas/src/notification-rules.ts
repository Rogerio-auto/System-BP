// =============================================================================
// notification-rules.ts — Catálogo fechado de gatilhos de notificação e schemas
// Zod de regras compartilhados entre frontend e backend (F24-S04).
//
// O TRIGGER_CATALOG é a fonte da verdade: o Admin escolhe de um dropdown fechado;
// não há chave livre. Cada entrada declara key, kind, category, entityType,
// placeholders e (para stage_inactivity) timestampSource.
//
// Slots que consomem este arquivo: F24-S05 (DB), F24-S06 (API routes),
// F24-S07 (frontend forms).
//
// LGPD: os placeholders expostos nos templates são IDs opacos e metadados
// operacionais — sem PII bruta (sem CPF, telefone, nome de cidadão).
//
// Reconciliação de contrato (F24-S05 security-review):
//   B-07 — `name` e `cooldown_hours` adicionados.
//   B-08 — `city_scope` mantido na API; mapping ↔ filters jsonb feito no service.
//   recipient_role → recipient_roles (array, espelha text[] do DB).
//   enabled: default false (espelha DB — regras nascem desligadas).
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * Categoria funcional do gatilho de notificação.
 *
 * lifecycle_stalled = paralisação no funil (inatividade em stage/simulação/análise).
 * assignment        = atribuição de conversa ou tarefa.
 * credit            = ciclo de crédito (simulação, análise de status).
 * billing           = cobrança (parcela enviada, inadimplência).
 * handoff           = transferência de conversa IA → humano.
 * system            = eventos sistêmicos (tarefa criada, encaminhamento advocacia, contrato).
 */
export const notificationCategorySchema = z.enum(
  ['lifecycle_stalled', 'assignment', 'credit', 'billing', 'handoff', 'system'],
  { errorMap: () => ({ message: 'category inválida' }) },
);
export type NotificationCategory = z.infer<typeof notificationCategorySchema>;

/**
 * Tipo de gatilho.
 *
 * event            = evento de domínio pontual (emitido pelo outbox).
 * stage_inactivity = eixo de inatividade medido por tempo decorrido;
 *                    requer threshold_hours na regra.
 */
export const triggerKindSchema = z.enum(['event', 'stage_inactivity'], {
  errorMap: () => ({ message: 'trigger_kind inválido' }),
});
export type TriggerKind = z.infer<typeof triggerKindSchema>;

/**
 * Modo de resolução dos destinatários.
 *
 * by_role_city = todos os usuários com papel + cidade correspondentes ao evento.
 * assignee     = agente atribuído à conversa/lead no momento do evento.
 * managers     = gestores da cidade relevante.
 */
export const recipientModeSchema = z.enum(['by_role_city', 'assignee', 'managers'], {
  errorMap: () => ({ message: 'recipient_mode inválido' }),
});
export type RecipientMode = z.infer<typeof recipientModeSchema>;

/**
 * Severidade da notificação.
 * Controla ênfase visual no sino e SLA de resposta esperado.
 */
export const notificationSeveritySchema = z.enum(['info', 'warning', 'critical'], {
  errorMap: () => ({ message: 'severity inválida' }),
});
export type NotificationSeverity = z.infer<typeof notificationSeveritySchema>;

/**
 * Canal de entrega de notificação de regra.
 * Subconjunto de NotificationChannelSchema — WhatsApp não é canal de regra
 * (é canal de lead; comunicação via WhatsApp segue templates aprovados pela Meta).
 */
export const ruleChannelSchema = z.enum(['in_app', 'email'], {
  errorMap: () => ({ message: 'channel inválido — use in_app ou email' }),
});
export type RuleChannel = z.infer<typeof ruleChannelSchema>;

// ---------------------------------------------------------------------------
// Catalog entry types
// ---------------------------------------------------------------------------

/** Entrada de catálogo para gatilho de evento de domínio pontual. */
export interface EventTriggerEntry {
  /** Chave canônica do gatilho. Coincide com event_name do outbox. */
  readonly key: string;
  readonly kind: 'event';
  readonly category: NotificationCategory;
  /** Tipo da entidade principal envolvida (ex: 'simulation', 'contract'). */
  readonly entityType: string;
  /**
   * Placeholders disponíveis para templates deste gatilho.
   * Derivados dos campos do payload do evento em events/types.ts.
   * NUNCA incluem PII bruta (sem CPF, telefone, nome de cidadão).
   */
  readonly placeholders: readonly string[];
}

/** Entrada de catálogo para eixo de inatividade medido por tempo decorrido. */
export interface InactivityTriggerEntry {
  /** Chave canônica do eixo de inatividade. */
  readonly key: string;
  readonly kind: 'stage_inactivity';
  readonly category: NotificationCategory;
  readonly entityType: string;
  readonly placeholders: readonly string[];
  /**
   * Referência lógica ao campo que marca o início da inatividade.
   * Formato: '<tabela>.<coluna>' (ex: 'kanban_cards.stage_changed_at').
   * Usado pelo worker de scanning para calcular horas decorridas.
   */
  readonly timestampSource: string;
}

export type TriggerCatalogEntry = EventTriggerEntry | InactivityTriggerEntry;

// ---------------------------------------------------------------------------
// TRIGGER_CATALOG — fonte da verdade compartilhada front × API
// ---------------------------------------------------------------------------

/**
 * Catálogo fechado de gatilhos de notificação.
 *
 * Eventos: derivados de `AppEventDataMap` em apps/api/src/events/types.ts.
 * Inatividade: eixos de paralisação medidos por tempo decorrido (threshold_hours).
 *
 * Os placeholders declarados por gatilho definem o conjunto MÁXIMO disponível
 * para templates. O frontend valida placeholders usados contra este catálogo
 * antes de salvar; o backend re-valida na borda (superRefine nos schemas abaixo).
 *
 * LGPD §8.5: nenhum placeholder expõe PII bruta — apenas IDs opacos e
 * metadados operacionais. O worker que processa a regra hidrata dados via
 * /internal/... com o escopo correto.
 */
export const TRIGGER_CATALOG = [
  // ─── Eventos de domínio ────────────────────────────────────────────────────

  /**
   * Simulação de crédito gerada (pelo agente, IA ou API).
   * Evento: simulations.generated (SimulationsGeneratedData).
   */
  {
    key: 'simulations.generated',
    kind: 'event',
    category: 'credit',
    entityType: 'simulation',
    placeholders: [
      'simulation_id',
      'lead_id',
      'product_id',
      'amount',
      'term_months',
      'monthly_payment',
    ],
  },

  /**
   * Status da análise de crédito alterado (pendente → aprovado, etc.).
   * Evento: credit_analysis.status_changed (CreditAnalysisStatusChangedData).
   */
  {
    key: 'credit_analysis.status_changed',
    kind: 'event',
    category: 'credit',
    entityType: 'credit_analysis',
    placeholders: ['analysis_id', 'lead_id', 'from_status', 'to_status'],
  },

  /**
   * Solicitação de handoff (IA pedindo transferência para humano).
   * Evento: chatwoot.handoff_requested (ChatwootHandoffRequestedData).
   */
  {
    key: 'chatwoot.handoff_requested',
    kind: 'event',
    category: 'handoff',
    entityType: 'conversation',
    placeholders: ['lead_id', 'chatwoot_conversation_id', 'reason'],
  },

  /**
   * Contrato assinado pelo cliente.
   * Evento: contract.signed (ContractSignedData).
   */
  {
    key: 'contract.signed',
    kind: 'event',
    category: 'system',
    entityType: 'contract',
    placeholders: ['contract_id', 'customer_id', 'signed_at'],
  },

  /**
   * Contrato com ≤2 parcelas restantes (gatilho de renovação/winback).
   * Evento: contract.near_end (ContractNearEndData).
   */
  {
    key: 'contract.near_end',
    kind: 'event',
    category: 'system',
    entityType: 'contract',
    placeholders: ['contract_id', 'customer_id', 'installments_remaining'],
  },

  /**
   * Cliente com 15+ dias de atraso (SPC scan).
   * Evento: payment_due.overdue_15d (PaymentDueOverdue15dData).
   */
  {
    key: 'payment_due.overdue_15d',
    kind: 'event',
    category: 'billing',
    entityType: 'payment_due',
    placeholders: ['customer_id', 'city_id', 'task_id', 'overdue_count'],
  },

  /**
   * Mensagem de cobrança enviada com sucesso ao cliente (collection-sender worker).
   * Evento: billing.collection_sent (CollectionSentData).
   */
  {
    key: 'billing.collection_sent',
    kind: 'event',
    category: 'billing',
    entityType: 'billing',
    placeholders: ['collection_job_id', 'payment_due_id', 'template_key', 'attempt_count'],
  },

  /**
   * Nova tarefa criada (ex: spc_inclusion, spc_removal, winback).
   * Evento: task.created (TaskCreatedData).
   */
  {
    key: 'task.created',
    kind: 'event',
    category: 'system',
    entityType: 'task',
    placeholders: ['task_id', 'assignee_role', 'type', 'city_id', 'entity_type', 'entity_id'],
  },

  /**
   * Cliente encaminhado a escritório de advocacia.
   * Evento: customer.law_firm_referred (CustomerLawFirmReferredData).
   */
  {
    key: 'customer.law_firm_referred',
    kind: 'event',
    category: 'system',
    entityType: 'customer',
    placeholders: ['referral_id', 'customer_id', 'law_firm_id', 'channel', 'sent_at'],
  },

  // ─── Eixos de inatividade ─────────────────────────────────────────────────
  // Todos requerem threshold_hours na regra. O placeholder hours_stalled contém
  // o tempo real decorrido no momento da notificação (calculado pelo worker).

  /**
   * Lead parado em qualquer stage do kanban além do threshold.
   * O asterisco (*) indica que o stage específico é parametrizado pela regra.
   */
  {
    key: 'kanban_stage:*',
    kind: 'stage_inactivity',
    category: 'lifecycle_stalled',
    entityType: 'kanban_card',
    placeholders: ['lead_id', 'card_id', 'stage_name', 'hours_stalled'],
    timestampSource: 'kanban_cards.stage_changed_at',
  },

  /**
   * Handoff solicitado e não aceito pelo humano além do threshold.
   */
  {
    key: 'handoff:requested',
    kind: 'stage_inactivity',
    category: 'handoff',
    entityType: 'conversation',
    placeholders: ['lead_id', 'chatwoot_conversation_id', 'hours_stalled'],
    timestampSource: 'chatwoot_handoffs.created_at',
  },

  /**
   * Simulação enviada ao cliente sem resposta além do threshold.
   */
  {
    key: 'simulation:sent_no_reply',
    kind: 'stage_inactivity',
    category: 'lifecycle_stalled',
    entityType: 'simulation',
    placeholders: ['lead_id', 'simulation_id', 'hours_stalled'],
    timestampSource: 'simulations.sent_at',
  },

  /**
   * Análise de crédito com status 'pendente' além do threshold.
   */
  {
    key: 'analysis:pendente',
    kind: 'stage_inactivity',
    category: 'lifecycle_stalled',
    entityType: 'credit_analysis',
    placeholders: ['analysis_id', 'lead_id', 'hours_stalled'],
    timestampSource: 'credit_analyses.created_at',
  },

  /**
   * Contrato em draft sem assinar além do threshold.
   */
  {
    key: 'contract:draft_unsigned',
    kind: 'stage_inactivity',
    category: 'lifecycle_stalled',
    entityType: 'contract',
    placeholders: ['contract_id', 'customer_id', 'hours_stalled'],
    timestampSource: 'contracts.created_at',
  },

  /**
   * Parcela vencida e não paga além do threshold (inadimplência ativa).
   */
  {
    key: 'payment_due:overdue',
    kind: 'stage_inactivity',
    category: 'billing',
    entityType: 'payment_due',
    placeholders: ['payment_due_id', 'customer_id', 'hours_stalled'],
    timestampSource: 'payment_dues.due_date',
  },

  /**
   * Conversa aberta sem resposta do agente além do threshold.
   */
  {
    key: 'conversation:no_reply',
    kind: 'stage_inactivity',
    category: 'lifecycle_stalled',
    entityType: 'conversation',
    placeholders: ['lead_id', 'chatwoot_conversation_id', 'hours_stalled'],
    timestampSource: 'conversations.last_message_at',
  },
] as const satisfies ReadonlyArray<TriggerCatalogEntry>;

/** Union de todas as chaves de gatilho válidas no catálogo. */
export type TriggerKey = (typeof TRIGGER_CATALOG)[number]['key'];

// ---------------------------------------------------------------------------
// Helpers (module-private)
// ---------------------------------------------------------------------------

/** Encontra uma entrada no catálogo pelo key exato. */
function findTrigger(key: string): TriggerCatalogEntry | undefined {
  return TRIGGER_CATALOG.find((e) => e.key === key);
}

/**
 * Extrai tokens {{placeholder}} de uma string de template.
 * Trata m[1] como string | undefined (noUncheckedIndexedAccess).
 */
function extractPlaceholders(template: string): string[] {
  return [...template.matchAll(/\{\{(\w+)\}\}/g)].flatMap((m) => {
    const group = m[1];
    return group !== undefined ? [group] : [];
  });
}

/**
 * Valida que todos os placeholders usados em title e body existem na lista
 * de placeholders permitidos do gatilho. Adiciona issues ao ctx do superRefine.
 */
function validateTemplatePlaceholders(
  ctx: z.RefinementCtx,
  triggerKey: string,
  allowed: ReadonlySet<string>,
  titleTemplate: string,
  bodyTemplate: string,
): void {
  const used = [...extractPlaceholders(titleTemplate), ...extractPlaceholders(bodyTemplate)];
  for (const ph of used) {
    if (!allowed.has(ph)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `placeholder '{{${ph}}}' não é permitido para o gatilho '${triggerKey}'. Permitidos: ${[...allowed].join(', ')}`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Schemas Zod de regras de notificação
// ---------------------------------------------------------------------------

/**
 * Schema de criação de regra de notificação.
 *
 * Reconciliação B-07: `name` e `cooldown_hours` adicionados.
 * Reconciliação: `recipient_roles` (array) espelha `recipient_roles text[]` do DB.
 * Reconciliação: `enabled` default false — regras nascem desligadas (DB default).
 *
 * Validações cruzadas (superRefine):
 * 1. trigger_key deve existir no TRIGGER_CATALOG.
 * 2. threshold_hours obrigatório quando trigger_kind=stage_inactivity.
 * 3. recipient_roles não-vazio quando recipient_mode=by_role_city.
 * 4. Placeholders usados nos templates ⊆ placeholders permitidos do gatilho.
 */
export const notificationRuleCreateSchema = z
  .object({
    /**
     * Nome descritivo da regra para exibição na UI de configuração.
     * Ex: "Alerta de inatividade no kanban — Qualificação".
     */
    name: z.string().min(1).max(200).describe('Nome descritivo da regra (exibido na listagem)'),

    /** Chave do gatilho — deve existir no TRIGGER_CATALOG. */
    trigger_key: z
      .string()
      .min(1)
      .describe('Chave canônica do gatilho (ex: simulations.generated)'),

    /** Como resolver os destinatários da notificação. */
    recipient_mode: recipientModeSchema,

    /**
     * Role keys dos destinatários (array).
     * Obrigatório (não-vazio) quando recipient_mode=by_role_city.
     * Ex: ['agente', 'gestor_regional'].
     * Espelha recipient_roles text[] do DB.
     */
    recipient_roles: z
      .array(z.string().min(1))
      .optional()
      .describe('Role keys (obrigatório e não-vazio se recipient_mode=by_role_city)'),

    /** Severidade visual e de SLA da notificação. */
    severity: notificationSeveritySchema,

    /** Canais de entrega ativos para esta regra. Mínimo 1. */
    channels: z.array(ruleChannelSchema).min(1).describe('Canais de entrega (mínimo 1)'),

    /**
     * Template do título da notificação.
     * Suporta {{placeholder}} com os valores declarados no catálogo do gatilho.
     */
    title_template: z
      .string()
      .min(1)
      .max(200)
      .describe('Template do título. Aceita {{placeholder}} do catálogo do gatilho'),

    /**
     * Template do corpo da notificação.
     * Suporta {{placeholder}} com os valores declarados no catálogo do gatilho.
     */
    body_template: z
      .string()
      .min(1)
      .max(1000)
      .describe('Template do corpo. Aceita {{placeholder}} do catálogo do gatilho'),

    /**
     * Horas de inatividade antes de disparar.
     * Obrigatório quando trigger_kind=stage_inactivity.
     * Ignorado para trigger_kind=event.
     */
    threshold_hours: z
      .number()
      .positive()
      .optional()
      .describe('Horas de inatividade (obrigatório para stage_inactivity)'),

    /**
     * Horas mínimas entre disparos para a mesma entidade (cooldown).
     * 0 = sem cooldown (default). >0: o worker verifica notification_rule_deliveries.
     * Espelha cooldown_hours int DEFAULT 0 do DB (B-07).
     */
    cooldown_hours: z
      .number()
      .int()
      .min(0)
      .optional()
      .default(0)
      .describe('Horas de cooldown entre disparos para a mesma entidade (0 = sem cooldown)'),

    /**
     * true = regra ativa e será avaliada pelo worker.
     * false (default) = regra cadastrada mas INATIVA — espelha DB default false.
     */
    enabled: z.boolean().default(false),

    /**
     * UUIDs das cidades às quais a regra se aplica.
     * Omitido ou vazio = todas as cidades da organização.
     * Persiste em filters jsonb como { city_scope: [...] } (B-08).
     */
    city_scope: z
      .array(z.string().uuid())
      .optional()
      .describe('UUIDs de cidades (omitido = todas). Persiste em filters jsonb.'),
  })
  .superRefine((data, ctx) => {
    const trigger = findTrigger(data.trigger_key);

    // 1. trigger_key deve existir no catálogo
    if (trigger === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['trigger_key'],
        message: `trigger_key '${data.trigger_key}' não existe no TRIGGER_CATALOG`,
      });
      return;
    }

    // 2. threshold_hours obrigatório para stage_inactivity
    if (trigger.kind === 'stage_inactivity' && data.threshold_hours === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['threshold_hours'],
        message: 'threshold_hours é obrigatório para gatilhos do tipo stage_inactivity',
      });
    }

    // 3. recipient_roles não-vazio quando by_role_city
    if (
      data.recipient_mode === 'by_role_city' &&
      (data.recipient_roles === undefined || data.recipient_roles.length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recipient_roles'],
        message: 'recipient_roles deve ser um array não-vazio quando recipient_mode=by_role_city',
      });
    }

    // 4. Placeholders usados ⊆ permitidos pelo gatilho
    validateTemplatePlaceholders(
      ctx,
      data.trigger_key,
      new Set(trigger.placeholders),
      data.title_template,
      data.body_template,
    );
  });

export type NotificationRuleCreate = z.infer<typeof notificationRuleCreateSchema>;

/**
 * Schema de atualização parcial de regra de notificação.
 *
 * Todos os campos são opcionais. Quando trigger_key está presente no payload,
 * as validações cruzadas (threshold_hours, placeholders) são re-avaliadas.
 *
 * B-06: Quando title_template/body_template vêm sem trigger_key, o service
 * busca o trigger_key atual da regra no DB e re-valida os placeholders.
 * Essa validação async não pode ser feita aqui (superRefine é síncrono).
 */
export const notificationRuleUpdateSchema = z
  .object({
    /** Nome descritivo (atualização). */
    name: z.string().min(1).max(200).optional(),
    /** Nova chave de gatilho. Deve existir no TRIGGER_CATALOG se fornecida. */
    trigger_key: z.string().min(1).optional(),
    recipient_mode: recipientModeSchema.optional(),
    /** Role keys dos destinatários (atualização). */
    recipient_roles: z.array(z.string().min(1)).optional(),
    severity: notificationSeveritySchema.optional(),
    channels: z.array(ruleChannelSchema).min(1).optional(),
    title_template: z.string().min(1).max(200).optional(),
    body_template: z.string().min(1).max(1000).optional(),
    threshold_hours: z.number().positive().optional(),
    /** Cooldown em horas (atualização). */
    cooldown_hours: z.number().int().min(0).optional(),
    enabled: z.boolean().optional(),
    city_scope: z.array(z.string().uuid()).optional(),
  })
  .superRefine((data, ctx) => {
    // Validações cruzadas só quando trigger_key está explicitamente no payload
    if (data.trigger_key !== undefined) {
      const trigger = findTrigger(data.trigger_key);

      if (trigger === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['trigger_key'],
          message: `trigger_key '${data.trigger_key}' não existe no TRIGGER_CATALOG`,
        });
        return;
      }

      // Se o novo gatilho é stage_inactivity, threshold_hours deve estar no update
      if (trigger.kind === 'stage_inactivity' && data.threshold_hours === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['threshold_hours'],
          message: 'threshold_hours é obrigatório ao alterar para gatilho do tipo stage_inactivity',
        });
      }

      // Validar placeholders nos templates fornecidos
      const allowed = new Set(trigger.placeholders);
      const title = data.title_template ?? '';
      const body = data.body_template ?? '';
      if (title.length > 0 || body.length > 0) {
        validateTemplatePlaceholders(ctx, data.trigger_key, allowed, title, body);
      }
    }

    // recipient_roles não-vazio quando alterando para by_role_city
    if (
      data.recipient_mode === 'by_role_city' &&
      (data.recipient_roles === undefined || data.recipient_roles.length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recipient_roles'],
        message: 'recipient_roles deve ser um array não-vazio quando recipient_mode=by_role_city',
      });
    }
  });

export type NotificationRuleUpdate = z.infer<typeof notificationRuleUpdateSchema>;

/**
 * Schema de resposta de uma regra de notificação (GET /notification-rules/:id).
 *
 * Campos como trigger_kind, category e entity_type são denormalizados pelo
 * service a partir do TRIGGER_CATALOG no momento da leitura — sem necessidade
 * de persistência redundante no DB.
 *
 * Reconciliação B-07: `name` e `cooldown_hours` adicionados.
 * Reconciliação: `recipient_roles` (array) espelha text[] do DB.
 * Reconciliação B-08: `city_scope` derivado de filters jsonb no service.
 */
export const notificationRuleResponseSchema = z.object({
  /** UUID primário da regra. */
  id: z.string().uuid(),

  /** Organização dona da regra (multi-tenant). */
  organization_id: z.string().uuid(),

  /** Nome descritivo da regra. */
  name: z.string(),

  /** Chave canônica do gatilho. */
  trigger_key: z.string(),

  /** Tipo do gatilho — denormalizado do catálogo. */
  trigger_kind: triggerKindSchema,

  /** Categoria funcional — denormalizada do catálogo. */
  category: notificationCategorySchema,

  /** Tipo da entidade principal — denormalizado do catálogo. */
  entity_type: z.string(),

  recipient_mode: recipientModeSchema,

  /**
   * Role keys dos destinatários.
   * Array vazio quando recipient_mode ≠ by_role_city.
   * Espelha recipient_roles text[] do DB.
   */
  recipient_roles: z.array(z.string()),

  severity: notificationSeveritySchema,

  channels: z.array(ruleChannelSchema).min(1),

  title_template: z.string(),
  body_template: z.string(),

  /**
   * null quando trigger_kind=event (sem limiar de inatividade).
   */
  threshold_hours: z.number().positive().nullable(),

  /**
   * Horas de cooldown entre disparos para a mesma entidade.
   * 0 = sem cooldown.
   */
  cooldown_hours: z.number().int().min(0),

  enabled: z.boolean(),

  /**
   * null = aplica-se a todas as cidades da organização.
   * Derivado de filters->>'city_scope' no service (B-08).
   */
  city_scope: z.array(z.string().uuid()).nullable(),

  /** UUID do usuário que criou a regra. null = criada pelo sistema. */
  created_by: z.string().uuid().nullable(),

  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

export type NotificationRuleResponse = z.infer<typeof notificationRuleResponseSchema>;

/**
 * Schema de resposta paginada de listagem de regras (GET /notification-rules).
 */
export const notificationRuleListResponseSchema = z.object({
  data: z.array(notificationRuleResponseSchema),

  /** Total de regras que atendem ao filtro (para paginação). */
  total: z.number().int().nonnegative(),

  page: z.number().int().nonnegative(),
  per_page: z.number().int().nonnegative(),
});

export type NotificationRuleListResponse = z.infer<typeof notificationRuleListResponseSchema>;

/**
 * Schema de resposta do endpoint de teste de regra
 * (POST /notification-rules/:id/test).
 *
 * Exibe um preview de quem receberia a notificação e como o template seria
 * renderizado com dados de exemplo (sem PII de cidadão).
 *
 * display_name é dado de colaborador (não PII de cidadão) — aceitável para
 * visualização interna por gestores (Art. 7°, IX LGPD).
 */
export const notificationRuleTestResponseSchema = z.object({
  /** UUID da regra testada. */
  rule_id: z.string().uuid(),

  /** Número de usuários que receberiam a notificação no estado atual. */
  recipient_count: z.number().int().nonnegative(),

  /**
   * Amostra de até 5 destinatários para preview.
   * display_name = nome de trabalho do agente (dado de colaborador, não PII de cidadão).
   */
  recipients_preview: z
    .array(
      z.object({
        user_id: z.string().uuid(),
        display_name: z.string(),
        channels: z.array(ruleChannelSchema),
      }),
    )
    .max(5),

  /** Título renderizado com dados de exemplo (sem PII). */
  rendered_title: z.string(),

  /** Corpo renderizado com dados de exemplo (sem PII). */
  rendered_body: z.string(),

  /** Timestamp do teste. */
  tested_at: z.string().datetime({ offset: true }),
});

export type NotificationRuleTestResponse = z.infer<typeof notificationRuleTestResponseSchema>;

// ---------------------------------------------------------------------------
// Re-export findTrigger para uso no backend (service layer)
// ---------------------------------------------------------------------------

/**
 * Encontra uma entrada no catálogo pelo key exato.
 * Exportado para uso no service layer (derivar category + validar placeholders).
 */
export function lookupTrigger(key: string): TriggerCatalogEntry | undefined {
  return TRIGGER_CATALOG.find((e) => e.key === key);
}

/**
 * Extrai tokens {{placeholder}} de uma string de template.
 * Exportado para uso no service layer (B-06: validação de placeholders no update).
 */
export function extractTemplatePlaceholders(template: string): string[] {
  return [...template.matchAll(/\{\{(\w+)\}\}/g)].flatMap((m) => {
    const group = m[1];
    return group !== undefined ? [group] : [];
  });
}
