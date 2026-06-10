// =============================================================================
// collection-sender.test.ts — Testes do worker F5-S07 (sender).
//
// Estratégia: injeção de db mock + mock de isFlagEnabled + mock de MetaWhatsAppClient.
//   Todos os efeitos colaterais são mockados — sem conexão real ao Postgres.
//
// Cenários cobertos:
//   1. Flag billing.enabled=disabled → 0 jobs processados
//   2. Flag billing.sender.enabled=disabled → dry_run=true, 0 chamadas Meta API
//   3. paid_before_send → job marcado paid_before_send, evento emitido
//   4. Consentimento revogado → job cancelado, outcome='consent_blocked'
//   5. Lead não encontrado (customer sem lead) → job failed
//   6. Lead deletado → job cancelado, outcome='skipped'
//   7. Template não aprovado → job failed
//   8. Lock otimista: job já processado → skipped
//   9. Envio bem-sucedido → status='sent', wamid preenchido, outbox emitido
//  10. Falha no envio → backoff exponencial, attempt_count++
//  11. max_attempts atingido → status='failed' terminal
//  12. calcCollectionJobBackoff() → backoff exponencial com cap
//  13. renderCollectionTemplateVariables() → variáveis mapeadas corretamente
//  14. buildCollectionSendParams() → payload correto para Meta API
// =============================================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock env
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
// Mock db/client
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
  buildCollectionSendParams,
  calcCollectionJobBackoff,
  processCollectionJob,
  renderCollectionTemplateVariables,
  runCollectionSenderTick,
} from '../collection-sender.js';
import type { CollectionJobContext, SenderLogger } from '../collection-sender.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = 'org-uuid-1';
const DUE_ID = 'due-uuid-1';
const RULE_ID = 'rule-uuid-1';
const JOB_ID = 'job-uuid-1';
const CUSTOMER_ID = 'customer-uuid-1';
const LEAD_ID = 'lead-uuid-1';
const TEMPLATE_ID = 'template-uuid-1';

function makeJob(
  overrides: Partial<{
    id: string;
    status: 'scheduled' | 'triggered' | 'sent' | 'failed' | 'cancelled' | 'paid_before_send';
    attemptCount: number;
    paymentDueId: string;
    scheduledAt: Date;
  }> = {},
) {
  return {
    id: overrides.id ?? JOB_ID,
    organizationId: ORG_ID,
    paymentDueId: overrides.paymentDueId ?? DUE_ID,
    ruleId: RULE_ID,
    scheduledAt: overrides.scheduledAt ?? new Date(Date.now() - 1000),
    status: overrides.status ?? 'scheduled',
    attemptCount: overrides.attemptCount ?? 0,
    lastError: null as string | null,
    sentMessageId: null as string | null,
    idempotencyKey: '2026-06-15:d7',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeCtx(
  overrides: Partial<{
    dueStatus: string;
    consentRevokedAt: Date | null;
    leadDeletedAt: Date | null;
    leadStatus: string;
    templateStatus: string;
    lead: CollectionJobContext['lead'] | null;
  }> = {},
): CollectionJobContext {
  const job = makeJob();
  return {
    job,
    rule: {
      id: RULE_ID,
      organizationId: ORG_ID,
      key: 'd7',
      name: 'Cobrança D+7',
      triggerType: 'days_after_due',
      waitHours: 168,
      templateId: TEMPLATE_ID,
      appliesToStatus: 'overdue',
      isActive: true,
      maxAttempts: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    template: {
      id: TEMPLATE_ID,
      organizationId: ORG_ID,
      name: 'cobranca_d7',
      language: 'pt_BR',
      status: (overrides.templateStatus ?? 'approved') as
        | 'pending'
        | 'approved'
        | 'rejected'
        | 'paused',
      category: 'utility' as const,
      variables: [
        'customer_name',
        'installment_number',
        'amount',
        'due_date',
        'contract_reference',
      ],
      metaTemplateId: 'meta-tpl-id',
      body: 'Olá {{1}}, sua parcela {{2}} de {{3}} vence em {{4}}. Contrato {{5}}.',
      // F5-S10: colunas de header de mídia (template só-texto por default).
      headerType: 'none',
      headerText: null,
      headerHandle: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    due: {
      id: DUE_ID,
      organizationId: ORG_ID,
      contractReference: 'BP-2026-00123',
      installmentNumber: 3,
      dueDate: '2026-06-15',
      amount: '1500.00',
      status: overrides.dueStatus ?? 'overdue',
      customerId: CUSTOMER_ID,
    },
    customer:
      overrides.lead === null
        ? null
        : {
            id: CUSTOMER_ID,
            organizationId: ORG_ID,
            primaryLeadId: LEAD_ID,
            consentRevokedAt:
              overrides.consentRevokedAt !== undefined ? overrides.consentRevokedAt : null,
          },
    lead:
      overrides.lead === null
        ? null
        : (overrides.lead ?? {
            id: LEAD_ID,
            name: 'João Silva',
            phoneE164: '+5511999999999',
            deletedAt: overrides.leadDeletedAt !== undefined ? overrides.leadDeletedAt : null,
            status: overrides.leadStatus ?? 'active',
          }),
  };
}

const mockLoggerFns = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const mockLogger = mockLoggerFns as unknown as SenderLogger;

// ---------------------------------------------------------------------------
// Helper: metaClient mock
// ---------------------------------------------------------------------------
function makeMetaClient() {
  return { sendTemplate: mockSendTemplate };
}

// ---------------------------------------------------------------------------
// Helper: db mock para processCollectionJob
// ---------------------------------------------------------------------------
/**
 * Cria um objeto onde que é Promise E tem .returning().
 * Necessário para o lock otimista: database.update().set().where().returning()
 * E para updates simples: database.update().set().where()
 */
function makeWhereResult(
  returnRows: unknown[] = [],
): Promise<unknown[]> & { returning: ReturnType<typeof vi.fn> } {
  const promise = Promise.resolve(returnRows) as Promise<unknown[]> & {
    returning: ReturnType<typeof vi.fn>;
  };
  promise.returning = vi.fn().mockResolvedValue(returnRows);
  return promise;
}

function makeDbForProcess(options: {
  ctx?: CollectionJobContext | null;
  lockResult?: Array<{ id: string }>;
}) {
  const { ctx = makeCtx(), lockResult = [{ id: JOB_ID }] } = options;

  let selectCallCount = 0;

  const mockTx = {
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue(makeWhereResult([])),
      }),
    }),
  };

  const mockTransaction = vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
    await fn(mockTx);
  });

  // All updates use the same chain pattern that supports both .where() and .where().returning()
  const mockUpdate = vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue(makeWhereResult(lockResult)),
    }),
  });

  return {
    select: vi.fn().mockImplementation(() => {
      const n = selectCallCount++;

      if (ctx === null) {
        return {
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
          }),
        };
      }

      // Sequência: rule+template, due, customer, lead
      if (n === 0) {
        return {
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ rule: ctx.rule, template: ctx.template }]),
            }),
          }),
        };
      }
      if (n === 1) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([ctx.due]),
            }),
          }),
        };
      }
      if (n === 2) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(ctx.customer !== null ? [ctx.customer] : []),
            }),
          }),
        };
      }
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(ctx.lead !== null ? [ctx.lead] : []),
          }),
        }),
      };
    }),
    update: mockUpdate,
    transaction: mockTransaction,
    _mockTx: mockTx,
  };
}

// ---------------------------------------------------------------------------
// Helpers de flag
// ---------------------------------------------------------------------------

function setFlagsAllOn() {
  mockIsFlagEnabled.mockImplementation((_db: unknown, flagKey: string) => {
    if (flagKey === 'billing.enabled') return Promise.resolve({ enabled: true, status: 'enabled' });
    if (flagKey === 'billing.sender.enabled')
      return Promise.resolve({ enabled: true, status: 'enabled' });
    return Promise.resolve({ enabled: false, status: 'disabled' });
  });
}

function setFlagBillingDisabled() {
  mockIsFlagEnabled.mockResolvedValue({ enabled: false, status: 'disabled' });
}

function setFlagSenderDisabled() {
  mockIsFlagEnabled.mockImplementation((_db: unknown, flagKey: string) => {
    if (flagKey === 'billing.enabled') return Promise.resolve({ enabled: true, status: 'enabled' });
    return Promise.resolve({ enabled: false, status: 'disabled' });
  });
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe('collection-sender', () => {
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

  describe('calcCollectionJobBackoff()', () => {
    it('attempt=1 → 5 minutos', () => {
      expect(calcCollectionJobBackoff(1)).toBe(5 * 60 * 1000);
    });

    it('attempt=2 → 10 minutos', () => {
      expect(calcCollectionJobBackoff(2)).toBe(10 * 60 * 1000);
    });

    it('attempt=10 → cap 24 horas', () => {
      expect(calcCollectionJobBackoff(10)).toBe(24 * 60 * 60 * 1000);
    });
  });

  describe('renderCollectionTemplateVariables()', () => {
    it('mapeia todas as variáveis corretamente', () => {
      const ctx = makeCtx();
      const vars = [
        'customer_name',
        'installment_number',
        'amount',
        'due_date',
        'contract_reference',
      ];
      const result = renderCollectionTemplateVariables(vars, ctx);

      expect(result).toHaveLength(5);
      expect(result[0]).toEqual({ type: 'text', text: 'João Silva' });
      expect(result[1]).toEqual({ type: 'text', text: '3' });
      // R$ 1.500,00
      expect(result[2]?.text).toContain('1.500');
      // 15/06/2026
      expect(result[3]?.text).toBe('15/06/2026');
      expect(result[4]).toEqual({ type: 'text', text: 'BP-2026-00123' });
    });

    it('variável desconhecida → texto vazio', () => {
      const ctx = makeCtx();
      const result = renderCollectionTemplateVariables(['unknown_var'], ctx);
      expect(result[0]).toEqual({ type: 'text', text: '' });
    });

    it('customer_name sem lead → texto vazio', () => {
      const ctx = makeCtx({ lead: null });
      const result = renderCollectionTemplateVariables(['customer_name'], ctx);
      expect(result[0]).toEqual({ type: 'text', text: '' });
    });
  });

  describe('buildCollectionSendParams()', () => {
    it('monta payload com template_name + language + components', () => {
      const ctx = makeCtx();
      const params = buildCollectionSendParams(ctx);

      expect(params.templateName).toBe('cobranca_d7');
      expect(params.language).toBe('pt_BR');
      expect(params.to).toBe('+5511999999999');
      expect(params.components).toHaveLength(1);
      expect(params.components[0]?.type).toBe('body');
    });
  });

  // -------------------------------------------------------------------------
  // processCollectionJob
  // -------------------------------------------------------------------------

  describe('processCollectionJob()', () => {
    it('parcela paga → outcome=paid_before_send, sem envio', async () => {
      const ctx = makeCtx({ dueStatus: 'paid' });
      const db = makeDbForProcess({ ctx });
      const job = makeJob();

      const result = await processCollectionJob(db as never, null, job, false, mockLogger);

      expect(result.outcome).toBe('paid_before_send');
      expect(result.terminal).toBe(true);
      expect(mockSendTemplate).not.toHaveBeenCalled();
    });

    it('consentimento revogado → outcome=consent_blocked', async () => {
      const ctx = makeCtx({ consentRevokedAt: new Date() });
      const db = makeDbForProcess({ ctx });
      const job = makeJob();

      const result = await processCollectionJob(db as never, null, job, false, mockLogger);

      expect(result.outcome).toBe('consent_blocked');
      expect(result.terminal).toBe(true);
      expect(mockSendTemplate).not.toHaveBeenCalled();
    });

    it('lead null (customer sem lead) → outcome=failed', async () => {
      const ctx = makeCtx({ lead: null });
      const db = makeDbForProcess({ ctx });
      const job = makeJob();

      const result = await processCollectionJob(db as never, null, job, false, mockLogger);

      expect(result.outcome).toBe('failed');
      expect(result.error).toBe('lead_missing');
    });

    it('lead deletado → outcome=skipped', async () => {
      const ctx = makeCtx({ leadDeletedAt: new Date() });
      const db = makeDbForProcess({ ctx });
      const job = makeJob();

      const result = await processCollectionJob(db as never, null, job, false, mockLogger);

      expect(result.outcome).toBe('skipped');
      expect(result.terminal).toBe(true);
    });

    it('template não aprovado → outcome=failed', async () => {
      const ctx = makeCtx({ templateStatus: 'pending' });
      const db = makeDbForProcess({ ctx });
      const job = makeJob();

      const result = await processCollectionJob(db as never, null, job, false, mockLogger);

      expect(result.outcome).toBe('failed');
    });

    it('lock otimista falhou → outcome=skipped (processado por outra instância)', async () => {
      const ctx = makeCtx();
      // Lock retorna [] = nenhuma linha atualizada
      const db = makeDbForProcess({ ctx, lockResult: [] });
      const job = makeJob();

      const result = await processCollectionJob(
        db as never,
        makeMetaClient() as never,
        job,
        false,
        mockLogger,
      );

      expect(result.outcome).toBe('skipped');
      expect(result.terminal).toBe(false);
      expect(mockSendTemplate).not.toHaveBeenCalled();
    });

    it('dry_run=true → outcome=dry_run, sem chamada Meta API', async () => {
      const ctx = makeCtx();
      const db = makeDbForProcess({ ctx });
      const job = makeJob();

      const result = await processCollectionJob(
        db as never,
        makeMetaClient() as never,
        job,
        true,
        mockLogger,
      );

      expect(result.outcome).toBe('dry_run');
      expect(mockSendTemplate).not.toHaveBeenCalled();
    });

    it('envio bem-sucedido → outcome=sent, wamid preenchido', async () => {
      const ctx = makeCtx();
      const db = makeDbForProcess({ ctx });
      const job = makeJob();
      mockSendTemplate.mockResolvedValueOnce({ wamid: 'wamid.ABC123' });

      const result = await processCollectionJob(
        db as never,
        makeMetaClient() as never,
        job,
        false,
        mockLogger,
      );

      expect(result.outcome).toBe('sent');
      expect(result.wamid).toBe('wamid.ABC123');
      expect(result.attemptCount).toBe(1);
      expect(mockEmit).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ eventName: 'billing.collection_sent' }),
      );
    });

    it('falha no envio → backoff, attempt_count++', async () => {
      const ctx = makeCtx();
      const db = makeDbForProcess({ ctx });
      const job = makeJob({ attemptCount: 0 });
      const apiError = new ExternalServiceError('Meta API error', { meta_error_code: 131047 });
      mockSendTemplate.mockRejectedValueOnce(apiError);

      const result = await processCollectionJob(
        db as never,
        makeMetaClient() as never,
        job,
        false,
        mockLogger,
      );

      expect(result.outcome).toBe('failed');
      expect(result.attemptCount).toBe(1);
      expect(result.terminal).toBe(false);
      expect(mockEmit).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ eventName: 'billing.collection_failed' }),
      );
    });

    it('max_attempts atingido → terminal=true', async () => {
      const ctx = makeCtx();
      const db = makeDbForProcess({ ctx });
      // attemptCount=2, maxAttempts=3 → próxima tentativa (3) >= maxAttempts → terminal
      const job = makeJob({ attemptCount: 2 });
      mockSendTemplate.mockRejectedValueOnce(new Error('timeout'));

      const result = await processCollectionJob(
        db as never,
        makeMetaClient() as never,
        job,
        false,
        mockLogger,
      );

      expect(result.terminal).toBe(true);
      expect(result.attemptCount).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // runCollectionSenderTick
  // -------------------------------------------------------------------------

  describe('runCollectionSenderTick()', () => {
    it('billing.enabled=disabled → retorna [] sem queries', async () => {
      setFlagBillingDisabled();
      const db = { select: vi.fn(), update: vi.fn() };

      const results = await runCollectionSenderTick(db as never, null, mockLogger);

      expect(results).toEqual([]);
      expect(db.select).not.toHaveBeenCalled();
    });

    it('billing.sender.enabled=disabled → dry_run=true, sem chamadas Meta API', async () => {
      setFlagSenderDisabled();

      // Batch vazio: sem jobs para processar neste tick
      const db = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
        update: vi.fn(),
      };

      const results = await runCollectionSenderTick(db as never, null, mockLogger);
      expect(results).toEqual([]);
      expect(mockSendTemplate).not.toHaveBeenCalled();
    });

    it('flags ON, nenhum job → retorna []', async () => {
      setFlagsAllOn();

      const db = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      };

      const results = await runCollectionSenderTick(db as never, null, mockLogger);
      expect(results).toEqual([]);
    });
  });
});
