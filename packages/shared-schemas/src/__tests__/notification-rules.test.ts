import { describe, it, expect } from 'vitest';

import {
  TRIGGER_CATALOG,
  notificationCategorySchema,
  triggerKindSchema,
  recipientModeSchema,
  notificationSeveritySchema,
  ruleChannelSchema,
  notificationRuleCreateSchema,
  notificationRuleUpdateSchema,
  notificationRuleResponseSchema,
  notificationRuleListResponseSchema,
  notificationRuleTestResponseSchema,
} from '../notification-rules.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const RULE_ID = '00000000-0000-0000-0000-000000000002';
const USER_ID = '00000000-0000-0000-0000-000000000003';

const BASE_CREATE = {
  trigger_key: 'simulations.generated',
  recipient_mode: 'by_role_city',
  recipient_role: 'agente',
  severity: 'info',
  channels: ['in_app'],
  title_template: 'Nova simulação gerada',
  body_template: 'Simulação {{simulation_id}} criada para o lead {{lead_id}}.',
} as const;

const ISO_NOW = '2026-06-30T12:00:00.000Z';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

describe('notificationCategorySchema', () => {
  it('aceita todas as categorias válidas', () => {
    for (const cat of [
      'lifecycle_stalled',
      'assignment',
      'credit',
      'billing',
      'handoff',
      'system',
    ] as const) {
      expect(notificationCategorySchema.parse(cat)).toBe(cat);
    }
  });
  it('rejeita categoria desconhecida', () => {
    expect(() => notificationCategorySchema.parse('unknown')).toThrow();
  });
});

describe('triggerKindSchema', () => {
  it('aceita event e stage_inactivity', () => {
    expect(triggerKindSchema.parse('event')).toBe('event');
    expect(triggerKindSchema.parse('stage_inactivity')).toBe('stage_inactivity');
  });
  it('rejeita kind inválido', () => {
    expect(() => triggerKindSchema.parse('webhook')).toThrow();
  });
});

describe('recipientModeSchema', () => {
  it('aceita todos os modos', () => {
    for (const mode of ['by_role_city', 'assignee', 'managers'] as const) {
      expect(recipientModeSchema.parse(mode)).toBe(mode);
    }
  });
  it('rejeita modo inválido', () => {
    expect(() => recipientModeSchema.parse('all_users')).toThrow();
  });
});

describe('notificationSeveritySchema', () => {
  it('aceita info, warning e critical', () => {
    for (const sev of ['info', 'warning', 'critical'] as const) {
      expect(notificationSeveritySchema.parse(sev)).toBe(sev);
    }
  });
  it('rejeita severity inválida', () => {
    expect(() => notificationSeveritySchema.parse('low')).toThrow();
  });
});

describe('ruleChannelSchema', () => {
  it('aceita in_app e email', () => {
    expect(ruleChannelSchema.parse('in_app')).toBe('in_app');
    expect(ruleChannelSchema.parse('email')).toBe('email');
  });
  it('rejeita whatsapp (não é canal de regra)', () => {
    expect(() => ruleChannelSchema.parse('whatsapp')).toThrow();
  });
  it('rejeita channel desconhecido', () => {
    expect(() => ruleChannelSchema.parse('sms')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// TRIGGER_CATALOG
// ---------------------------------------------------------------------------

describe('TRIGGER_CATALOG', () => {
  it('contém exatamente 16 entradas', () => {
    expect(TRIGGER_CATALOG).toHaveLength(16);
  });

  it('todas as chaves são únicas', () => {
    const keys = TRIGGER_CATALOG.map((e) => e.key);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });

  it('contém os 9 eventos de domínio esperados', () => {
    const eventKeys = TRIGGER_CATALOG.filter((e) => e.kind === 'event').map((e) => e.key);
    expect(eventKeys).toContain('simulations.generated');
    expect(eventKeys).toContain('credit_analysis.status_changed');
    expect(eventKeys).toContain('chatwoot.handoff_requested');
    expect(eventKeys).toContain('contract.signed');
    expect(eventKeys).toContain('contract.near_end');
    expect(eventKeys).toContain('payment_due.overdue_15d');
    expect(eventKeys).toContain('billing.collection_sent');
    expect(eventKeys).toContain('task.created');
    expect(eventKeys).toContain('customer.law_firm_referred');
    expect(eventKeys).toHaveLength(9);
  });

  it('contém os 7 eixos de inatividade esperados', () => {
    const inactivityKeys = TRIGGER_CATALOG.filter((e) => e.kind === 'stage_inactivity').map(
      (e) => e.key,
    );
    expect(inactivityKeys).toContain('kanban_stage:*');
    expect(inactivityKeys).toContain('handoff:requested');
    expect(inactivityKeys).toContain('simulation:sent_no_reply');
    expect(inactivityKeys).toContain('analysis:pendente');
    expect(inactivityKeys).toContain('contract:draft_unsigned');
    expect(inactivityKeys).toContain('payment_due:overdue');
    expect(inactivityKeys).toContain('conversation:no_reply');
    expect(inactivityKeys).toHaveLength(7);
  });

  it('todas as entradas stage_inactivity têm timestampSource', () => {
    const inactivityEntries = TRIGGER_CATALOG.filter((e) => e.kind === 'stage_inactivity');
    for (const entry of inactivityEntries) {
      expect(entry).toHaveProperty('timestampSource');
      // Narrowing para InactivityTriggerEntry
      if (entry.kind === 'stage_inactivity') {
        expect(typeof entry.timestampSource).toBe('string');
        expect(entry.timestampSource.length).toBeGreaterThan(0);
      }
    }
  });

  it('nenhuma entrada event tem timestampSource', () => {
    const eventEntries = TRIGGER_CATALOG.filter((e) => e.kind === 'event');
    for (const entry of eventEntries) {
      expect(entry).not.toHaveProperty('timestampSource');
    }
  });

  it('todas as entradas têm placeholders não-vazios', () => {
    for (const entry of TRIGGER_CATALOG) {
      expect(entry.placeholders.length).toBeGreaterThan(0);
    }
  });

  it('categorias usadas são válidas', () => {
    for (const entry of TRIGGER_CATALOG) {
      expect(() => notificationCategorySchema.parse(entry.category)).not.toThrow();
    }
  });

  it('simulations.generated tem os placeholders corretos', () => {
    const entry = TRIGGER_CATALOG.find((e) => e.key === 'simulations.generated');
    expect(entry).toBeDefined();
    expect(entry?.placeholders).toContain('simulation_id');
    expect(entry?.placeholders).toContain('lead_id');
    expect(entry?.placeholders).toContain('amount');
    expect(entry?.placeholders).toContain('term_months');
    expect(entry?.placeholders).toContain('monthly_payment');
  });

  it('kanban_stage:* tem hours_stalled nos placeholders', () => {
    const entry = TRIGGER_CATALOG.find((e) => e.key === 'kanban_stage:*');
    expect(entry?.placeholders).toContain('hours_stalled');
    expect(entry?.placeholders).toContain('stage_name');
  });
});

// ---------------------------------------------------------------------------
// notificationRuleCreateSchema
// ---------------------------------------------------------------------------

describe('notificationRuleCreateSchema — casos válidos', () => {
  it('aceita regra de evento completa e válida', () => {
    const result = notificationRuleCreateSchema.parse(BASE_CREATE);
    expect(result.trigger_key).toBe('simulations.generated');
    expect(result.enabled).toBe(true); // default
  });

  it('aceita regra com trigger de inatividade + threshold_hours', () => {
    const result = notificationRuleCreateSchema.parse({
      trigger_key: 'kanban_stage:*',
      recipient_mode: 'assignee',
      severity: 'warning',
      channels: ['in_app', 'email'],
      title_template: 'Lead parado em {{stage_name}}',
      body_template: 'Card {{card_id}} sem movimentação há {{hours_stalled}}h. Lead: {{lead_id}}.',
      threshold_hours: 48,
      enabled: true,
    });
    expect(result.threshold_hours).toBe(48);
  });

  it('aceita regra com recipient_mode=managers (sem recipient_role)', () => {
    const result = notificationRuleCreateSchema.parse({
      ...BASE_CREATE,
      recipient_mode: 'managers',
      recipient_role: undefined,
    });
    expect(result.recipient_mode).toBe('managers');
    expect(result.recipient_role).toBeUndefined();
  });

  it('aceita regra com recipient_mode=assignee (sem recipient_role)', () => {
    const result = notificationRuleCreateSchema.parse({
      ...BASE_CREATE,
      recipient_mode: 'assignee',
      recipient_role: undefined,
    });
    expect(result.recipient_mode).toBe('assignee');
  });

  it('aceita template sem placeholders', () => {
    const result = notificationRuleCreateSchema.parse({
      ...BASE_CREATE,
      title_template: 'Notificação genérica',
      body_template: 'Ocorreu um evento relevante.',
    });
    expect(result.title_template).toBe('Notificação genérica');
  });

  it('aceita city_scope com UUIDs válidos', () => {
    const result = notificationRuleCreateSchema.parse({
      ...BASE_CREATE,
      city_scope: [ORG_ID, RULE_ID],
    });
    expect(result.city_scope).toHaveLength(2);
  });

  it('aplica default enabled=true quando omitido', () => {
    const result = notificationRuleCreateSchema.parse({
      trigger_key: 'task.created',
      recipient_mode: 'managers',
      severity: 'critical',
      channels: ['email'],
      title_template: 'Nova tarefa: {{type}}',
      body_template: 'Tarefa {{task_id}} criada para role {{assignee_role}} na cidade {{city_id}}.',
    });
    expect(result.enabled).toBe(true);
  });

  it('aceita handoff:requested com threshold_hours', () => {
    const result = notificationRuleCreateSchema.parse({
      trigger_key: 'handoff:requested',
      recipient_mode: 'managers',
      severity: 'critical',
      channels: ['in_app', 'email'],
      title_template: 'Handoff sem aceite',
      body_template: 'Conversa {{chatwoot_conversation_id}} aguardando {{hours_stalled}}h.',
      threshold_hours: 2,
    });
    expect(result.threshold_hours).toBe(2);
  });
});

describe('notificationRuleCreateSchema — validação: trigger_key', () => {
  it('rejeita trigger_key ausente do catálogo', () => {
    expect(() =>
      notificationRuleCreateSchema.parse({
        ...BASE_CREATE,
        trigger_key: 'evento.inexistente',
      }),
    ).toThrow(/TRIGGER_CATALOG/);
  });

  it('rejeita trigger_key vazio', () => {
    expect(() =>
      notificationRuleCreateSchema.parse({
        ...BASE_CREATE,
        trigger_key: '',
      }),
    ).toThrow();
  });
});

describe('notificationRuleCreateSchema — validação: threshold_hours', () => {
  it('rejeita stage_inactivity sem threshold_hours', () => {
    expect(() =>
      notificationRuleCreateSchema.parse({
        ...BASE_CREATE,
        trigger_key: 'kanban_stage:*',
        title_template: 'Lead parado',
        body_template: 'Card {{card_id}} parado em {{stage_name}}.',
        // threshold_hours ausente
      }),
    ).toThrow(/threshold_hours/);
  });

  it('rejeita threshold_hours negativo', () => {
    expect(() =>
      notificationRuleCreateSchema.parse({
        ...BASE_CREATE,
        trigger_key: 'kanban_stage:*',
        title_template: 'Parado',
        body_template: 'Card {{card_id}} em {{stage_name}} há {{hours_stalled}}h.',
        threshold_hours: -5,
      }),
    ).toThrow();
  });

  it('rejeita threshold_hours zero', () => {
    expect(() =>
      notificationRuleCreateSchema.parse({
        ...BASE_CREATE,
        trigger_key: 'analysis:pendente',
        title_template: 'Análise pendente',
        body_template: 'Análise {{analysis_id}} aguardando há {{hours_stalled}}h.',
        threshold_hours: 0,
      }),
    ).toThrow();
  });
});

describe('notificationRuleCreateSchema — validação: recipient_role', () => {
  it('rejeita by_role_city sem recipient_role', () => {
    expect(() =>
      notificationRuleCreateSchema.parse({
        ...BASE_CREATE,
        recipient_mode: 'by_role_city',
        recipient_role: undefined,
      }),
    ).toThrow(/recipient_role/);
  });

  it('rejeita recipient_role vazio', () => {
    expect(() =>
      notificationRuleCreateSchema.parse({
        ...BASE_CREATE,
        recipient_mode: 'by_role_city',
        recipient_role: '',
      }),
    ).toThrow();
  });
});

describe('notificationRuleCreateSchema — validação: placeholders', () => {
  it('rejeita placeholder não permitido no title_template', () => {
    expect(() =>
      notificationRuleCreateSchema.parse({
        ...BASE_CREATE,
        title_template: 'Simulação para {{cpf}}',
        body_template: 'Lead {{lead_id}}.',
      }),
    ).toThrow(/placeholder.*cpf/);
  });

  it('rejeita placeholder não permitido no body_template', () => {
    expect(() =>
      notificationRuleCreateSchema.parse({
        ...BASE_CREATE,
        title_template: 'Nova simulação',
        body_template: 'Valor: {{amount}} — contrato: {{contract_id}}.',
      }),
    ).toThrow(/placeholder.*contract_id/);
  });

  it('aceita todos os placeholders declarados pelo gatilho', () => {
    expect(() =>
      notificationRuleCreateSchema.parse({
        trigger_key: 'credit_analysis.status_changed',
        recipient_mode: 'assignee',
        severity: 'warning',
        channels: ['in_app'],
        title_template: 'Análise {{analysis_id}} mudou',
        body_template: 'Lead {{lead_id}}: status alterado de {{from_status}} para {{to_status}}.',
      }),
    ).not.toThrow();
  });

  it('rejeita channels vazio', () => {
    expect(() =>
      notificationRuleCreateSchema.parse({
        ...BASE_CREATE,
        channels: [],
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// notificationRuleUpdateSchema
// ---------------------------------------------------------------------------

describe('notificationRuleUpdateSchema — casos válidos', () => {
  it('aceita patch parcial só com enabled', () => {
    const result = notificationRuleUpdateSchema.parse({ enabled: false });
    expect(result.enabled).toBe(false);
  });

  it('aceita patch com novo body_template sem trigger_key', () => {
    const result = notificationRuleUpdateSchema.parse({
      body_template: 'Novo corpo da mensagem.',
    });
    expect(result.body_template).toBe('Novo corpo da mensagem.');
  });

  it('aceita patch com trigger_key + threshold_hours válidos', () => {
    const result = notificationRuleUpdateSchema.parse({
      trigger_key: 'conversation:no_reply',
      threshold_hours: 24,
      title_template: 'Conversa sem resposta',
      body_template: 'Conversa {{chatwoot_conversation_id}} sem resposta há {{hours_stalled}}h.',
    });
    expect(result.trigger_key).toBe('conversation:no_reply');
    expect(result.threshold_hours).toBe(24);
  });

  it('aceita patch vazio (nenhum campo)', () => {
    const result = notificationRuleUpdateSchema.parse({});
    expect(result).toEqual({});
  });
});

describe('notificationRuleUpdateSchema — validação', () => {
  it('rejeita trigger_key inválido no update', () => {
    expect(() => notificationRuleUpdateSchema.parse({ trigger_key: 'chave.inexistente' })).toThrow(
      /TRIGGER_CATALOG/,
    );
  });

  it('rejeita stage_inactivity sem threshold_hours no update', () => {
    expect(() =>
      notificationRuleUpdateSchema.parse({
        trigger_key: 'payment_due:overdue',
        title_template: 'Parcela vencida',
        body_template: 'Parcela {{payment_due_id}} vencida há {{hours_stalled}}h.',
        // threshold_hours ausente
      }),
    ).toThrow(/threshold_hours/);
  });

  it('rejeita placeholder inválido no update quando trigger_key fornecido', () => {
    expect(() =>
      notificationRuleUpdateSchema.parse({
        trigger_key: 'contract.signed',
        title_template: 'Contrato assinado',
        body_template: 'Contrato {{contract_id}} assinado. Lead: {{lead_id}}.',
      }),
    ).toThrow(/placeholder.*lead_id/);
  });

  it('rejeita by_role_city sem recipient_role no update', () => {
    expect(() =>
      notificationRuleUpdateSchema.parse({
        recipient_mode: 'by_role_city',
        // recipient_role ausente
      }),
    ).toThrow(/recipient_role/);
  });
});

// ---------------------------------------------------------------------------
// notificationRuleResponseSchema
// ---------------------------------------------------------------------------

describe('notificationRuleResponseSchema', () => {
  const BASE_RESPONSE = {
    id: RULE_ID,
    organization_id: ORG_ID,
    trigger_key: 'simulations.generated',
    trigger_kind: 'event',
    category: 'credit',
    entity_type: 'simulation',
    recipient_mode: 'by_role_city',
    recipient_role: 'agente',
    severity: 'info',
    channels: ['in_app'],
    title_template: 'Nova simulação gerada',
    body_template: 'Simulação {{simulation_id}} criada.',
    threshold_hours: null,
    enabled: true,
    city_scope: null,
    created_by: USER_ID,
    created_at: ISO_NOW,
    updated_at: ISO_NOW,
  };

  it('aceita response válida', () => {
    const result = notificationRuleResponseSchema.parse(BASE_RESPONSE);
    expect(result.id).toBe(RULE_ID);
    expect(result.trigger_kind).toBe('event');
    expect(result.threshold_hours).toBeNull();
    expect(result.city_scope).toBeNull();
    expect(result.recipient_role).toBe('agente');
  });

  it('aceita response com threshold_hours e city_scope preenchidos', () => {
    const result = notificationRuleResponseSchema.parse({
      ...BASE_RESPONSE,
      trigger_key: 'kanban_stage:*',
      trigger_kind: 'stage_inactivity',
      category: 'lifecycle_stalled',
      entity_type: 'kanban_card',
      threshold_hours: 48,
      city_scope: [ORG_ID],
      recipient_role: null,
    });
    expect(result.threshold_hours).toBe(48);
    expect(result.city_scope).toHaveLength(1);
  });

  it('rejeita response sem id', () => {
    const { id: _, ...rest } = BASE_RESPONSE;
    expect(() => notificationRuleResponseSchema.parse(rest)).toThrow();
  });

  it('rejeita id não-UUID', () => {
    expect(() =>
      notificationRuleResponseSchema.parse({ ...BASE_RESPONSE, id: 'nao-uuid' }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// notificationRuleListResponseSchema
// ---------------------------------------------------------------------------

describe('notificationRuleListResponseSchema', () => {
  it('aceita lista vazia com paginação', () => {
    const result = notificationRuleListResponseSchema.parse({
      data: [],
      total: 0,
      page: 0,
      per_page: 20,
    });
    expect(result.data).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it('rejeita total negativo', () => {
    expect(() =>
      notificationRuleListResponseSchema.parse({
        data: [],
        total: -1,
        page: 0,
        per_page: 20,
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// notificationRuleTestResponseSchema
// ---------------------------------------------------------------------------

describe('notificationRuleTestResponseSchema', () => {
  it('aceita response de teste válida', () => {
    const result = notificationRuleTestResponseSchema.parse({
      rule_id: RULE_ID,
      recipient_count: 3,
      recipients_preview: [
        {
          user_id: USER_ID,
          display_name: 'Ana Agente',
          channels: ['in_app'],
        },
      ],
      rendered_title: 'Nova simulação gerada',
      rendered_body: 'Simulação [SIM-001] criada para o lead [LEAD-001].',
      tested_at: ISO_NOW,
    });
    expect(result.recipient_count).toBe(3);
    expect(result.recipients_preview).toHaveLength(1);
  });

  it('rejeita recipients_preview com mais de 5 itens', () => {
    const preview = Array.from({ length: 6 }, (_, i) => ({
      user_id: `00000000-0000-0000-0000-00000000000${i}`,
      display_name: `Agente ${i}`,
      channels: ['in_app' as const],
    }));
    expect(() =>
      notificationRuleTestResponseSchema.parse({
        rule_id: RULE_ID,
        recipient_count: 6,
        recipients_preview: preview,
        rendered_title: 'Título',
        rendered_body: 'Corpo.',
        tested_at: ISO_NOW,
      }),
    ).toThrow();
  });

  it('aceita recipients_preview vazio (0 destinatários)', () => {
    const result = notificationRuleTestResponseSchema.parse({
      rule_id: RULE_ID,
      recipient_count: 0,
      recipients_preview: [],
      rendered_title: 'Título',
      rendered_body: 'Corpo.',
      tested_at: ISO_NOW,
    });
    expect(result.recipient_count).toBe(0);
    expect(result.recipients_preview).toHaveLength(0);
  });

  it('rejeita tested_at sem offset de timezone', () => {
    expect(() =>
      notificationRuleTestResponseSchema.parse({
        rule_id: RULE_ID,
        recipient_count: 0,
        recipients_preview: [],
        rendered_title: 'T',
        rendered_body: 'B',
        tested_at: '2026-06-30T12:00:00', // sem offset
      }),
    ).toThrow();
  });
});
