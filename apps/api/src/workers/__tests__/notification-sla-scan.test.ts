// notification-sla-scan.test.ts -- F24-S07, corrigido em F24-S16
//
// F24-S16: triggerKey usa uma chave REAL do TRIGGER_CATALOG ('kanban_stage:*').
// 'Qualificacao' (nome de stage) é proibido aqui — era exatamente o valor que
// a validação da API rejeitaria, e mascarava o bug de F24-S07 (ver slot).
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    FOLLOWUP_SCHEDULER_TICK_MS: undefined,
  },
}));
vi.mock('pg', () => {
  const M = vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  return { Pool: M, default: { Pool: M } };
});
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    eq: vi.fn((_c: unknown, v: unknown) => ({ __eq: v })),
    and: vi.fn((...a: unknown[]) => ({ __and: a })),
    isNotNull: vi.fn(() => ({})),
    lt: vi.fn(() => ({})),
  };
});

vi.mock('../../db/client.js', () => ({ db: {}, pool: {} }));

const mockFindSlaSources = vi.fn();
vi.mock('../../modules/notification-rules/sla-sources.js', () => ({
  findSlaSources: (...a: unknown[]) => mockFindSlaSources(...a),
}));
const mockResolveRecipients = vi.fn();
vi.mock('../../modules/notification-rules/recipients.js', () => ({
  resolveRuleRecipients: (...a: unknown[]) => mockResolveRecipients(...a),
}));
const mockIsCategoryEnabled = vi.fn();
vi.mock('../../modules/notifications/repository.js', () => ({
  isCategoryChannelEnabled: (...a: unknown[]) => mockIsCategoryEnabled(...a),
}));
const mockSendInApp = vi.fn();
vi.mock('../../modules/notifications/senders/inApp.js', () => ({
  sendInApp: (...a: unknown[]) => mockSendInApp(...a),
}));
const mockSendEmail = vi.fn();
vi.mock('../../modules/notifications/senders/email.js', () => ({
  sendEmail: (...a: unknown[]) => mockSendEmail(...a),
}));

import { buildSlaBucket, runSlaScanTick } from '../../workers/notification-sla-scan.js';
import type { SlaScanDb, SlaScanLogger } from '../../workers/notification-sla-scan.js';

// ---------------------------------------------------------------------------
// Mock de Database — tipado como SlaScanDb (Pick<Database, 'select'|'insert'>),
// o subconjunto real exercitado pelo worker (F24-S16). Nada de `as unknown as
// Database`: select/insert são os únicos métodos chamados diretamente aqui —
// tudo o mais (recipients, senders, sla-sources) é mockado via vi.mock acima.
// ---------------------------------------------------------------------------
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockDb: SlaScanDb = {
  select: mockSelect,
  insert: mockInsert,
};

// Logger mockado para inspecionar a supressão fail-closed de city_scope
// (hardening pós-review F24-S16 — sem isso a supressão vira silêncio).
const mockLoggerWarn = vi.fn();
const mockLogger: SlaScanLogger = { warn: mockLoggerWarn };

const RULE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const LEAD_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const CARD_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const USER_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

const BASE_RULE = {
  id: RULE_ID,
  organizationId: ORG_ID,
  name: 'Inatividade',
  triggerKind: 'stage_inactivity' as const,
  // F24-S16: chave REAL do TRIGGER_CATALOG — 'Qualificacao' é proibido aqui.
  triggerKey: 'kanban_stage:*',
  category: 'lifecycle_stalled',
  thresholdHours: 24,
  cooldownHours: 24,
  enabled: true,
  recipientMode: 'by_role_city' as const,
  recipientRoles: ['agente'],
  channels: ['in_app'],
  titleTemplate: 'Lead parado',
  bodyTemplate: 'Lead {{entity_id}}',
  severity: 'warning' as const,
  filters: {},
  createdBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// entityType vem do catálogo (kanban_card para o eixo kanban_stage) — nunca 'lead'
// fixo (F24-S16). leadId é o campo separado usado para recipientMode='assignee'.
const BASE_ENTITY = {
  entityId: CARD_ID,
  entityType: 'kanban_card',
  cityId: null,
  leadId: LEAD_ID,
  sinceAt: new Date(Date.now() - 48 * 60 * 60 * 1_000),
};

function setupFullFlow(rules: unknown[], hasDelivery: boolean): void {
  let n = 0;
  mockSelect.mockImplementation(() => {
    n++;
    if (n === 1)
      return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(rules) }) };
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(hasDelivery ? [{ id: 'x' }] : []),
        }),
      }),
    };
  });
  mockInsert.mockReturnValue({
    values: vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn().mockResolvedValue(undefined) }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFindSlaSources.mockResolvedValue([]);
  mockResolveRecipients.mockResolvedValue([]);
  mockIsCategoryEnabled.mockResolvedValue(true);
  mockSendInApp.mockResolvedValue(undefined);
  mockSendEmail.mockResolvedValue(undefined);
  mockLoggerWarn.mockReset();
});

describe('buildSlaBucket', () => {
  it('mesma janela = mesmo bucket', () => {
    const now = new Date('2026-07-09T10:00:00Z');
    expect(buildSlaBucket(RULE_ID, 24, now)).toBe(buildSlaBucket(RULE_ID, 24, now));
  });
  it('janelas diferentes = buckets diferentes', () => {
    expect(buildSlaBucket(RULE_ID, 24, new Date('2026-07-09T10:00:00Z'))).not.toBe(
      buildSlaBucket(RULE_ID, 24, new Date('2026-07-10T12:00:00Z')),
    );
  });
  it('prefixo sla e ruleId presentes', () => {
    const b = buildSlaBucket(RULE_ID, 24, new Date());
    expect(b).toMatch(/^sla:/);
    expect(b).toContain(RULE_ID);
  });
});

describe('runSlaScanTick', () => {
  it('sem regras ativas -> 0', async () => {
    mockSelect.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    }));
    const r = await runSlaScanTick(mockDb);
    expect(r.rulesProcessed).toBe(0);
    expect(r.entitiesEligible).toBe(0);
  });

  it('regra ativa + entidade elegivel -> disparo', async () => {
    setupFullFlow([BASE_RULE], false);
    mockFindSlaSources.mockResolvedValue([BASE_ENTITY]);
    mockResolveRecipients.mockResolvedValue([
      { userId: USER_ID, organizationId: ORG_ID, displayName: 'A', channels: ['in_app' as const] },
    ]);
    const r = await runSlaScanTick(mockDb);
    expect(r.rulesProcessed).toBe(1);
    expect(r.entitiesEligible).toBe(1);
    expect(mockSendInApp).toHaveBeenCalledOnce();
  });

  it('repassa leadId da entidade (nao mais entityType==="lead") para resolveRuleRecipients', async () => {
    setupFullFlow([BASE_RULE], false);
    mockFindSlaSources.mockResolvedValue([BASE_ENTITY]);
    mockResolveRecipients.mockResolvedValue([]);
    await runSlaScanTick(mockDb);
    expect(mockResolveRecipients).toHaveBeenCalledOnce();
    const [, resolveInput] = mockResolveRecipients.mock.calls[0] as [unknown, { leadId: unknown }];
    expect(resolveInput.leadId).toBe(LEAD_ID);
  });

  it('cooldown: ja entregue -> skip', async () => {
    setupFullFlow([BASE_RULE], true);
    mockFindSlaSources.mockResolvedValue([BASE_ENTITY]);
    const r = await runSlaScanTick(mockDb);
    expect(r.rulesProcessed).toBe(1);
    expect(mockSendInApp).not.toHaveBeenCalled();
  });

  it('city_scope: fora do scope (cityId conhecido) -> skip', async () => {
    setupFullFlow([{ ...BASE_RULE, filters: { city_scope: ['city-a'] } }], false);
    mockFindSlaSources.mockResolvedValue([{ ...BASE_ENTITY, cityId: 'city-b' }]);
    await runSlaScanTick(mockDb);
    expect(mockSendInApp).not.toHaveBeenCalled();
  });

  it('city_scope: dentro do scope (cityId conhecido) -> notifica', async () => {
    setupFullFlow([{ ...BASE_RULE, filters: { city_scope: ['city-a'] } }], false);
    mockFindSlaSources.mockResolvedValue([{ ...BASE_ENTITY, cityId: 'city-a' }]);
    mockResolveRecipients.mockResolvedValue([
      { userId: USER_ID, organizationId: ORG_ID, displayName: 'A', channels: ['in_app' as const] },
    ]);
    await runSlaScanTick(mockDb);
    expect(mockSendInApp).toHaveBeenCalledOnce();
  });

  // ---------------------------------------------------------------------------
  // Hardening pós-review F24-S16: fail-closed de city_scope quando cityId é nulo.
  //
  // Regressão do bug: uma regra com city_scope configurado + uma entidade cujo
  // cityId não é resolvível (ex: handoff:requested sem lead vinculado — o
  // próprio eixo novo que este slot tornou vivo) NÃO pode ser tratada como
  // "sem restrição". Antes do fix, cityId=null passava direto para
  // resolveRuleRecipients, que trata cityId=null como contexto global e faria
  // broadcast pra org inteira — furando o city_scope da regra (cross-city leak).
  // ---------------------------------------------------------------------------

  it('REGRESSÃO: city_scope configurado + cityId nulo -> suprime (fail-closed), nunca broadcast', async () => {
    setupFullFlow([{ ...BASE_RULE, filters: { city_scope: ['city-a'] } }], false);
    mockFindSlaSources.mockResolvedValue([{ ...BASE_ENTITY, cityId: null }]);
    // Mesmo que resolveRuleRecipients devolvesse destinatários (contexto global),
    // a supressão deve acontecer ANTES de resolveRuleRecipients ser chamado.
    mockResolveRecipients.mockResolvedValue([
      { userId: USER_ID, organizationId: ORG_ID, displayName: 'A', channels: ['in_app' as const] },
    ]);
    await runSlaScanTick(mockDb, mockLogger);
    expect(mockResolveRecipients).not.toHaveBeenCalled();
    expect(mockSendInApp).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('REGRESSÃO: supressão fail-closed é logada com rule_id/trigger_key/organization_id (sem PII)', async () => {
    setupFullFlow([{ ...BASE_RULE, filters: { city_scope: ['city-a'] } }], false);
    mockFindSlaSources.mockResolvedValue([{ ...BASE_ENTITY, cityId: null }]);
    await runSlaScanTick(mockDb, mockLogger);
    expect(mockLoggerWarn).toHaveBeenCalledOnce();
    const [logPayload] = mockLoggerWarn.mock.calls[0] as [Record<string, unknown>, string];
    expect(logPayload).toEqual({
      rule_id: RULE_ID,
      trigger_key: 'kanban_stage:*',
      organization_id: ORG_ID,
    });
  });

  it('sem city_scope + cityId nulo -> segue notificando (sem regressão)', async () => {
    // BASE_RULE.filters = {} (sem city_scope) + BASE_ENTITY.cityId = null por padrão.
    setupFullFlow([BASE_RULE], false);
    mockFindSlaSources.mockResolvedValue([BASE_ENTITY]);
    mockResolveRecipients.mockResolvedValue([
      { userId: USER_ID, organizationId: ORG_ID, displayName: 'A', channels: ['in_app' as const] },
    ]);
    await runSlaScanTick(mockDb, mockLogger);
    expect(mockSendInApp).toHaveBeenCalledOnce();
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  it('sem destinatarios -> sem disparo', async () => {
    setupFullFlow([BASE_RULE], false);
    mockFindSlaSources.mockResolvedValue([BASE_ENTITY]);
    mockResolveRecipients.mockResolvedValue([]);
    await runSlaScanTick(mockDb);
    expect(mockSendInApp).not.toHaveBeenCalled();
  });

  it('canal desabilitado -> sem disparo', async () => {
    setupFullFlow([BASE_RULE], false);
    mockFindSlaSources.mockResolvedValue([BASE_ENTITY]);
    mockResolveRecipients.mockResolvedValue([
      { userId: USER_ID, organizationId: ORG_ID, displayName: 'A', channels: ['in_app' as const] },
    ]);
    mockIsCategoryEnabled.mockResolvedValue(false);
    await runSlaScanTick(mockDb);
    expect(mockSendInApp).not.toHaveBeenCalled();
  });
});
