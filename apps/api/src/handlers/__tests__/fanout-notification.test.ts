// =============================================================================
// fanout-notification.test.ts — Testes do handler F24-S06.
//
// Cenários cobertos:
//   1. Feature flag off → early return sem queries
//   2. Nenhuma regra ativa para o evento → no-op
//   3. Regra ativa, 1 destinatário → disparo in_app + delivery gravado
//   4. Idempotência: delivery já existente → pula sem despachar
//   5. Filtro city_scope: cidade do evento fora do scope → pula regra
//   6. Canal desabilitado por preferência → pula canal, despacha outros
//   7. Falha de canal isolada → delivery ainda gravado, outro canal continua
//   8. Destinatários vazios → delivery gravado (regra processada, sem destinatários)
//   9. Múltiplas regras → todas processadas independentemente
//  10. Falha de uma regra → não interrompe processamento das demais
// =============================================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock env (deve ser o primeiro mock — hoisting)
// ---------------------------------------------------------------------------
vi.mock('../../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    JWT_ACCESS_SECRET: 'a'.repeat(64),
    JWT_REFRESH_SECRET: 'b'.repeat(64),
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_TTL: '30d',
    API_HOST: '0.0.0.0',
    API_PORT: 3333,
    API_PUBLIC_URL: 'http://localhost:3333',
    CORS_ALLOWED_ORIGINS: ['http://localhost:5173'],
    LANGGRAPH_INTERNAL_TOKEN: 'a'.repeat(33),
    LANGGRAPH_SERVICE_URL: 'http://localhost:8000',
    WHATSAPP_APP_SECRET: 'test-whatsapp-secret-at-least-16ch',
    WHATSAPP_VERIFY_TOKEN: 'test-verify-token',
    FX_BRL_PER_USD: 5.75,
    LGPD_DEDUPE_PEPPER: 'a'.repeat(32),
    NOTIFICATIONS_EMAIL_ENABLED: false,
  },
}));

// ---------------------------------------------------------------------------
// Mock pg
// ---------------------------------------------------------------------------
vi.mock('pg', () => {
  const MockPool = vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  return { Pool: MockPool, default: { Pool: MockPool } };
});

// ---------------------------------------------------------------------------
// Mock drizzle-orm
// ---------------------------------------------------------------------------
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ __eq: val })),
  and: vi.fn((...args: unknown[]) => ({ __and: args })),
  or: vi.fn((...args: unknown[]) => ({ __or: args })),
  sql: Object.assign(
    vi.fn(() => ({})),
    { mapWith: vi.fn() },
  ),
  relations: vi.fn().mockReturnValue({}),
  asc: vi.fn().mockReturnValue({}),
  desc: vi.fn().mockReturnValue({}),
  count: vi.fn().mockReturnValue({}),
  inArray: vi.fn().mockReturnValue({}),
  isNull: vi.fn().mockReturnValue({}),
  isNotNull: vi.fn().mockReturnValue({}),
  ilike: vi.fn().mockReturnValue({}),
}));

vi.mock('drizzle-orm/node-postgres', () => ({
  drizzle: vi.fn().mockReturnValue({}),
}));

// ---------------------------------------------------------------------------
// Mock db/client
// ---------------------------------------------------------------------------
vi.mock('../../db/client.js', () => ({
  db: {},
  pool: {},
}));

// ---------------------------------------------------------------------------
// Mock featureFlags
// ---------------------------------------------------------------------------
const mockRequireFlag = vi.fn().mockResolvedValue(true);
vi.mock('../../lib/featureFlags.js', () => ({
  requireFlag: (...args: unknown[]) => mockRequireFlag(...args),
}));

// ---------------------------------------------------------------------------
// Mock recipients
// ---------------------------------------------------------------------------
const mockResolveRuleRecipients = vi.fn().mockResolvedValue([]);
vi.mock('../../modules/notification-rules/recipients.js', () => ({
  resolveRuleRecipients: (...args: unknown[]) => mockResolveRuleRecipients(...args),
}));

// ---------------------------------------------------------------------------
// Mock isCategoryChannelEnabled
// ---------------------------------------------------------------------------
const mockIsCategoryChannelEnabled = vi.fn().mockResolvedValue(true);
vi.mock('../../modules/notifications/repository.js', () => ({
  isCategoryChannelEnabled: (...args: unknown[]) => mockIsCategoryChannelEnabled(...args),
  createNotification: vi.fn().mockResolvedValue({ id: 'notif-uuid' }),
}));

// ---------------------------------------------------------------------------
// Mock senders
// ---------------------------------------------------------------------------
const mockSendInApp = vi.fn().mockResolvedValue(undefined);
vi.mock('../../modules/notifications/senders/inApp.js', () => ({
  sendInApp: (...args: unknown[]) => mockSendInApp(...args),
}));

const mockSendEmail = vi.fn().mockResolvedValue(undefined);
vi.mock('../../modules/notifications/senders/email.js', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

// ---------------------------------------------------------------------------
// Import da função sob teste (após todos os mocks)
// ---------------------------------------------------------------------------
import type { EventOutbox } from '../../db/schema/events.js';
import { handleFanoutNotification } from '../fanout-notification.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = 'org-uuid-1111-1111-1111-111111111111';
const RULE_ID = 'rule-uuid-2222-2222-2222-222222222222';
const AGGREGATE_ID = 'sim-uuid-3333-3333-3333-333333333333';
const OUTBOX_ID = 'outbox-uuid-4444-4444-4444-444444444444';
const USER_ID = 'user-uuid-5555-5555-5555-555555555555';
const CITY_ID = 'city-uuid-6666-6666-6666-666666666666';

const BASE_EVENT: EventOutbox = {
  id: OUTBOX_ID,
  organizationId: ORG_ID,
  eventName: 'simulations.generated',
  eventVersion: 1,
  aggregateType: 'simulation',
  aggregateId: AGGREGATE_ID,
  payload: {
    event_id: OUTBOX_ID,
    occurred_at: '2026-07-08T10:00:00Z',
    actor: { kind: 'system', id: null, ip: null },
    correlation_id: null,
    data: {
      simulation_id: AGGREGATE_ID,
      lead_id: 'lead-uuid-aaaa',
      product_id: 'prod-uuid-bbbb',
      amount: 5000,
      term_months: 12,
      monthly_payment: 450,
    },
  },
  correlationId: null,
  idempotencyKey: `simulations.generated:${AGGREGATE_ID}:1720432800000`,
  attempts: 0,
  lastError: null,
  processedAt: null,
  failedAt: null,
  createdAt: new Date('2026-07-08T10:00:00Z'),
};

const BASE_RULE = {
  id: RULE_ID,
  organizationId: ORG_ID,
  name: 'Simulação gerada',
  triggerKind: 'event' as const,
  triggerKey: 'simulations.generated',
  category: 'credit',
  thresholdHours: null,
  filters: {},
  recipientMode: 'managers' as const,
  recipientRoles: [] as string[],
  severity: 'info' as const,
  channels: ['in_app'],
  titleTemplate: 'Simulação {{simulation_id}} gerada',
  bodyTemplate: 'Lead {{lead_id}} recebeu simulação de {{amount}} em {{term_months}} meses.',
  cooldownHours: 0,
  enabled: true,
  createdBy: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

const BASE_RECIPIENT = {
  userId: USER_ID,
  organizationId: ORG_ID,
  displayName: 'Gestor Teste',
  channels: ['in_app'] as ('in_app' | 'email')[],
};

// ---------------------------------------------------------------------------
// Helper: makeDb — configura comportamento do mock de DB
// ---------------------------------------------------------------------------

interface MakeDbOptions {
  // severity ampliado para 'info'|'warning'|'critical' (F24-S19) — os testes
  // de severidade passam regras com severity diferente do default de BASE_RULE.
  rules?: (Omit<typeof BASE_RULE, 'severity'> & { severity: 'info' | 'warning' | 'critical' })[];
  hasDelivery?: boolean;
}

function makeDb(opts: MakeDbOptions = {}) {
  const rules = opts.rules ?? [];
  const deliveryRows = opts.hasDelivery === true ? [{ id: 'delivery-uuid' }] : [];

  const mockInsert = {
    values: vi.fn().mockReturnValue({
      onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
    }),
  };

  const mockSelectRules = {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(rules),
    }),
  };

  const mockSelectDelivery = {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(deliveryRows),
      }),
    }),
  };

  let selectCallCount = 0;

  return {
    select: vi.fn().mockImplementation(() => {
      selectCallCount++;
      // 1ª chamada select() = busca de regras
      // 2ª+ chamadas select() = verificação de delivery
      if (selectCallCount === 1) return mockSelectRules;
      return mockSelectDelivery;
    }),
    insert: vi.fn().mockReturnValue(mockInsert),
    _mockInsert: mockInsert,
    _selectCallCount: () => selectCallCount,
  };
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe('handleFanoutNotification()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireFlag.mockResolvedValue(true);
    mockResolveRuleRecipients.mockResolvedValue([BASE_RECIPIENT]);
    mockIsCategoryChannelEnabled.mockResolvedValue(true);
    mockSendInApp.mockResolvedValue(undefined);
    mockSendEmail.mockResolvedValue(undefined);
  });

  // ── 1. Feature flag off ───────────────────────────────────────────────────

  it('feature flag off → early return sem queries', async () => {
    mockRequireFlag.mockResolvedValue(false);
    const db = makeDb();

    await handleFanoutNotification(BASE_EVENT, db as never);

    expect(mockRequireFlag).toHaveBeenCalledWith(
      db,
      'notifications.rules.enabled',
      expect.anything(),
    );
    expect(db.select).not.toHaveBeenCalled();
    expect(mockSendInApp).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  // ── 2. Nenhuma regra ativa ────────────────────────────────────────────────

  it('nenhuma regra ativa → no-op (sem dispatch, sem delivery)', async () => {
    const db = makeDb({ rules: [] });

    await handleFanoutNotification(BASE_EVENT, db as never);

    expect(db.select).toHaveBeenCalledTimes(1);
    expect(mockResolveRuleRecipients).not.toHaveBeenCalled();
    expect(mockSendInApp).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  // ── 3. Regra ativa + destinatário → dispatch in_app + delivery ───────────

  it('regra ativa com destinatário → despacha in_app e grava delivery', async () => {
    const db = makeDb({ rules: [BASE_RULE], hasDelivery: false });

    await handleFanoutNotification(BASE_EVENT, db as never);

    // sendInApp chamado com dados corretos
    expect(mockSendInApp).toHaveBeenCalledTimes(1);
    expect(mockSendInApp).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        organizationId: ORG_ID,
        userId: USER_ID,
        entityType: 'simulation',
        entityId: AGGREGATE_ID,
      }),
    );

    // delivery gravado
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db._mockInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG_ID,
        ruleId: RULE_ID,
        entityType: 'simulation',
        entityId: AGGREGATE_ID,
        bucket: OUTBOX_ID, // bucket = event_id
      }),
    );
  });

  // ── 4. Idempotência: delivery já existe ───────────────────────────────────

  it('delivery já existente → pula sem despachar (idempotente)', async () => {
    const db = makeDb({ rules: [BASE_RULE], hasDelivery: true });

    await handleFanoutNotification(BASE_EVENT, db as never);

    // hasDelivery retorna true → pula o processamento da regra
    expect(mockResolveRuleRecipients).not.toHaveBeenCalled();
    expect(mockSendInApp).not.toHaveBeenCalled();
    // insert NÃO deve ser chamado (já existe delivery)
    expect(db.insert).not.toHaveBeenCalled();
  });

  // ── 5. Filtro city_scope — cidade fora do scope ────────────────────────────

  it('evento com cidade fora do city_scope da regra → pula regra', async () => {
    const ruleWithScope = {
      ...BASE_RULE,
      filters: { city_scope: ['other-city-uuid-0000-0000-0000-000000000000'] },
    };
    // Evento com city_id no payload
    const eventWithCity: EventOutbox = {
      ...BASE_EVENT,
      payload: {
        ...(BASE_EVENT.payload as object),
        data: {
          ...((BASE_EVENT.payload as Record<string, unknown>)['data'] as object),
          city_id: CITY_ID,
        },
      },
    };
    const db = makeDb({ rules: [ruleWithScope], hasDelivery: false });

    await handleFanoutNotification(eventWithCity, db as never);

    // Regra filtrada por cidade → sem dispatch, sem delivery
    expect(mockResolveRuleRecipients).not.toHaveBeenCalled();
    expect(mockSendInApp).not.toHaveBeenCalled();
  });

  // ── 6. Canal desabilitado por preferência ─────────────────────────────────

  it('canal in_app desabilitado por preferência → pula canal, sem dispatch', async () => {
    mockIsCategoryChannelEnabled.mockResolvedValue(false);
    const db = makeDb({ rules: [BASE_RULE], hasDelivery: false });

    await handleFanoutNotification(BASE_EVENT, db as never);

    expect(mockSendInApp).not.toHaveBeenCalled();
    // Delivery ainda deve ser gravado (regra foi "processada")
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  // ── 7. Falha de canal isolada → continua, delivery gravado ────────────────

  it('falha de in_app → delivery ainda gravado (falha isolada)', async () => {
    mockSendInApp.mockRejectedValue(new Error('DB connection failed'));
    const db = makeDb({ rules: [BASE_RULE], hasDelivery: false });

    // Não deve propagar a exceção do sender
    await expect(handleFanoutNotification(BASE_EVENT, db as never)).resolves.toBeUndefined();

    expect(mockSendInApp).toHaveBeenCalledTimes(1);
    // Delivery gravado mesmo com falha de canal
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  // ── 8. Destinatários vazios ────────────────────────────────────────────────

  it('sem destinatários resolvidos → sem dispatch, sem delivery (early return)', async () => {
    mockResolveRuleRecipients.mockResolvedValue([]);
    const db = makeDb({ rules: [BASE_RULE], hasDelivery: false });

    await handleFanoutNotification(BASE_EVENT, db as never);

    expect(mockSendInApp).not.toHaveBeenCalled();
    // Sem destinatários: early return antes de gravar delivery.
    // Reprocessamento seguro: sem destinatários → no-op idempotente.
    expect(db.insert).not.toHaveBeenCalled();
  });

  // ── 9. Múltiplas regras → todas processadas ───────────────────────────────

  it('múltiplas regras ativas → todas processadas independentemente', async () => {
    const rule2 = { ...BASE_RULE, id: 'rule-uuid-7777-7777-7777-777777777777' };
    const db = makeDb({ rules: [BASE_RULE, rule2], hasDelivery: false });

    await handleFanoutNotification(BASE_EVENT, db as never);

    // 2 destinatários (1 por regra) × 1 canal = 2 dispatches
    expect(mockSendInApp).toHaveBeenCalledTimes(2);
    // 2 deliveries (1 por regra)
    expect(db.insert).toHaveBeenCalledTimes(2);
  });

  // ── 10. Falha de uma regra → não interrompe demais ────────────────────────

  it('falha em uma regra → demais regras ainda processadas', async () => {
    const rule2 = { ...BASE_RULE, id: 'rule-uuid-8888-8888-8888-888888888888' };

    // Primeira chamada de resolveRuleRecipients lança; segunda retorna destinatário
    mockResolveRuleRecipients
      .mockRejectedValueOnce(new Error('DB timeout'))
      .mockResolvedValue([BASE_RECIPIENT]);

    const db = makeDb({ rules: [BASE_RULE, rule2], hasDelivery: false });

    await expect(handleFanoutNotification(BASE_EVENT, db as never)).resolves.toBeUndefined();

    // A 2ª regra ainda foi processada
    expect(mockSendInApp).toHaveBeenCalledTimes(1);
  });

  // ── 11. Template renderizado corretamente ─────────────────────────────────

  it('template com placeholders renderizados com dados do payload', async () => {
    const db = makeDb({ rules: [BASE_RULE], hasDelivery: false });

    await handleFanoutNotification(BASE_EVENT, db as never);

    expect(mockSendInApp).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        // title_template: 'Simulação {{simulation_id}} gerada'
        title: `Simulação ${AGGREGATE_ID} gerada`,
        // body_template: 'Lead {{lead_id}} recebeu simulação de {{amount}} em {{term_months}} meses.'
        body: 'Lead lead-uuid-aaaa recebeu simulação de 5000 em 12 meses.',
      }),
    );
  });

  // ── 12. Despacho email quando canal é email ────────────────────────────────

  it('canal email → chama sendEmail (não sendInApp)', async () => {
    const ruleEmail = { ...BASE_RULE, channels: ['email'] };
    const recipientEmail = { ...BASE_RECIPIENT, channels: ['email'] as ('in_app' | 'email')[] };
    mockResolveRuleRecipients.mockResolvedValue([recipientEmail]);
    const db = makeDb({ rules: [ruleEmail], hasDelivery: false });

    await handleFanoutNotification(BASE_EVENT, db as never);

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendInApp).not.toHaveBeenCalled();
  });

  // ── 13. Canal dentro do city_scope → processa normalmente ─────────────────

  it('cidade do evento dentro do city_scope da regra → processa normalmente', async () => {
    const ruleWithScope = {
      ...BASE_RULE,
      filters: { city_scope: [CITY_ID] },
    };
    const eventWithCity: EventOutbox = {
      ...BASE_EVENT,
      payload: {
        ...(BASE_EVENT.payload as object),
        data: {
          ...((BASE_EVENT.payload as Record<string, unknown>)['data'] as object),
          city_id: CITY_ID,
        },
      },
    };
    const db = makeDb({ rules: [ruleWithScope], hasDelivery: false });

    await handleFanoutNotification(eventWithCity, db as never);

    expect(mockSendInApp).toHaveBeenCalledTimes(1);
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  // ── 14. Sem filtro de cidade → processa qualquer cidade ───────────────────

  it('regra sem city_scope (filters={}) → processa evento de qualquer cidade', async () => {
    const db = makeDb({ rules: [BASE_RULE], hasDelivery: false });
    const eventWithCity: EventOutbox = {
      ...BASE_EVENT,
      payload: {
        ...(BASE_EVENT.payload as object),
        data: {
          ...((BASE_EVENT.payload as Record<string, unknown>)['data'] as object),
          city_id: CITY_ID,
        },
      },
    };

    await handleFanoutNotification(eventWithCity, db as never);

    expect(mockSendInApp).toHaveBeenCalledTimes(1);
  });

  // ── 16. Fail-closed (F24-S21): city_scope + evento sem city_id ────────────

  it('regra com city_scope + evento sem city_id → notificação suprimida (fail-closed)', async () => {
    const ruleWithScope = {
      ...BASE_RULE,
      filters: { city_scope: [CITY_ID] },
    };
    // BASE_EVENT não carrega city_id no payload (ex.: task.created, contract.signed)
    const db = makeDb({ rules: [ruleWithScope], hasDelivery: false });

    await handleFanoutNotification(BASE_EVENT, db as never);

    // Fail-closed: cidade indeterminada + regra restrita por city_scope → suprime
    expect(mockResolveRuleRecipients).not.toHaveBeenCalled();
    expect(mockSendInApp).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
    // Nenhuma tentativa de delivery registrada — supressão ocorre antes da idempotência.
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('regra sem city_scope + evento sem city_id → dispara normalmente (sem regressão)', async () => {
    const db = makeDb({ rules: [BASE_RULE], hasDelivery: false });

    await handleFanoutNotification(BASE_EVENT, db as never);

    expect(mockSendInApp).toHaveBeenCalledTimes(1);
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  // ── 15. severity da regra propaga ao sendInApp (F24-S19) ──────────────────

  it('regra com severity=critical → sendInApp recebe severity=critical', async () => {
    const criticalRule = { ...BASE_RULE, severity: 'critical' as const };
    const db = makeDb({ rules: [criticalRule], hasDelivery: false });

    await handleFanoutNotification(BASE_EVENT, db as never);

    expect(mockSendInApp).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ severity: 'critical' }),
    );
  });

  it('regra sem severity configurada (default info) → sendInApp recebe severity=info', async () => {
    const db = makeDb({ rules: [BASE_RULE], hasDelivery: false });

    await handleFanoutNotification(BASE_EVENT, db as never);

    expect(mockSendInApp).toHaveBeenCalledWith(db, expect.objectContaining({ severity: 'info' }));
  });

  it('canal email não recebe campo severity (parâmetro exclusivo de in_app)', async () => {
    const ruleEmail = { ...BASE_RULE, channels: ['email'], severity: 'critical' as const };
    const recipientEmail = { ...BASE_RECIPIENT, channels: ['email'] as ('in_app' | 'email')[] };
    mockResolveRuleRecipients.mockResolvedValue([recipientEmail]);
    const db = makeDb({ rules: [ruleEmail], hasDelivery: false });

    await handleFanoutNotification(BASE_EVENT, db as never);

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const emailArgs = mockSendEmail.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(emailArgs).not.toHaveProperty('severity');
  });
});
