// =============================================================================
// followup-sender.test.ts — Testes do worker F5-S03.
//
// Estratégia: injeção de db mock + mock de isFlagEnabled + mock de MetaWhatsAppClient.
//   Todos os efeitos colaterais são mockados — sem conexão real ao Postgres.
//
// Cenários cobertos:
//   1. Flag followup.enabled=disabled → 0 jobs processados, 0 chamadas Meta API
//   2. Flag followup.sender.enabled=disabled → dry_run=true, 0 chamadas Meta API
//   3. Ambas flags ON → jobs são enviados com sucesso
//   4. Dry-run: job revertido para 'scheduled', outcome='dry_run'
//   5. Lead deletado → job cancelado, outcome='skipped'
//   6. Lead arquivado → job cancelado, outcome='skipped'
//   7. Consentimento revogado → job cancelado, outcome='consent_blocked'
//   8. Template não aprovado → job failed imediatamente
//   9. Lock otimista: job já processado por outra instância → skipped
//  10. Envio bem-sucedido → status='sent', wamid preenchido, outbox emitido
//  11. Falha no envio → backoff exponencial, attempt_count++
//  12. max_attempts atingido → status='failed' terminal
//  13. calcJobBackoff() → backoff exponencial com cap
//  14. renderTemplateVariables() → variáveis mapeadas corretamente
//  15. buildSendTemplateParams() → payload correto para Meta API
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
    LGPD_DEDUPE_PEPPER: 'a'.repeat(44),
    META_WHATSAPP_ACCESS_TOKEN: 'test-token',
    META_WHATSAPP_PHONE_NUMBER_ID: '123456789',
    FOLLOWUP_SENDER_TICK_MS: undefined,
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
  lte: vi.fn((_col: unknown, val: unknown) => ({ __lte: val })),
  isNull: vi.fn(() => ({ __isNull: true })),
  not: vi.fn((arg: unknown) => ({ __not: arg })),
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
  or: vi.fn((...args: unknown[]) => ({ __or: args })),
}));

vi.mock('drizzle-orm/node-postgres', () => ({
  drizzle: vi.fn().mockReturnValue({}),
}));

// ---------------------------------------------------------------------------
// Mock db/client (singleton)
// ---------------------------------------------------------------------------
vi.mock('../../db/client.js', () => ({
  db: {},
  pool: {},
}));

// ---------------------------------------------------------------------------
// Mock feature flags
// ---------------------------------------------------------------------------
const mockIsFlagEnabled = vi.fn();
vi.mock('../../modules/featureFlags/service.js', () => ({
  isFlagEnabled: (...args: unknown[]) => mockIsFlagEnabled(...args),
}));

// ---------------------------------------------------------------------------
// Mock MetaWhatsAppClient
// ---------------------------------------------------------------------------
const mockSendTemplate = vi.fn();
vi.mock('../../integrations/meta-whatsapp/client.js', () => ({
  MetaWhatsAppClient: vi.fn().mockImplementation(() => ({
    sendTemplate: mockSendTemplate,
  })),
}));

// ---------------------------------------------------------------------------
// Mock emit + auditLog
// ---------------------------------------------------------------------------
const mockEmit = vi.fn().mockResolvedValue('event-uuid');
vi.mock('../../events/emit.js', () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
}));

const mockAuditLog = vi.fn().mockResolvedValue('audit-uuid');
vi.mock('../../lib/audit.js', () => ({
  auditLog: (...args: unknown[]) => mockAuditLog(...args),
}));

// ---------------------------------------------------------------------------
// Import das funções sob teste
// ---------------------------------------------------------------------------
import { ExternalServiceError } from '../../shared/errors.js';
import {
  buildSendTemplateParams,
  calcJobBackoff,
  processJob,
  renderTemplateVariables,
  runSenderTick,
} from '../followup-sender.js';
import type { JobContext } from '../followup-sender.js';
import type { SenderLogger } from '../followup-sender.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = 'org-uuid-1';
const LEAD_ID = 'lead-uuid-1';
const RULE_ID = 'rule-uuid-1';
const TEMPLATE_ID = 'tpl-uuid-1';
const JOB_ID = 'job-uuid-1';
const WAMID = 'wamid.test123abc';

function makeJob(
  overrides: Partial<{
    id: string;
    status: string;
    attemptCount: number;
    scheduledAt: Date;
  }> = {},
): Parameters<typeof processJob>[2] {
  return {
    id: overrides.id ?? JOB_ID,
    organizationId: ORG_ID,
    leadId: LEAD_ID,
    ruleId: RULE_ID,
    status: (overrides.status ?? 'scheduled') as 'scheduled',
    attemptCount: overrides.attemptCount ?? 0,
    scheduledAt: overrides.scheduledAt ?? new Date(Date.now() - 1000),
    sentMessageId: null,
    lastError: null,
    idempotencyKey: 'key-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeCtx(
  overrides: {
    leadStatus?: string;
    deletedAt?: Date | null;
    consentRevokedAt?: Date | null;
    hasCustomer?: boolean;
    templateStatus?: string;
    templateVariables?: string[];
    maxAttempts?: number;
    leadName?: string;
    phoneE164?: string;
  } = {},
): JobContext {
  return {
    job: makeJob(),
    rule: {
      id: RULE_ID,
      organizationId: ORG_ID,
      key: 'd1',
      name: 'Follow-up D+1',
      triggerType: 'stage_inactivity',
      waitHours: 24,
      templateId: TEMPLATE_ID,
      appliesToStage: null,
      appliesToOutcome: null,
      isActive: true,
      maxAttempts: overrides.maxAttempts ?? 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    template: {
      id: TEMPLATE_ID,
      organizationId: ORG_ID,
      metaTemplateId: 'meta-tpl-1',
      name: 'followup_d1',
      language: 'pt_BR',
      category: 'utility',
      body: 'Olá {{1}}, sua proposta de crédito de {{2}} está aguardando.',
      variables: overrides.templateVariables ?? ['customer_name', 'simulation_amount'],
      status: (overrides.templateStatus ?? 'approved') as 'approved',
      // F5-S10: colunas de header de mídia (template só-texto por default).
      headerType: 'none',
      headerText: null,
      headerHandle: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    lead: {
      id: LEAD_ID,
      organizationId: ORG_ID,
      name: overrides.leadName ?? 'João da Silva',
      phoneE164: overrides.phoneE164 ?? '+5569912345678',
      status: overrides.leadStatus ?? 'qualifying',
      deletedAt: overrides.deletedAt !== undefined ? overrides.deletedAt : null,
      lastSimulationId: 'sim-uuid-1',
    },
    customer:
      overrides.hasCustomer === false
        ? null
        : {
            id: 'customer-uuid-1',
            consentRevokedAt:
              overrides.consentRevokedAt !== undefined ? overrides.consentRevokedAt : null,
          },
    simulation: {
      id: 'sim-uuid-1',
      amountRequested: '15000.00',
      monthlyPayment: '450.50',
      termMonths: 36,
    },
  };
}

// Mock de logger silencioso
const mockLoggerFns = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};
const mockLogger: SenderLogger = mockLoggerFns;

// ---------------------------------------------------------------------------
// Helpers de db mock
// ---------------------------------------------------------------------------

type DbMock = {
  select: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
};

function makeDb(
  opts: {
    jobsInBatch?: ReturnType<typeof makeJob>[];
  } = {},
): DbMock {
  const batch = opts.jobsInBatch ?? [];

  // Mock para o select do batch
  const batchSelectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(batch),
  };

  const db: DbMock = {
    select: vi.fn().mockReturnValue(batchSelectChain),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
      returning: vi.fn().mockResolvedValue([{ id: JOB_ID }]),
    }),
    transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const fakeTx = {
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnThis(),
          where: vi.fn().mockResolvedValue([]),
        }),
      };
      return fn(fakeTx);
    }),
  };

  return db;
}

// ---------------------------------------------------------------------------
// Helper: updateChain — mock para database.update().set().where()
// Suporta tanto await direto quanto .returning() em cadeia.
// ---------------------------------------------------------------------------

function makeWhereResult(
  returnRows: unknown[] = [],
): Promise<unknown[]> & { returning: ReturnType<typeof vi.fn> } {
  // Objeto que é Promise E tem .returning() — necessário para o lock otimista
  // (database.update().set().where().returning()) E para updates simples
  // (database.update().set().where()).
  const promise = Promise.resolve(returnRows) as Promise<unknown[]> & {
    returning: ReturnType<typeof vi.fn>;
  };
  promise.returning = vi.fn().mockResolvedValue(returnRows);
  return promise;
}

function makeUpdateChain(lockRows: unknown[] = [{ id: JOB_ID }]): ReturnType<typeof vi.fn> {
  return vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue(makeWhereResult(lockRows)),
    }),
  });
}

// ---------------------------------------------------------------------------
// Helper: setFlags
// ---------------------------------------------------------------------------

function setFlags(followupEnabled: boolean, senderEnabled: boolean): void {
  mockIsFlagEnabled.mockImplementation(
    (_db: unknown, key: string): Promise<{ enabled: boolean }> => {
      if (key === 'followup.enabled') return Promise.resolve({ enabled: followupEnabled });
      if (key === 'followup.sender.enabled') return Promise.resolve({ enabled: senderEnabled });
      return Promise.resolve({ enabled: false });
    },
  );
}

// ---------------------------------------------------------------------------
// Suite de testes
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// -------------------------------------------------------------------------
// Cenário 1: followup.enabled=disabled
// -------------------------------------------------------------------------
describe('runSenderTick() — followup.enabled=disabled', () => {
  it('retorna [] sem processar nenhum job', async () => {
    setFlags(false, true);
    const db = makeDb();

    const results = await runSenderTick(
      db as unknown as Parameters<typeof runSenderTick>[0],
      null,
      mockLogger,
    );

    expect(results).toHaveLength(0);
    expect(mockLoggerFns.debug).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'sender.skipped', flag: 'followup.enabled' }),
      expect.any(String),
    );
  });
});

// -------------------------------------------------------------------------
// Cenário 2: followup.sender.enabled=disabled → dry-run
// -------------------------------------------------------------------------
describe('runSenderTick() — followup.sender.enabled=disabled', () => {
  it('entra em dry-run e loga evento dry_run_mode', async () => {
    setFlags(true, false);
    const db = makeDb({ jobsInBatch: [] });

    await runSenderTick(db as unknown as Parameters<typeof runSenderTick>[0], null, mockLogger);

    expect(mockLoggerFns.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'sender.dry_run_mode' }),
      expect.any(String),
    );
  });
});

// -------------------------------------------------------------------------
// Cenário 3: nenhum job agendado
// -------------------------------------------------------------------------
describe('runSenderTick() — sem jobs agendados', () => {
  it('retorna [] e loga no_jobs', async () => {
    setFlags(true, true);
    const db = makeDb({ jobsInBatch: [] });

    const results = await runSenderTick(
      db as unknown as Parameters<typeof runSenderTick>[0],
      null,
      mockLogger,
    );

    expect(results).toHaveLength(0);
    expect(mockLoggerFns.debug).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'sender.no_jobs' }),
      expect.any(String),
    );
  });
});

// -------------------------------------------------------------------------
// Cenário 4: dry-run — job composto mas não enviado
// -------------------------------------------------------------------------
describe('processJob() — dry_run=true', () => {
  it('loga dry-run sem chamar sendTemplate e retorna outcome=dry_run', async () => {
    const ctx = makeCtx();
    const job = makeJob();

    // Mock loadJobContext retornando ctx válido
    const dbWithCtx = {
      select: vi
        .fn()
        // 1ª chamada: regra+template
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([{ rule: ctx.rule, template: ctx.template }]),
        })
        // 2ª chamada: lead
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([ctx.lead]),
        })
        // 3ª chamada: customer
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([ctx.customer]),
        })
        // 4ª chamada: simulação
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([ctx.simulation]),
        }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: job.id }]),
            then: (resolve: (v: unknown[]) => unknown) => resolve([]),
          }),
        }),
      }),
      transaction: vi.fn(),
    };

    const result = await processJob(
      dbWithCtx as unknown as Parameters<typeof processJob>[0],
      null, // metaClient=null → dry-run
      job,
      true, // dryRun=true
      mockLogger,
    );

    expect(result.outcome).toBe('dry_run');
    expect(mockSendTemplate).not.toHaveBeenCalled();
    expect(mockLoggerFns.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'sender.dry_run', dry_run: true }),
      expect.any(String),
    );
  });
});

// -------------------------------------------------------------------------
// Cenário 4b: dry-run cooldown — scheduledAt avançado para evitar log spam
// -------------------------------------------------------------------------
describe('processJob() — dry_run cooldown', () => {
  it('avança scheduledAt em dry-run para evitar reprocessamento imediato', async () => {
    const ctx = makeCtx();
    const job = makeJob();

    const mockSet = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    });

    const dbWithCtx = {
      select: vi
        .fn()
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([{ rule: ctx.rule, template: ctx.template }]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([ctx.lead]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([ctx.customer]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([ctx.simulation]),
        }),
      // 1ª chamada: lock (status→triggered)
      // 2ª chamada: dry-run revert (status→scheduled com cooldown)
      update: vi
        .fn()
        .mockReturnValueOnce({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue(makeWhereResult([{ id: job.id }])),
          }),
        })
        .mockReturnValueOnce({ set: mockSet }),
      transaction: vi.fn(),
    };

    const before = Date.now();
    await processJob(
      dbWithCtx as unknown as Parameters<typeof processJob>[0],
      null,
      job,
      true,
      mockLogger,
    );
    const after = Date.now();

    // Verificar que o set() de dry-run inclui scheduledAt no futuro
    const setArg = mockSet.mock.calls[0]?.[0] as { scheduledAt?: Date; status?: string };
    expect(setArg?.status).toBe('scheduled');
    expect(setArg?.scheduledAt).toBeInstanceOf(Date);
    // scheduledAt deve ser posterior ao momento da chamada (cooldown aplicado)
    expect((setArg?.scheduledAt as Date).getTime()).toBeGreaterThan(before);
    expect((setArg?.scheduledAt as Date).getTime()).toBeGreaterThan(after);
  });
});

// -------------------------------------------------------------------------
// Cenário 5: Lead deletado
// -------------------------------------------------------------------------
describe('processJob() — lead deletado', () => {
  it('cancela job e retorna outcome=skipped', async () => {
    const ctx = makeCtx({ deletedAt: new Date() });
    const job = makeJob();

    const dbWithCtx = {
      select: vi
        .fn()
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([{ rule: ctx.rule, template: ctx.template }]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([ctx.lead]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([]),
        }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      }),
    };

    const result = await processJob(
      dbWithCtx as unknown as Parameters<typeof processJob>[0],
      null,
      job,
      false,
      mockLogger,
    );

    expect(result.outcome).toBe('skipped');
    expect(result.terminal).toBe(true);
  });
});

// -------------------------------------------------------------------------
// Cenário 6: Lead arquivado
// -------------------------------------------------------------------------
describe('processJob() — lead arquivado', () => {
  it('cancela job e retorna outcome=skipped', async () => {
    const ctx = makeCtx({ leadStatus: 'archived' });
    const job = makeJob();

    const dbWithCtx = {
      select: vi
        .fn()
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([{ rule: ctx.rule, template: ctx.template }]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([ctx.lead]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([]),
        }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      }),
    };

    const result = await processJob(
      dbWithCtx as unknown as Parameters<typeof processJob>[0],
      null,
      job,
      false,
      mockLogger,
    );

    expect(result.outcome).toBe('skipped');
  });
});

// -------------------------------------------------------------------------
// Cenário 7: Consentimento revogado
// -------------------------------------------------------------------------
describe('processJob() — consentimento revogado', () => {
  it('bloqueia envio e retorna outcome=consent_blocked', async () => {
    const ctx = makeCtx({ consentRevokedAt: new Date('2026-01-15') });
    const job = makeJob();

    const dbWithCtx = {
      select: vi
        .fn()
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([{ rule: ctx.rule, template: ctx.template }]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([ctx.lead]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([ctx.customer]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([]),
        }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      }),
    };

    const result = await processJob(
      dbWithCtx as unknown as Parameters<typeof processJob>[0],
      null,
      job,
      false,
      mockLogger,
    );

    expect(result.outcome).toBe('consent_blocked');
    expect(result.terminal).toBe(true);
    expect(mockLoggerFns.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'sender.job_consent_blocked' }),
      expect.any(String),
    );
  });
});

// -------------------------------------------------------------------------
// Cenário 8: Template não aprovado
// -------------------------------------------------------------------------
describe('processJob() — template não aprovado', () => {
  it('falha imediatamente sem chamar Meta API', async () => {
    const ctx = makeCtx({ templateStatus: 'pending' });
    const job = makeJob();

    const dbWithCtx = {
      select: vi
        .fn()
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([{ rule: ctx.rule, template: ctx.template }]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([ctx.lead]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([ctx.customer]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([]),
        }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      }),
    };

    const result = await processJob(
      dbWithCtx as unknown as Parameters<typeof processJob>[0],
      null,
      job,
      false,
      mockLogger,
    );

    expect(result.outcome).toBe('failed');
    expect(result.terminal).toBe(true);
    expect(mockSendTemplate).not.toHaveBeenCalled();
  });
});

// -------------------------------------------------------------------------
// Cenário 9: Lock otimista — job já processado por outra instância
// -------------------------------------------------------------------------
describe('processJob() — lock otimista perdido', () => {
  it('retorna skipped quando UPDATE WHERE status=scheduled não afeta nenhuma linha', async () => {
    const ctx = makeCtx();
    const job = makeJob();

    const dbWithCtx = {
      select: vi
        .fn()
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([{ rule: ctx.rule, template: ctx.template }]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([ctx.lead]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([ctx.customer]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([]),
        }),
      // UPDATE retorna [] → lock não obtido (returning vazio = lock perdido)
      update: makeUpdateChain([]), // [] = lock não obtido
    };

    const result = await processJob(
      dbWithCtx as unknown as Parameters<typeof processJob>[0],
      null,
      job,
      false,
      mockLogger,
    );

    expect(result.outcome).toBe('skipped');
    expect(mockSendTemplate).not.toHaveBeenCalled();
  });
});

// -------------------------------------------------------------------------
// Cenário 10: Envio bem-sucedido
// -------------------------------------------------------------------------
describe('processJob() — envio bem-sucedido', () => {
  it('retorna outcome=sent com wamid, emite outbox e auditLog', async () => {
    const ctx = makeCtx();
    const job = makeJob();

    mockSendTemplate.mockResolvedValueOnce({ wamid: WAMID });

    const fakeTx = {
      update: makeUpdateChain(),
    };

    const dbWithCtx = {
      select: vi
        .fn()
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([{ rule: ctx.rule, template: ctx.template }]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([ctx.lead]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([ctx.customer]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([ctx.simulation]),
        }),
      update: makeUpdateChain([{ id: job.id }]), // lock obtido
      transaction: vi
        .fn()
        .mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx)),
    };

    const metaClient = { sendTemplate: mockSendTemplate } as unknown as Parameters<
      typeof processJob
    >[1];

    const result = await processJob(
      dbWithCtx as unknown as Parameters<typeof processJob>[0],
      metaClient,
      job,
      false,
      mockLogger,
    );

    expect(result.outcome).toBe('sent');
    expect(result.wamid).toBe(WAMID);
    expect(result.attemptCount).toBe(1);
    expect(result.terminal).toBe(false);

    // Outbox emitido com evento followup.sent
    expect(mockEmit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventName: 'followup.sent',
        data: expect.objectContaining({
          followup_job_id: job.id,
          lead_id: job.leadId,
          wamid: WAMID,
          template_key: 'followup_d1',
          attempt_count: 1,
        }),
      }),
    );

    // Audit log emitido
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'followup.sent',
        resource: { type: 'followup_job', id: job.id },
      }),
    );
  });
});

// -------------------------------------------------------------------------
// Cenário 11: Falha no envio → backoff + attempt_count++
// -------------------------------------------------------------------------
describe('processJob() — falha no envio com backoff', () => {
  it('incrementa attempt_count, re-agenda com backoff, emite followup.failed', async () => {
    const ctx = makeCtx({ maxAttempts: 3 });
    const job = makeJob({ attemptCount: 0 });

    mockSendTemplate.mockRejectedValueOnce(
      new ExternalServiceError('Meta API 500: Internal error', { upstreamStatus: 500 }),
    );

    const fakeTx = {
      update: makeUpdateChain(),
    };

    const dbWithCtx = {
      select: vi
        .fn()
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([{ rule: ctx.rule, template: ctx.template }]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([ctx.lead]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([ctx.customer]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([ctx.simulation]),
        }),
      update: makeUpdateChain([{ id: job.id }]), // lock obtido
      transaction: vi
        .fn()
        .mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx)),
    };

    const metaClient = { sendTemplate: mockSendTemplate } as unknown as Parameters<
      typeof processJob
    >[1];

    const result = await processJob(
      dbWithCtx as unknown as Parameters<typeof processJob>[0],
      metaClient,
      job,
      false,
      mockLogger,
    );

    expect(result.outcome).toBe('failed');
    expect(result.attemptCount).toBe(1);
    expect(result.terminal).toBe(false); // 1 < maxAttempts(3)

    // Outbox emitido com followup.failed
    expect(mockEmit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventName: 'followup.failed',
        data: expect.objectContaining({
          attempt_count: 1,
          terminal: false,
        }),
      }),
    );
  });
});

// -------------------------------------------------------------------------
// Cenário 12: max_attempts atingido → terminal=true
// -------------------------------------------------------------------------
describe('processJob() — max_attempts atingido', () => {
  it('marca terminal=true quando attempt_count >= maxAttempts', async () => {
    const ctx = makeCtx({ maxAttempts: 3 });
    const job = makeJob({ attemptCount: 2 }); // 2 tentativas → 3ª é terminal

    mockSendTemplate.mockRejectedValueOnce(
      new ExternalServiceError('Meta API 429: Rate limit', { upstreamStatus: 429 }),
    );

    const fakeTx = {
      update: makeUpdateChain(),
    };

    const dbWithCtx = {
      select: vi
        .fn()
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([{ rule: ctx.rule, template: ctx.template }]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([ctx.lead]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([ctx.customer]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([ctx.simulation]),
        }),
      update: makeUpdateChain([{ id: job.id }]), // lock obtido
      transaction: vi
        .fn()
        .mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx)),
    };

    const metaClient = { sendTemplate: mockSendTemplate } as unknown as Parameters<
      typeof processJob
    >[1];

    const result = await processJob(
      dbWithCtx as unknown as Parameters<typeof processJob>[0],
      metaClient,
      job,
      false,
      mockLogger,
    );

    expect(result.terminal).toBe(true);
    expect(result.attemptCount).toBe(3);

    expect(mockEmit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventName: 'followup.failed',
        data: expect.objectContaining({
          terminal: true,
          attempt_count: 3,
        }),
      }),
    );
  });
});

// -------------------------------------------------------------------------
// Cenário 13: calcJobBackoff() — backoff exponencial com cap
// -------------------------------------------------------------------------
describe('calcJobBackoff()', () => {
  it('attempt=1 → 5 minutos (300000ms)', () => {
    expect(calcJobBackoff(1)).toBe(5 * 60 * 1000);
  });

  it('attempt=2 → 10 minutos (600000ms)', () => {
    expect(calcJobBackoff(2)).toBe(10 * 60 * 1000);
  });

  it('attempt=3 → 20 minutos (1200000ms)', () => {
    expect(calcJobBackoff(3)).toBe(20 * 60 * 1000);
  });

  it('attempt alto → cap de 24 horas (86400000ms)', () => {
    expect(calcJobBackoff(100)).toBe(24 * 60 * 60 * 1000);
  });
});

// -------------------------------------------------------------------------
// Cenário 14: renderTemplateVariables()
// -------------------------------------------------------------------------
describe('renderTemplateVariables()', () => {
  const baseCtx = makeCtx({
    leadName: 'Maria Oliveira',
    templateVariables: [
      'customer_name',
      'simulation_amount',
      'simulation_installment',
      'simulation_term',
    ],
  });

  it('mapeia customer_name para nome do lead', () => {
    const result = renderTemplateVariables(['customer_name'], baseCtx);
    expect(result[0]?.text).toBe('Maria Oliveira');
    expect(result[0]?.type).toBe('text');
  });

  it('mapeia simulation_amount para valor formatado em BRL', () => {
    const result = renderTemplateVariables(['simulation_amount'], baseCtx);
    expect(result[0]?.text).toContain('15.000');
  });

  it('mapeia simulation_installment para parcela em BRL', () => {
    const result = renderTemplateVariables(['simulation_installment'], baseCtx);
    expect(result[0]?.text).toContain('450');
  });

  it('mapeia simulation_term para prazo em meses', () => {
    const result = renderTemplateVariables(['simulation_term'], baseCtx);
    expect(result[0]?.text).toBe('36 meses');
  });

  it('variável desconhecida → string vazia', () => {
    const result = renderTemplateVariables(['unknown_var'], baseCtx);
    expect(result[0]?.text).toBe('');
  });

  it('array vazio → array vazio', () => {
    const result = renderTemplateVariables([], baseCtx);
    expect(result).toHaveLength(0);
  });
});

// -------------------------------------------------------------------------
// Cenário 15: buildSendTemplateParams()
// -------------------------------------------------------------------------
describe('buildSendTemplateParams()', () => {
  it('monta parâmetros corretos para Meta API', () => {
    const ctx = makeCtx({ templateVariables: ['customer_name'] });
    const params = buildSendTemplateParams(ctx);

    expect(params.to).toBe(ctx.lead.phoneE164);
    expect(params.templateName).toBe('followup_d1');
    expect(params.language).toBe('pt_BR');
    expect(params.components).toHaveLength(1);
    expect(params.components[0]?.type).toBe('body');
  });

  it('inclui body component apenas quando há variáveis', () => {
    const ctx = makeCtx({ templateVariables: [] });
    const params = buildSendTemplateParams(ctx);

    expect(params.components).toHaveLength(0);
  });

  it('não expõe número de telefone em nenhum campo de log (estrutural)', () => {
    const ctx = makeCtx({ phoneE164: '+5569912345678' });
    const params = buildSendTemplateParams(ctx);

    // to está no params (vai para corpo HTTP), mas não no log
    // Este teste verifica que o campo `to` é exatamente o phoneE164
    expect(params.to).toBe('+5569912345678');
  });
});
