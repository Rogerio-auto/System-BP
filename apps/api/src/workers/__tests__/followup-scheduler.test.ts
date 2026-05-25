// =============================================================================
// followup-scheduler.test.ts — Testes do worker F5-S02.
//
// Estratégia: injeção de db mock + mock de isFlagEnabled para isolar
//   a lógica do scheduler de conexões reais ao Postgres.
//   Todos os efeitos colaterais (inserts, flag reads) são mockados.
//
// Cenários cobertos:
//   1. Flag followup.enabled=disabled  → 0 queries de regras, 0 inserts
//   2. Flag followup.scheduler.enabled=disabled → dry_run=true, 0 inserts
//   3. Flags ON + regra ativa → jobs criados corretamente
//   4. Idempotência: 2º tick no mesmo day_bucket → 0 novos jobs (DO NOTHING)
//   5. applies_to_stage filtra corretamente (stage match vs mismatch)
//   6. applies_to_outcome filtra corretamente (outcome match vs mismatch)
//   7. applies_to_stage=null → aceita leads de qualquer stage
//   8. applies_to_outcome=null → aceita leads de qualquer outcome
//   9. trigger_type='event_based' → 0 leads elegíveis (stub)
//  10. Nenhuma regra ativa → tick retorna [] sem erro
//  11. getDayBucket() retorna formato YYYY-MM-DD
//  12. buildIdempotencyKey() monta chave canônica
// =============================================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock env (DEVE ser o primeiro mock)
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
    FOLLOWUP_SCHEDULER_TICK_MS: undefined,
  },
}));

// ---------------------------------------------------------------------------
// Mock pg (evita conexão real)
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
// Mock drizzle-orm (evita imports pesados + fornece stubs de eq/and/lt/isNull)
// ---------------------------------------------------------------------------
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ __eq: val })),
  and: vi.fn((...args: unknown[]) => ({ __and: args })),
  or: vi.fn((...args: unknown[]) => ({ __or: args })),
  lt: vi.fn((_col: unknown, val: unknown) => ({ __lt: val })),
  isNull: vi.fn((_col: unknown) => ({ __isNull: true })),
  sql: Object.assign(
    vi.fn(() => ({})),
    { mapWith: vi.fn() },
  ),
  relations: vi.fn().mockReturnValue({}),
  asc: vi.fn().mockReturnValue({}),
  desc: vi.fn().mockReturnValue({}),
  count: vi.fn().mockReturnValue({}),
  inArray: vi.fn().mockReturnValue({}),
  isNotNull: vi.fn().mockReturnValue({}),
}));

vi.mock('drizzle-orm/node-postgres', () => ({
  drizzle: vi.fn().mockReturnValue({}),
}));

// ---------------------------------------------------------------------------
// Mock db/client (singleton — não conecta ao Postgres)
// ---------------------------------------------------------------------------
vi.mock('../../db/client.js', () => ({
  db: {},
  pool: {},
}));

// ---------------------------------------------------------------------------
// Mock isFlagEnabled (feature flags)
// ---------------------------------------------------------------------------
const mockIsFlagEnabled = vi.fn();
vi.mock('../../modules/featureFlags/service.js', () => ({
  isFlagEnabled: (...args: unknown[]) => mockIsFlagEnabled(...args),
  invalidateFlagCache: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import das funções públicas exportadas (após mocks)
// ---------------------------------------------------------------------------
import {
  buildIdempotencyKey,
  getDayBucket,
  findInactivityLeads,
  processRule,
  runSchedulerTick,
} from '../followup-scheduler.js';
import type { EligibleLead, SchedulerLogger } from '../followup-scheduler.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const LEAD_ID_A = '22222222-2222-2222-2222-222222222222';
const LEAD_ID_B = '33333333-3333-3333-3333-333333333333';
const RULE_ID = 'aaaa0001-0000-0000-0000-000000000001';
const TEMPLATE_ID = 'bbbb0002-0000-0000-0000-000000000002';

const DAY_BUCKET = '2026-05-25';

function makeRule(
  overrides: Partial<{
    id: string;
    key: string;
    triggerType: 'stage_inactivity' | 'event_based';
    waitHours: number;
    appliesToStage: string | null;
    appliesToOutcome: string | null;
    isActive: boolean;
  }> = {},
) {
  return {
    id: overrides.id ?? RULE_ID,
    organizationId: ORG_ID,
    key: overrides.key ?? 'd1',
    name: 'Follow-up D+1',
    triggerType: overrides.triggerType ?? 'stage_inactivity',
    waitHours: overrides.waitHours ?? 24,
    templateId: TEMPLATE_ID,
    appliesToStage: overrides.appliesToStage !== undefined ? overrides.appliesToStage : null,
    appliesToOutcome: overrides.appliesToOutcome !== undefined ? overrides.appliesToOutcome : null,
    isActive: overrides.isActive !== undefined ? overrides.isActive : true,
    maxAttempts: 3,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/** Mock de Database injetável nos testes. */
function makeDb(
  options: {
    activeRules?: ReturnType<typeof makeRule>[];
    eligibleLeads?: EligibleLead[];
    insertReturns?: Array<{ id: string }>;
    /**
     * Se true (default), o primeiro select retorna as activeRules.
     * Se false, começa diretamente no select de leads (para testes de processRule/findInactivityLeads
     * chamados diretamente, sem passar pelo runSchedulerTick).
     */
    startsFromRulesSelect?: boolean;
  } = {},
) {
  const {
    activeRules = [],
    eligibleLeads = [],
    insertReturns = [{ id: 'job-uuid-1' }],
    startsFromRulesSelect = true,
  } = options;

  // Controla sequência de selects:
  //   startsFromRulesSelect=true:
  //     0: select activeRules (from followupRules WHERE is_active=true)
  //     1+: select from kanban_cards JOIN ... (findInactivityLeads)
  //   startsFromRulesSelect=false:
  //     0+: select from kanban_cards JOIN ... (findInactivityLeads)
  let selectCallCount = 0;

  const mockInsertResult = {
    onConflictDoNothing: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(insertReturns),
    values: vi.fn().mockReturnThis(),
  };

  const mockInsert = vi.fn().mockReturnValue(mockInsertResult);

  function buildLeadsChain(returnValue: unknown[]) {
    // O chain de leads suporta: from().innerJoin().innerJoin().where()
    const chain = {
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(returnValue),
    };
    // innerJoin retorna o mesmo objeto (mockReturnThis não preserva métodos adicionais)
    // Precisamos que onde retorna também tenha `innerJoin`
    chain.innerJoin = vi.fn().mockReturnValue(chain);
    return chain;
  }

  const leadsWithOutcome = eligibleLeads.map((l) => ({
    ...l,
    outcome: null as string | null,
  }));

  const mockSelect = vi.fn().mockImplementation(() => {
    const n = selectCallCount++;
    const isRulesSelect = startsFromRulesSelect && n === 0;

    if (isRulesSelect) {
      // Primeira select: activeRules (no innerJoin needed)
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(activeRules),
        }),
      };
    }

    // Select de leads: kanbanCards JOIN kanbanStages JOIN leads
    return {
      from: vi.fn().mockReturnValue(buildLeadsChain(leadsWithOutcome)),
    };
  });

  return {
    select: mockSelect,
    insert: mockInsert,
    _mockInsertResult: mockInsertResult,
    _reset: () => {
      selectCallCount = 0;
    },
  };
}

/** Logger mock silencioso (não polui output dos testes). */
const mockLoggerFns = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

// Cast para SchedulerLogger ao passar como argumento — vi.fn() satisfaz a interface em runtime.
const mockLogger = mockLoggerFns as unknown as SchedulerLogger;

// ---------------------------------------------------------------------------
// Helpers de flag
// ---------------------------------------------------------------------------

/** Configura flags: followup.enabled ON, followup.scheduler.enabled ON. */
function setFlagsAllOn() {
  mockIsFlagEnabled.mockImplementation((_db: unknown, flagKey: string) => {
    if (flagKey === 'followup.enabled')
      return Promise.resolve({ enabled: true, status: 'enabled' });
    if (flagKey === 'followup.scheduler.enabled')
      return Promise.resolve({ enabled: true, status: 'enabled' });
    return Promise.resolve({ enabled: false, status: 'disabled' });
  });
}

/** Configura flags: followup.enabled OFF. */
function setFlagFollowupDisabled() {
  mockIsFlagEnabled.mockImplementation((_db: unknown, flagKey: string) => {
    if (flagKey === 'followup.enabled')
      return Promise.resolve({ enabled: false, status: 'disabled' });
    return Promise.resolve({ enabled: false, status: 'disabled' });
  });
}

/** Configura flags: followup.enabled ON, followup.scheduler.enabled OFF (dry-run). */
function setFlagSchedulerDisabled() {
  mockIsFlagEnabled.mockImplementation((_db: unknown, flagKey: string) => {
    if (flagKey === 'followup.enabled')
      return Promise.resolve({ enabled: true, status: 'enabled' });
    if (flagKey === 'followup.scheduler.enabled')
      return Promise.resolve({ enabled: false, status: 'disabled' });
    return Promise.resolve({ enabled: false, status: 'disabled' });
  });
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe('followup-scheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoggerFns.info.mockClear();
    mockLoggerFns.debug.mockClear();
    mockLoggerFns.error.mockClear();
    mockLoggerFns.warn.mockClear();
  });

  // -------------------------------------------------------------------------
  // Funções utilitárias
  // -------------------------------------------------------------------------

  describe('getDayBucket()', () => {
    it('retorna formato YYYY-MM-DD para a data fornecida', () => {
      const date = new Date('2026-05-25T14:30:00Z');
      expect(getDayBucket(date)).toBe('2026-05-25');
    });

    it('retorna dia UTC correto (não local)', () => {
      // 2026-05-25T23:00:00Z — mesmo que seja 26/05 em UTC-1, bucket é UTC
      const date = new Date('2026-05-25T23:00:00Z');
      expect(getDayBucket(date)).toBe('2026-05-25');
    });
  });

  describe('buildIdempotencyKey()', () => {
    it('monta chave no formato rule_id:lead_id:day_bucket', () => {
      const key = buildIdempotencyKey('rule-1', 'lead-1', '2026-05-25');
      expect(key).toBe('rule-1:lead-1:2026-05-25');
    });
  });

  // -------------------------------------------------------------------------
  // Cenário 1: Flag followup.enabled=disabled → 0 inserts
  // -------------------------------------------------------------------------

  describe('runSchedulerTick() — flag followup.enabled=disabled', () => {
    it('retorna [] sem executar nenhuma query de regras', async () => {
      setFlagFollowupDisabled();
      const db = makeDb();

      const results = await runSchedulerTick(
        db as unknown as Parameters<typeof runSchedulerTick>[0],
        mockLogger,
        DAY_BUCKET,
      );

      expect(results).toHaveLength(0);
      // Verifica que NENHUM select foi executado (nem regras nem leads)
      expect(db.select).not.toHaveBeenCalled();
      // Nenhum insert
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('loga evento de skip com flag=followup.enabled', async () => {
      setFlagFollowupDisabled();
      const db = makeDb();

      await runSchedulerTick(
        db as unknown as Parameters<typeof runSchedulerTick>[0],
        mockLogger,
        DAY_BUCKET,
      );

      expect(mockLoggerFns.debug).toHaveBeenCalledWith(
        expect.objectContaining({ flag: 'followup.enabled' }),
        expect.any(String),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Cenário 2: Flag followup.scheduler.enabled=disabled → dry_run=true, 0 inserts
  // -------------------------------------------------------------------------

  describe('runSchedulerTick() — flag followup.scheduler.enabled=disabled (dry-run)', () => {
    it('não insere no banco mas loga dry_run=true por regra', async () => {
      setFlagSchedulerDisabled();

      const rule = makeRule({ key: 'd1' });
      const db = makeDb({
        activeRules: [rule],
        eligibleLeads: [{ leadId: LEAD_ID_A, organizationId: ORG_ID }],
      });

      const results = await runSchedulerTick(
        db as unknown as Parameters<typeof runSchedulerTick>[0],
        mockLogger,
        DAY_BUCKET,
      );

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        ruleKey: 'd1',
        leadsMatched: 1,
        jobsCreated: 0,
        dryRun: true,
      });

      // Nenhum insert deve ter sido executado
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('loga dry_run no início do tick', async () => {
      setFlagSchedulerDisabled();
      const db = makeDb({ activeRules: [] });

      await runSchedulerTick(
        db as unknown as Parameters<typeof runSchedulerTick>[0],
        mockLogger,
        DAY_BUCKET,
      );

      expect(mockLoggerFns.info).toHaveBeenCalledWith(
        expect.objectContaining({ flag: 'followup.scheduler.enabled' }),
        expect.any(String),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Cenário 3: Flags ON + regra ativa → jobs criados
  // -------------------------------------------------------------------------

  describe('runSchedulerTick() — flags ON', () => {
    it('cria jobs para leads elegíveis e retorna contadores corretos', async () => {
      setFlagsAllOn();

      const rule = makeRule({ key: 'd1' });
      const db = makeDb({
        activeRules: [rule],
        eligibleLeads: [
          { leadId: LEAD_ID_A, organizationId: ORG_ID },
          { leadId: LEAD_ID_B, organizationId: ORG_ID },
        ],
        insertReturns: [{ id: 'job-uuid-1' }],
      });

      const results = await runSchedulerTick(
        db as unknown as Parameters<typeof runSchedulerTick>[0],
        mockLogger,
        DAY_BUCKET,
      );

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        ruleKey: 'd1',
        leadsMatched: 2,
        jobsCreated: 2,
        dryRun: false,
      });

      // insert chamado 2 vezes (1 por lead)
      expect(db.insert).toHaveBeenCalledTimes(2);
    });

    it('loga o tick completo com contadores corretos', async () => {
      setFlagsAllOn();

      const rule = makeRule({ key: 'd3' });
      const db = makeDb({
        activeRules: [rule],
        eligibleLeads: [{ leadId: LEAD_ID_A, organizationId: ORG_ID }],
      });

      await runSchedulerTick(
        db as unknown as Parameters<typeof runSchedulerTick>[0],
        mockLogger,
        DAY_BUCKET,
      );

      // Verifica log estruturado por regra
      expect(mockLoggerFns.info).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'scheduler.rule_processed',
          rule_key: 'd3',
          leads_matched: 1,
          dry_run: false,
        }),
        expect.any(String),
      );

      // Verifica log de tick completo
      expect(mockLoggerFns.info).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'scheduler.tick_complete',
          rules_processed: 1,
          total_leads_matched: 1,
        }),
        expect.any(String),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Cenário 4: Idempotência — segundo tick com mesmo day_bucket → 0 novos jobs
  // -------------------------------------------------------------------------

  describe('processRule() — idempotência', () => {
    it('retorna 0 jobs_created quando ON CONFLICT DO NOTHING retorna []', async () => {
      const rule = makeRule({ key: 'd1' });

      // Simula que o CONFLICT foi acionado: returning() retorna []
      // startsFromRulesSelect=false: processRule chama findInactivityLeads diretamente
      // (sem o select de rules que só ocorre em runSchedulerTick)
      const dbNoConflict = makeDb({
        eligibleLeads: [{ leadId: LEAD_ID_A, organizationId: ORG_ID }],
        insertReturns: [], // DO NOTHING → retorna []
        startsFromRulesSelect: false,
      });

      const result = await processRule(
        dbNoConflict as unknown as Parameters<typeof processRule>[0],
        rule,
        false, // dryRun=false
        DAY_BUCKET,
      );

      expect(result).toMatchObject({
        ruleKey: 'd1',
        leadsMatched: 1,
        jobsCreated: 0, // conflict → não contabilizado
        dryRun: false,
      });
    });

    it('segundo tick no mesmo day_bucket → insert chamado mas returning=[] → 0 jobs', async () => {
      setFlagsAllOn();

      const rule = makeRule({ key: 'd1' });

      // Tick 1: insert retorna ID (job criado)
      const dbTick1 = makeDb({
        activeRules: [rule],
        eligibleLeads: [{ leadId: LEAD_ID_A, organizationId: ORG_ID }],
        insertReturns: [{ id: 'job-uuid-1' }],
      });

      const results1 = await runSchedulerTick(
        dbTick1 as unknown as Parameters<typeof runSchedulerTick>[0],
        mockLogger,
        DAY_BUCKET,
      );
      expect(results1[0]?.jobsCreated).toBe(1);

      vi.clearAllMocks();
      setFlagsAllOn();

      // Tick 2: mesmo day_bucket → ON CONFLICT → returning=[]
      const dbTick2 = makeDb({
        activeRules: [rule],
        eligibleLeads: [{ leadId: LEAD_ID_A, organizationId: ORG_ID }],
        insertReturns: [], // simula DO NOTHING
      });

      const results2 = await runSchedulerTick(
        dbTick2 as unknown as Parameters<typeof runSchedulerTick>[0],
        mockLogger,
        DAY_BUCKET,
      );
      expect(results2[0]?.jobsCreated).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Cenário 5: applies_to_stage filtra corretamente
  // -------------------------------------------------------------------------

  describe('findInactivityLeads() — applies_to_stage', () => {
    it('retorna leads quando applies_to_stage=null (sem filtro de stage)', async () => {
      const rule = makeRule({ appliesToStage: null });

      const db = makeDb({
        eligibleLeads: [{ leadId: LEAD_ID_A, organizationId: ORG_ID }],
        startsFromRulesSelect: false,
      });

      // Ao chamar findInactivityLeads com applies_to_stage=null,
      // o filtro de stage NÃO é adicionado ao WHERE — todos os leads com inatividade passam.
      const { eq: mockEq } = await import('drizzle-orm');
      const { and: mockAnd } = await import('drizzle-orm');

      // Verificamos que a chamada eq para stage name NÃO foi feita
      // (só seria feita se appliesToStage !== null)
      const leads = await findInactivityLeads(
        db as unknown as Parameters<typeof findInactivityLeads>[0],
        rule,
      );

      // Com applies_to_stage=null, nenhum filtro de stage é adicionado
      // O resultado depende apenas da query de inatividade
      expect(leads).toHaveLength(1);
      expect(leads[0]?.leadId).toBe(LEAD_ID_A);

      // Verificar que eq para kanbanStages.name NÃO foi chamado
      // (apenas eq para organizationId e lt para enteredStageAt, e isNull para deletedAt)
      const eqCalls = (mockEq as ReturnType<typeof vi.fn>).mock.calls;
      // Nenhuma chamada deve ter o valor que seria o applies_to_stage (como 'qualifying')
      const stageNameCall = eqCalls.find((call: unknown[]) => call[1] === 'qualifying');
      expect(stageNameCall).toBeUndefined();

      void mockAnd; // usado internamente
    });

    it('adiciona filtro de stage quando applies_to_stage não-null', async () => {
      const rule = makeRule({ appliesToStage: 'qualifying' });

      const db = makeDb({
        eligibleLeads: [{ leadId: LEAD_ID_A, organizationId: ORG_ID }],
        startsFromRulesSelect: false,
      });

      const { eq: mockEq } = await import('drizzle-orm');

      await findInactivityLeads(db as unknown as Parameters<typeof findInactivityLeads>[0], rule);

      // Verifica que eq foi chamado com o nome do stage
      const eqCalls = (mockEq as ReturnType<typeof vi.fn>).mock.calls;
      const stageNameCall = eqCalls.find((call: unknown[]) => call[1] === 'qualifying');
      expect(stageNameCall).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Cenário 6: applies_to_outcome filtra corretamente
  // -------------------------------------------------------------------------

  describe('findInactivityLeads() — applies_to_outcome', () => {
    it('filtra leads com outcome diferente quando applies_to_outcome não-null', async () => {
      const rule = makeRule({ appliesToOutcome: 'pending_docs' });

      // Simula db retornando 2 leads: um com outcome matching, outro com outcome diferente
      const dbWithMixedOutcomes = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue([
              { leadId: LEAD_ID_A, organizationId: ORG_ID, outcome: 'pending_docs' },
              { leadId: LEAD_ID_B, organizationId: ORG_ID, outcome: 'other_outcome' },
            ]),
          }),
        }),
      };

      const result = await findInactivityLeads(
        dbWithMixedOutcomes as unknown as Parameters<typeof findInactivityLeads>[0],
        rule,
      );

      // Apenas o lead com outcome='pending_docs' deve ser retornado
      expect(result).toHaveLength(1);
      expect(result[0]?.leadId).toBe(LEAD_ID_A);
    });

    it('retorna todos os leads quando applies_to_outcome=null', async () => {
      const rule = makeRule({ appliesToOutcome: null });

      const dbWithOutcomes = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue([
              { leadId: LEAD_ID_A, organizationId: ORG_ID, outcome: 'pending_docs' },
              { leadId: LEAD_ID_B, organizationId: ORG_ID, outcome: null },
            ]),
          }),
        }),
      };

      const result = await findInactivityLeads(
        dbWithOutcomes as unknown as Parameters<typeof findInactivityLeads>[0],
        rule,
      );

      // Ambos os leads retornados (sem filtro de outcome)
      expect(result).toHaveLength(2);
    });

    it('exclui leads com outcome=null quando applies_to_outcome especificado', async () => {
      const rule = makeRule({ appliesToOutcome: 'pending_docs' });

      const dbWithNullOutcome = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue([
              { leadId: LEAD_ID_A, organizationId: ORG_ID, outcome: null },
              { leadId: LEAD_ID_B, organizationId: ORG_ID, outcome: 'pending_docs' },
            ]),
          }),
        }),
      };

      const result = await findInactivityLeads(
        dbWithNullOutcome as unknown as Parameters<typeof findInactivityLeads>[0],
        rule,
      );

      expect(result).toHaveLength(1);
      expect(result[0]?.leadId).toBe(LEAD_ID_B);
    });
  });

  // -------------------------------------------------------------------------
  // Cenário 7: trigger_type='event_based' → 0 leads (stub)
  // -------------------------------------------------------------------------

  describe('processRule() — trigger_type=event_based', () => {
    it('retorna 0 leads_matched (stub não implementado neste slot)', async () => {
      const rule = makeRule({ triggerType: 'event_based' });
      const db = makeDb();

      const result = await processRule(
        db as unknown as Parameters<typeof processRule>[0],
        rule,
        false,
        DAY_BUCKET,
      );

      expect(result).toMatchObject({
        ruleKey: 'd1',
        leadsMatched: 0,
        jobsCreated: 0,
        dryRun: false,
      });

      // Nenhum insert chamado para leads que não foram encontrados
      expect(db.insert).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Cenário 8: Nenhuma regra ativa → retorna [] sem erro
  // -------------------------------------------------------------------------

  describe('runSchedulerTick() — nenhuma regra ativa', () => {
    it('retorna [] quando não há regras ativas', async () => {
      setFlagsAllOn();
      const db = makeDb({ activeRules: [] });

      const results = await runSchedulerTick(
        db as unknown as Parameters<typeof runSchedulerTick>[0],
        mockLogger,
        DAY_BUCKET,
      );

      expect(results).toHaveLength(0);
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('loga evento no_active_rules', async () => {
      setFlagsAllOn();
      const db = makeDb({ activeRules: [] });

      await runSchedulerTick(
        db as unknown as Parameters<typeof runSchedulerTick>[0],
        mockLogger,
        DAY_BUCKET,
      );

      expect(mockLoggerFns.debug).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'scheduler.no_active_rules' }),
        expect.any(String),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Cenário 9: Erro em uma regra não para o tick para as demais
  // -------------------------------------------------------------------------

  describe('runSchedulerTick() — resiliência a erros por regra', () => {
    it('continua processando demais regras quando uma falha', async () => {
      setFlagsAllOn();

      const rule1 = makeRule({ id: 'rule-1', key: 'd1' });
      const rule2 = makeRule({ id: 'rule-2', key: 'd3' });

      // Mock db que falha na primeira chamada de leads (regra 1)
      // mas funciona na segunda (regra 2)
      let selectCallCount = 0;
      const dbWithError = {
        select: vi.fn().mockImplementation(() => {
          const n = selectCallCount++;
          if (n === 0) {
            // activeRules select
            return {
              from: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue([rule1, rule2]),
              }),
            };
          }
          if (n === 1) {
            // lead select para rule1 → falha
            return {
              from: vi.fn().mockReturnValue({
                innerJoin: vi.fn().mockReturnThis(),
                where: vi.fn().mockRejectedValue(new Error('DB timeout')),
              }),
            };
          }
          // lead select para rule2 → sucesso com 0 leads
          return {
            from: vi.fn().mockReturnValue({
              innerJoin: vi.fn().mockReturnThis(),
              where: vi.fn().mockResolvedValue([]),
            }),
          };
        }),
        insert: vi.fn().mockReturnValue({
          onConflictDoNothing: vi.fn().mockReturnThis(),
          returning: vi.fn().mockResolvedValue([]),
          values: vi.fn().mockReturnThis(),
        }),
      };

      const results = await runSchedulerTick(
        dbWithError as unknown as Parameters<typeof runSchedulerTick>[0],
        mockLogger,
        DAY_BUCKET,
      );

      // rule1 falhou mas rule2 foi processada
      expect(results).toHaveLength(1);
      expect(results[0]?.ruleKey).toBe('d3');

      // Erro foi logado
      expect(mockLoggerFns.error).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'scheduler.rule_error', rule_key: 'd1' }),
        expect.any(String),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Verificação do formato da idempotency_key inserida
  // -------------------------------------------------------------------------

  describe('processRule() — idempotency_key no insert', () => {
    it('usa formato rule_id:lead_id:day_bucket na idempotency_key', async () => {
      const rule = makeRule({ id: RULE_ID, key: 'd1' });

      const capturedInserts: unknown[] = [];
      const dbCapture = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnThis(),
            where: vi
              .fn()
              .mockResolvedValue([{ leadId: LEAD_ID_A, organizationId: ORG_ID, outcome: null }]),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockImplementation((vals: unknown) => {
            capturedInserts.push(vals);
            return {
              onConflictDoNothing: vi.fn().mockReturnThis(),
              returning: vi.fn().mockResolvedValue([{ id: 'job-id' }]),
            };
          }),
        }),
      };

      await processRule(
        dbCapture as unknown as Parameters<typeof processRule>[0],
        rule,
        false,
        DAY_BUCKET,
      );

      expect(capturedInserts).toHaveLength(1);
      const inserted = capturedInserts[0] as { idempotencyKey: string };
      expect(inserted.idempotencyKey).toBe(`${RULE_ID}:${LEAD_ID_A}:${DAY_BUCKET}`);
    });
  });
});
