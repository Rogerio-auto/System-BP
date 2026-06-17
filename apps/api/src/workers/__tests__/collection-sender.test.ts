// =============================================================================
// collection-sender.test.ts — Testes do worker F5-S07 + F5-S14 (sender + boleto).
//
// Estratégia: injeção de db mock + mock de isFlagEnabled + mock de MetaWhatsAppClient.
//   Todos os efeitos colaterais são mockados — sem conexão real ao Postgres.
//
// Cenários cobertos:
//   1.  Flag billing.enabled=disabled → 0 jobs processados
//   2.  Flag billing.sender.enabled=disabled → dry_run=true, 0 chamadas Meta API
//   3.  paid_before_send → job marcado paid_before_send, evento emitido
//   4.  Consentimento revogado → job cancelado, outcome='consent_blocked'
//   5.  Lead não encontrado (customer sem lead) → job failed
//   6.  Lead deletado → job cancelado, outcome='skipped'
//   7.  Template não aprovado → job failed
//   8.  Lock otimista: job já processado → skipped
//   9.  Envio bem-sucedido → status='sent', wamid preenchido, outbox emitido
//  10.  Falha no envio → backoff exponencial, attempt_count++
//  11.  max_attempts atingido → status='failed' terminal
//  12.  calcCollectionJobBackoff() → backoff exponencial com cap
//  13.  renderCollectionTemplateVariables() → variáveis mapeadas corretamente
//  14.  buildCollectionSendParams() → payload correto para Meta API (body only)
//  --- F5-S14: header de boleto ---
//  15.  Envio por media_id válido → header document com id, sem re-upload
//  16.  Envio por link (só boleto_url, sem media_id) → header document com link
//  17.  Re-upload em expiração → novo media_id, parcela atualizada na tx de sucesso
//  18.  boleto_missing → failed terminal, evento emitido, sem chamar Meta
//  19.  Gate billing.boleto.enabled=off → envia só body (sem header de mídia)
//  20.  dry-run com template de mídia → sem re-upload, outcome=dry_run
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
    BOLETO_ALLOWED_HOSTS: ['boletos.bdp.ro.gov.br'],
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
const mockUploadMedia = vi.fn();
vi.mock('../../integrations/meta-whatsapp/client.js', () => ({
  MetaWhatsAppClient: vi.fn().mockImplementation(() => ({
    sendTemplate: mockSendTemplate,
    uploadMedia: mockUploadMedia,
  })),
}));

// ---------------------------------------------------------------------------
// Mock fetch (global) para re-upload
// ---------------------------------------------------------------------------
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

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
  resolveMediaHeader,
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
    channelId: string | null;
  }> = {},
) {
  return {
    id: overrides.id ?? JOB_ID,
    organizationId: ORG_ID,
    channelId: overrides.channelId !== undefined ? overrides.channelId : null,
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
    templateHeaderType: 'none' | 'text' | 'document' | 'image' | 'video';
    lead: CollectionJobContext['lead'] | null;
    // Boleto overrides (F5-S14)
    boletoUrl: string | null;
    boletoMediaId: string | null;
    boletoMediaExpiresAt: Date | null;
    boletoFilename: string | null;
  }> = {},
): CollectionJobContext {
  const job = makeJob();
  return {
    job,
    rule: {
      id: RULE_ID,
      organizationId: ORG_ID,
      channelId: null,
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
      // F5-S10: colunas de header de mídia
      headerType: overrides.templateHeaderType ?? 'none',
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
      // Boleto fields (F5-S14) — default: sem boleto
      boletoUrl: overrides.boletoUrl !== undefined ? overrides.boletoUrl : null,
      boletoMediaId: overrides.boletoMediaId !== undefined ? overrides.boletoMediaId : null,
      boletoMediaExpiresAt:
        overrides.boletoMediaExpiresAt !== undefined ? overrides.boletoMediaExpiresAt : null,
      boletoFilename: overrides.boletoFilename !== undefined ? overrides.boletoFilename : null,
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
  return { sendTemplate: mockSendTemplate, uploadMedia: mockUploadMedia };
}

// ---------------------------------------------------------------------------
// Helper: mock de response.body usando ReadableStream (para downloadBoletoBytes)
// ---------------------------------------------------------------------------
/**
 * Cria um mock de Response compatível com a leitura via ReadableStream
 * que downloadBoletoBytes agora usa internamente.
 *
 * @param bytes - Conteúdo total do "corpo" a retornar (como Uint8Array)
 * @param contentLength - Se fornecido, popula o header content-length
 */
function makeFetchResponseWithBody(bytes: Uint8Array, contentLength?: number) {
  const reader = {
    read: vi
      .fn()
      .mockResolvedValueOnce({ done: false, value: bytes })
      .mockResolvedValueOnce({ done: true, value: undefined }),
    cancel: vi.fn().mockResolvedValue(undefined),
    releaseLock: vi.fn(),
  };

  return {
    ok: true,
    status: 200,
    headers: {
      get: (name: string) =>
        name === 'content-length' && contentLength !== undefined ? String(contentLength) : null,
    },
    body: { getReader: () => reader },
  };
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

      // Sequência: rule+template, due (com boleto), customer, lead
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

function setFlagsAllOn(boletoEnabled = true) {
  mockIsFlagEnabled.mockImplementation((_db: unknown, flagKey: string) => {
    if (flagKey === 'billing.enabled') return Promise.resolve({ enabled: true, status: 'enabled' });
    if (flagKey === 'billing.sender.enabled')
      return Promise.resolve({ enabled: true, status: 'enabled' });
    if (flagKey === 'billing.boleto.enabled')
      return Promise.resolve({
        enabled: boletoEnabled,
        status: boletoEnabled ? 'enabled' : 'disabled',
      });
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
    mockFetch.mockReset();
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
    it('monta payload com template_name + language + components (body only)', () => {
      const ctx = makeCtx();
      const params = buildCollectionSendParams(ctx);

      expect(params.templateName).toBe('cobranca_d7');
      expect(params.language).toBe('pt_BR');
      expect(params.to).toBe('+5511999999999');
      expect(params.components).toHaveLength(1);
      expect(params.components[0]?.type).toBe('body');
    });

    it('inclui header component quando fornecido', () => {
      const ctx = makeCtx();
      const headerComponent = {
        type: 'header' as const,
        parameters: [{ type: 'document' as const, document: { id: 'media-id-abc' } }],
      };
      const params = buildCollectionSendParams(ctx, headerComponent);

      expect(params.components).toHaveLength(2);
      expect(params.components[0]?.type).toBe('header');
      expect(params.components[1]?.type).toBe('body');
    });
  });

  // -------------------------------------------------------------------------
  // resolveMediaHeader (F5-S14)
  // -------------------------------------------------------------------------

  describe('resolveMediaHeader()', () => {
    it('gate billing.boleto.enabled=off → kind=gate_off, sem chamar uploadMedia', async () => {
      const ctx = makeCtx({
        templateHeaderType: 'document',
        boletoUrl: 'https://boletos.bdp.ro.gov.br/boleto.pdf',
        boletoMediaId: 'media-abc',
        boletoMediaExpiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      });
      // Flag boleto desligada
      mockIsFlagEnabled.mockResolvedValue({ enabled: false, status: 'disabled' });

      const db = makeDbForProcess({ ctx });
      const result = await resolveMediaHeader(
        db as never,
        ctx,
        makeMetaClient() as never,
        mockLogger,
      );

      expect(result.kind).toBe('gate_off');
      expect(mockUploadMedia).not.toHaveBeenCalled();
    });

    it('template header_type=none → kind=gate_off sem consultar boleto', async () => {
      const ctx = makeCtx({
        templateHeaderType: 'none',
      });
      mockIsFlagEnabled.mockResolvedValue({ enabled: true, status: 'enabled' });

      const db = makeDbForProcess({ ctx });
      const result = await resolveMediaHeader(
        db as never,
        ctx,
        makeMetaClient() as never,
        mockLogger,
      );

      expect(result.kind).toBe('gate_off');
    });

    it('media_id válido (não expirado) → kind=ok, header por id, sem re-upload', async () => {
      const ctx = makeCtx({
        templateHeaderType: 'document',
        boletoMediaId: 'media-abc-123',
        boletoMediaExpiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // 10 dias no futuro
      });
      mockIsFlagEnabled.mockResolvedValue({ enabled: true, status: 'enabled' });

      const db = makeDbForProcess({ ctx });
      const result = await resolveMediaHeader(
        db as never,
        ctx,
        makeMetaClient() as never,
        mockLogger,
      );

      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.reupload).toBeNull();
        expect(result.headerComponent.type).toBe('header');
        const param = result.headerComponent.parameters[0];
        expect(param?.type).toBe('document');
        if (param?.type === 'document') {
          expect(param.document.id).toBe('media-abc-123');
          expect(param.document.link).toBeUndefined();
        }
      }
      expect(mockUploadMedia).not.toHaveBeenCalled();
    });

    it('só boleto_url (sem media_id) → kind=ok, header por link', async () => {
      const ctx = makeCtx({
        templateHeaderType: 'document',
        boletoUrl: 'https://boletos.bdp.ro.gov.br/boleto.pdf',
        boletoMediaId: null,
      });
      mockIsFlagEnabled.mockResolvedValue({ enabled: true, status: 'enabled' });

      const db = makeDbForProcess({ ctx });
      const result = await resolveMediaHeader(
        db as never,
        ctx,
        makeMetaClient() as never,
        mockLogger,
      );

      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.reupload).toBeNull();
        const param = result.headerComponent.parameters[0];
        expect(param?.type).toBe('document');
        if (param?.type === 'document') {
          expect(param.document.link).toBe('https://boletos.bdp.ro.gov.br/boleto.pdf');
          expect(param.document.id).toBeUndefined();
        }
      }
      expect(mockUploadMedia).not.toHaveBeenCalled();
    });

    it('media_id expirado + boleto_url → re-upload, kind=ok com reupload info', async () => {
      const ctx = makeCtx({
        templateHeaderType: 'document',
        boletoMediaId: 'old-media-id',
        boletoMediaExpiresAt: new Date(Date.now() - 1000), // Expirado
        boletoUrl: 'https://boletos.bdp.ro.gov.br/boleto.pdf',
      });
      mockIsFlagEnabled.mockResolvedValue({ enabled: true, status: 'enabled' });

      // Mock fetch para download (100 bytes, sem content-length)
      mockFetch.mockResolvedValueOnce(makeFetchResponseWithBody(new Uint8Array(100)));

      // Mock uploadMedia
      mockUploadMedia.mockResolvedValueOnce({ mediaId: 'new-media-id-xyz' });

      const db = makeDbForProcess({ ctx });
      const result = await resolveMediaHeader(
        db as never,
        ctx,
        makeMetaClient() as never,
        mockLogger,
      );

      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.reupload).not.toBeNull();
        expect(result.reupload?.newMediaId).toBe('new-media-id-xyz');
        expect(result.reupload?.newExpiresAt).toBeInstanceOf(Date);
        const param = result.headerComponent.parameters[0];
        expect(param?.type).toBe('document');
        if (param?.type === 'document') {
          expect(param.document.id).toBe('new-media-id-xyz');
        }
      }
      expect(mockUploadMedia).toHaveBeenCalledOnce();
    });

    it('sem media_id e sem url → kind=missing', async () => {
      const ctx = makeCtx({
        templateHeaderType: 'document',
        boletoMediaId: null,
        boletoUrl: null,
      });
      mockIsFlagEnabled.mockResolvedValue({ enabled: true, status: 'enabled' });

      const db = makeDbForProcess({ ctx });
      const result = await resolveMediaHeader(
        db as never,
        ctx,
        makeMetaClient() as never,
        mockLogger,
      );

      expect(result.kind).toBe('missing');
    });

    // --- GAP-1: redirect:error ---

    it('GAP-1: redirect 3xx → resolveMediaHeader lança ExternalServiceError (não segue redirect)', async () => {
      const ctx = makeCtx({
        templateHeaderType: 'document',
        boletoMediaId: 'old-media-id',
        boletoMediaExpiresAt: new Date(Date.now() - 1000), // expirado → vai tentar re-upload
        boletoUrl: 'https://boletos.bdp.ro.gov.br/boleto.pdf',
      });
      mockIsFlagEnabled.mockResolvedValue({ enabled: true, status: 'enabled' });

      // fetch com redirect:'error' lança TypeError para respostas 3xx —
      // o ExternalServiceError é propagado sem ser engolido por resolveMediaHeader.
      mockFetch.mockRejectedValueOnce(
        Object.assign(new TypeError('redirect was not allowed'), { name: 'TypeError' }),
      );

      const db = makeDbForProcess({ ctx });
      await expect(
        resolveMediaHeader(db as never, ctx, makeMetaClient() as never, mockLogger),
      ).rejects.toBeInstanceOf(ExternalServiceError);
    });

    it('GAP-1: processCollectionJob com redirect → outcome=failed, sem envio Meta', async () => {
      // Testa o caminho completo: falha de rede no re-upload → job failed
      setFlagsAllOn(true);
      const ctx = makeCtx({
        templateHeaderType: 'document',
        boletoMediaId: 'expired-media',
        boletoMediaExpiresAt: new Date(Date.now() - 1000), // expirado
        boletoUrl: 'https://boletos.bdp.ro.gov.br/boleto.pdf',
      });
      const db = makeDbForProcess({ ctx, lockResult: [{ id: JOB_ID }] });
      const job = makeJob();

      // redirect:'error' lança TypeError — NÃO deve seguir nenhum redirect
      mockFetch.mockRejectedValueOnce(
        Object.assign(new TypeError('redirect was not allowed'), { name: 'TypeError' }),
      );

      const result = await processCollectionJob(
        db as never,
        makeMetaClient() as never,
        job,
        false,
        mockLogger,
      );

      // Falha de rede no re-upload → outcome failed, sem envio para Meta
      expect(result.outcome).toBe('failed');
      expect(mockSendTemplate).not.toHaveBeenCalled();
    });

    // --- GAP-2: cap de tamanho ---

    it('GAP-2: content-length acima do teto → rejeita antes de baixar o corpo', async () => {
      setFlagsAllOn(true);
      const ctx = makeCtx({
        templateHeaderType: 'document',
        boletoMediaId: 'expired-for-size-test',
        boletoMediaExpiresAt: new Date(Date.now() - 1000), // expirado → re-upload
        boletoUrl: 'https://boletos.bdp.ro.gov.br/boleto.pdf',
      });
      const db = makeDbForProcess({ ctx, lockResult: [{ id: JOB_ID }] });
      const job = makeJob();

      // 11 MB declarado no Content-Length — acima do teto de 10 MB
      const ELEVEN_MB = 11 * 1024 * 1024;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (name === 'content-length' ? String(ELEVEN_MB) : null),
        },
        body: null, // body nunca deve ser lido
        arrayBuffer: vi.fn().mockRejectedValue(new Error('não deveria ser chamado')),
      });

      const result = await processCollectionJob(
        db as never,
        makeMetaClient() as never,
        job,
        false,
        mockLogger,
      );

      // Deve falhar por tamanho, sem chamar a Meta
      expect(result.outcome).toBe('failed');
      expect(mockSendTemplate).not.toHaveBeenCalled();
      expect(mockUploadMedia).not.toHaveBeenCalled();
    });

    it('GAP-2: corpo acima do teto sem content-length confiável → rejeita via streaming', async () => {
      setFlagsAllOn(true);
      const ctx = makeCtx({
        templateHeaderType: 'document',
        boletoMediaId: 'expired-stream-test',
        boletoMediaExpiresAt: new Date(Date.now() - 1000), // expirado → re-upload
        boletoUrl: 'https://boletos.bdp.ro.gov.br/boleto.pdf',
      });
      const db = makeDbForProcess({ ctx, lockResult: [{ id: JOB_ID }] });
      const job = makeJob();

      // 11 MB em dois chunks — sem content-length (ou content-length omitido)
      const CHUNK_SIZE = 6 * 1024 * 1024; // 6 MB cada chunk → total 12 MB
      const chunk = new Uint8Array(CHUNK_SIZE);
      let callCount = 0;
      const mockReader = {
        read: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 1) return { done: false, value: chunk };
          if (callCount === 2) return { done: false, value: chunk }; // ultrapassa 10MB
          return { done: true, value: undefined };
        }),
        cancel: vi.fn().mockResolvedValue(undefined),
        releaseLock: vi.fn(),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: (_name: string) => null, // sem content-length
        },
        body: {
          getReader: () => mockReader,
        },
      });

      const result = await processCollectionJob(
        db as never,
        makeMetaClient() as never,
        job,
        false,
        mockLogger,
      );

      // Deve falhar por tamanho detectado durante streaming
      expect(result.outcome).toBe('failed');
      expect(mockSendTemplate).not.toHaveBeenCalled();
      expect(mockUploadMedia).not.toHaveBeenCalled();
      // O reader.cancel deve ter sido chamado para liberar o stream
      expect(mockReader.cancel).toHaveBeenCalledWith('boleto_too_large');
    });

    it('template image → header image por id', async () => {
      const ctx = makeCtx({
        templateHeaderType: 'image',
        boletoMediaId: 'img-media-id',
        boletoMediaExpiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      });
      mockIsFlagEnabled.mockResolvedValue({ enabled: true, status: 'enabled' });

      const db = makeDbForProcess({ ctx });
      const result = await resolveMediaHeader(
        db as never,
        ctx,
        makeMetaClient() as never,
        mockLogger,
      );

      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        const param = result.headerComponent.parameters[0];
        expect(param?.type).toBe('image');
        if (param?.type === 'image') {
          expect(param.image.id).toBe('img-media-id');
        }
      }
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

    // -----------------------------------------------------------------------
    // F5-S14: header de boleto em processCollectionJob
    // -----------------------------------------------------------------------

    it('F5-S14: boleto_missing → outcome=boleto_missing, failed terminal, sem chamar Meta', async () => {
      setFlagsAllOn(true);
      const ctx = makeCtx({
        templateHeaderType: 'document',
        boletoMediaId: null,
        boletoUrl: null,
      });
      const db = makeDbForProcess({ ctx });
      const job = makeJob();

      const result = await processCollectionJob(
        db as never,
        makeMetaClient() as never,
        job,
        false,
        mockLogger,
      );

      expect(result.outcome).toBe('boleto_missing');
      expect(result.terminal).toBe(true);
      expect(mockSendTemplate).not.toHaveBeenCalled();
      expect(mockEmit).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ eventName: 'billing.collection_failed' }),
      );
    });

    it('F5-S14: gate billing.boleto.enabled=off → envia só body (sem header)', async () => {
      // Flag boleto desligada — envia sem header de mídia
      mockIsFlagEnabled.mockImplementation((_db: unknown, flagKey: string) => {
        if (flagKey === 'billing.enabled')
          return Promise.resolve({ enabled: true, status: 'enabled' });
        if (flagKey === 'billing.sender.enabled')
          return Promise.resolve({ enabled: true, status: 'enabled' });
        // billing.boleto.enabled = disabled
        return Promise.resolve({ enabled: false, status: 'disabled' });
      });

      const ctx = makeCtx({
        templateHeaderType: 'document',
        boletoMediaId: 'media-abc',
        boletoMediaExpiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      });
      const db = makeDbForProcess({ ctx });
      const job = makeJob();
      mockSendTemplate.mockResolvedValueOnce({ wamid: 'wamid.NOHEADER' });

      const result = await processCollectionJob(
        db as never,
        makeMetaClient() as never,
        job,
        false,
        mockLogger,
      );

      expect(result.outcome).toBe('sent');
      // Verificar que sendTemplate foi chamado com apenas 1 componente (body, sem header)
      const callArgs = mockSendTemplate.mock.calls[0]?.[0] as { components: { type: string }[] };
      expect(callArgs?.components).toHaveLength(1);
      expect(callArgs?.components[0]?.type).toBe('body');
    });

    it('F5-S14: envio por media_id → header document id incluído no payload', async () => {
      setFlagsAllOn(true);
      const ctx = makeCtx({
        templateHeaderType: 'document',
        boletoMediaId: 'media-valid-123',
        boletoMediaExpiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      });
      const db = makeDbForProcess({ ctx });
      const job = makeJob();
      mockSendTemplate.mockResolvedValueOnce({ wamid: 'wamid.MEDIA' });

      const result = await processCollectionJob(
        db as never,
        makeMetaClient() as never,
        job,
        false,
        mockLogger,
      );

      expect(result.outcome).toBe('sent');
      const callArgs = mockSendTemplate.mock.calls[0]?.[0] as {
        components: Array<{
          type: string;
          parameters?: Array<{ type: string; document?: { id?: string; link?: string } }>;
        }>;
      };
      expect(callArgs?.components).toHaveLength(2);
      expect(callArgs?.components[0]?.type).toBe('header');
      const headerParam = callArgs?.components[0]?.parameters?.[0];
      expect(headerParam?.type).toBe('document');
      if (headerParam?.type === 'document') {
        expect(headerParam.document?.id).toBe('media-valid-123');
        expect(headerParam.document?.link).toBeUndefined();
      }
    });

    it('F5-S14: envio por link → header document link incluído no payload', async () => {
      setFlagsAllOn(true);
      const ctx = makeCtx({
        templateHeaderType: 'document',
        boletoMediaId: null,
        boletoUrl: 'https://boletos.bdp.ro.gov.br/boleto.pdf',
      });
      const db = makeDbForProcess({ ctx });
      const job = makeJob();
      mockSendTemplate.mockResolvedValueOnce({ wamid: 'wamid.LINK' });

      const result = await processCollectionJob(
        db as never,
        makeMetaClient() as never,
        job,
        false,
        mockLogger,
      );

      expect(result.outcome).toBe('sent');
      const callArgs = mockSendTemplate.mock.calls[0]?.[0] as {
        components: Array<{
          type: string;
          parameters?: Array<{ type: string; document?: { id?: string; link?: string } }>;
        }>;
      };
      const headerParam = callArgs?.components[0]?.parameters?.[0];
      expect(headerParam?.type).toBe('document');
      if (headerParam?.type === 'document') {
        expect(headerParam.document?.link).toBe('https://boletos.bdp.ro.gov.br/boleto.pdf');
        expect(headerParam.document?.id).toBeUndefined();
      }
    });

    it('F5-S14: re-upload em expiração → parcela atualizada na tx de sucesso', async () => {
      setFlagsAllOn(true);
      const ctx = makeCtx({
        templateHeaderType: 'document',
        boletoMediaId: 'old-media-expired',
        boletoMediaExpiresAt: new Date(Date.now() - 60_000), // expirado
        boletoUrl: 'https://boletos.bdp.ro.gov.br/boleto.pdf',
      });
      const db = makeDbForProcess({ ctx });
      const job = makeJob();

      // Mock download (200 bytes, sem content-length)
      mockFetch.mockResolvedValueOnce(makeFetchResponseWithBody(new Uint8Array(200)));
      // Mock uploadMedia
      mockUploadMedia.mockResolvedValueOnce({ mediaId: 'new-fresh-media-id' });
      // Mock sendTemplate
      mockSendTemplate.mockResolvedValueOnce({ wamid: 'wamid.REUPLOAD' });

      const result = await processCollectionJob(
        db as never,
        makeMetaClient() as never,
        job,
        false,
        mockLogger,
      );

      expect(result.outcome).toBe('sent');
      expect(result.boletoReupload).toBe(true);
      expect(mockUploadMedia).toHaveBeenCalledOnce();

      // Verificar que a tx de sucesso atualizou o payment_due (2+ updates na tx)
      const tx = (db as ReturnType<typeof makeDbForProcess>)._mockTx;
      expect(tx.update).toHaveBeenCalled();
      expect(tx.update.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('F5-S14: dry-run com template de mídia → sem re-upload, outcome=dry_run', async () => {
      setFlagsAllOn(true);
      const ctx = makeCtx({
        templateHeaderType: 'document',
        boletoMediaId: 'media-dry-run',
        boletoMediaExpiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      });
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
      expect(mockUploadMedia).not.toHaveBeenCalled();
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
