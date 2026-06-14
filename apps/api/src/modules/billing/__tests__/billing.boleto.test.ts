// =============================================================================
// billing/billing.boleto.test.ts — Testes de integração dos endpoints de boleto (F5-S13).
//
// Estratégia: sobe Fastify com billingRoutes, mocka authenticate/authorize,
// mocka featureGate (habilitada), mocka service.
//
// Cobre:
//   1.  POST  /boleto (modo referência JSON) → 200 BoletoResponse
//   2.  POST  /boleto (modo upload multipart) → 200 BoletoResponse
//   3.  POST  /boleto sem Idempotency-Key → 400
//   4.  POST  /boleto sem billing:boleto:write → 403 RBAC
//   5.  POST  /boleto com gate disabled → 403 FeatureDisabledError
//   6.  POST  /boleto referência body inválido (sem campos) → 400
//   7.  DELETE /boleto → 200 sem boleto
//   8.  DELETE /boleto sem billing:boleto:write → 403 RBAC
//   9.  POST  /boleto multipart sem campo 'file' → 400
//   10. Sem auth → 401
// =============================================================================
import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { billingRoutes } from '../routes.js';

// ---------------------------------------------------------------------------
// Mock pg
// ---------------------------------------------------------------------------
vi.mock('pg', () => {
  const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const MockPool = vi.fn().mockImplementation(() => ({
    query: mockQuery,
    connect: vi.fn().mockResolvedValue({ query: mockQuery, release: vi.fn() }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  return { Pool: MockPool, default: { Pool: MockPool } };
});

// ---------------------------------------------------------------------------
// Mock authenticate / authorize
// ---------------------------------------------------------------------------
vi.mock('../../auth/middlewares/authenticate.js', () => ({
  authenticate: () => async () => {
    // no-op: request.user injetado pelo addHook global
  },
}));

vi.mock('../../auth/middlewares/authorize.js', () => ({
  authorize:
    (opts: { permissions: string[] }) =>
    async (request: { user?: { permissions: string[] } }, _reply: unknown) => {
      const { ForbiddenError, UnauthorizedError } = await import('../../../shared/errors.js');
      if (!request.user) throw new UnauthorizedError('Não autenticado');
      const missing = opts.permissions.filter((p) => !request.user!.permissions.includes(p));
      if (missing.length > 0) throw new ForbiddenError('Acesso negado: permissões insuficientes');
    },
}));

// ---------------------------------------------------------------------------
// Mock featureGate (F5-S13)
// featureGateOverride: controla comportamento do gate em testes individuais.
// 'enabled' (default) → gate libera acesso.
// 'disabled'          → gate lança FeatureDisabledError(403).
// ---------------------------------------------------------------------------
let featureGateOverride: 'enabled' | 'disabled' = 'enabled';

vi.mock('../../../plugins/featureGate.js', () => ({
  featureGate: (key: string) => {
    return async () => {
      if (featureGateOverride === 'disabled') {
        const { FeatureDisabledError } = await import('../../../shared/errors.js');
        throw new FeatureDisabledError(key);
      }
    };
  },
  isFlagEnabled: vi.fn().mockResolvedValue(true),
}));

// ---------------------------------------------------------------------------
// Mock db/client
// ---------------------------------------------------------------------------
vi.mock('../../../db/client.js', () => ({
  db: {},
}));

// ---------------------------------------------------------------------------
// Mock service
// ---------------------------------------------------------------------------
const mockAttachBoletoUploadService = vi.fn();
const mockAttachBoletoReferenceService = vi.fn();
const mockRemoveBoletoService = vi.fn();
// Mocks dos services existentes
const mockListDuesService = vi.fn();
const mockMarkPaidService = vi.fn();
const mockRenegotiateService = vi.fn();
const mockListRulesService = vi.fn();
const mockCreateRuleService = vi.fn();
const mockUpdateRuleService = vi.fn();
const mockListJobsService = vi.fn();
const mockCancelJobService = vi.fn();

vi.mock('../service.js', () => ({
  attachBoletoUploadService: (...args: unknown[]) => mockAttachBoletoUploadService(...args),
  attachBoletoReferenceService: (...args: unknown[]) => mockAttachBoletoReferenceService(...args),
  removeBoletoService: (...args: unknown[]) => mockRemoveBoletoService(...args),
  listDuesService: (...args: unknown[]) => mockListDuesService(...args),
  markPaidService: (...args: unknown[]) => mockMarkPaidService(...args),
  renegotiateService: (...args: unknown[]) => mockRenegotiateService(...args),
  listRulesService: (...args: unknown[]) => mockListRulesService(...args),
  createRuleService: (...args: unknown[]) => mockCreateRuleService(...args),
  updateRuleService: (...args: unknown[]) => mockUpdateRuleService(...args),
  listJobsService: (...args: unknown[]) => mockListJobsService(...args),
  cancelJobService: (...args: unknown[]) => mockCancelJobService(...args),
}));

// Mock env para BOLETO_ALLOWED_HOSTS
vi.mock('../../../config/env.js', () => ({
  env: {
    BOLETO_ALLOWED_HOSTS: ['boletos.bdp.ro.gov.br'],
    META_WHATSAPP_ACCESS_TOKEN: 'test-token',
    META_WHATSAPP_PHONE_NUMBER_ID: 'test-phone-id',
    LGPD_DEDUPE_PEPPER: 'test-pepper-min-32-chars-long-enough',
  },
}));

// ---------------------------------------------------------------------------
// Constantes de UUID
// ---------------------------------------------------------------------------
const DUE_ID = 'b0000001-0000-0000-0000-000000000001';
const ORG_ID = 'b0000002-0000-0000-0000-000000000002';
const USER_ID = 'b0000003-0000-0000-0000-000000000003';

const TEST_USER_WITH_BOLETO = {
  id: USER_ID,
  organizationId: ORG_ID,
  permissions: ['billing:boleto:write'],
  cityScopeIds: null as string[] | null,
};

const SAMPLE_BOLETO_RESPONSE = {
  payment_due_id: DUE_ID,
  boleto_url: null,
  boleto_media_id: 'meta-media-id-123',
  boleto_media_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  boleto_digitable_line: null,
  pix_copia_cola: null,
  boleto_filename: 'boleto-parcela-1.pdf',
  boleto_attached_at: new Date().toISOString(),
  has_boleto: true,
};

const SAMPLE_BOLETO_EMPTY = {
  payment_due_id: DUE_ID,
  boleto_url: null,
  boleto_media_id: null,
  boleto_media_expires_at: null,
  boleto_digitable_line: null,
  pix_copia_cola: null,
  boleto_filename: null,
  boleto_attached_at: null,
  has_boleto: false,
};

// ---------------------------------------------------------------------------
// App builders
// ---------------------------------------------------------------------------

function buildApp(userOverrides?: Partial<typeof TEST_USER_WITH_BOLETO>): FastifyInstance {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const user = { ...TEST_USER_WITH_BOLETO, ...userOverrides };

  app.addHook('preHandler', async (request) => {
    (request as { user?: typeof TEST_USER_WITH_BOLETO }).user = user;
  });

  void app.register(multipart);
  void app.register(billingRoutes);

  app.setErrorHandler((error, _req, reply) => {
    const statusCode =
      error !== null &&
      typeof error === 'object' &&
      'statusCode' in error &&
      typeof (error as { statusCode: unknown }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500;
    const msg = error instanceof Error ? error.message : String(error);
    return reply.status(statusCode).send({ error: 'TEST_ERROR', message: msg });
  });

  return app;
}

function buildAppNoAuth(): FastifyInstance {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  void app.register(multipart);
  void app.register(billingRoutes);
  app.setErrorHandler((error, _req, reply) => {
    const statusCode =
      error !== null &&
      typeof error === 'object' &&
      'statusCode' in error &&
      typeof (error as { statusCode: unknown }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500;
    const msg = error instanceof Error ? error.message : String(error);
    return reply.status(statusCode).send({ error: 'TEST_ERROR', message: msg });
  });
  return app;
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe('POST /api/billing/payment-dues/:id/boleto — modo referência', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    featureGateOverride = 'enabled';
  });

  it('1. POST modo referência → 200 BoletoResponse', async () => {
    mockAttachBoletoReferenceService.mockResolvedValueOnce(SAMPLE_BOLETO_RESPONSE);

    const res = await app.inject({
      method: 'POST',
      url: `/api/billing/payment-dues/${DUE_ID}/boleto`,
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'c0000001-0000-0000-0000-000000000001',
      },
      body: JSON.stringify({
        boletoUrl: 'https://boletos.bdp.ro.gov.br/boleto-123.pdf',
        digitableLine: '12345.67890 12345.678901 12345.678901 1 23450000012000',
      }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as typeof SAMPLE_BOLETO_RESPONSE;
    expect(body.payment_due_id).toBe(DUE_ID);
    expect(mockAttachBoletoReferenceService).toHaveBeenCalledOnce();
  });

  it('3. POST sem Idempotency-Key → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/billing/payment-dues/${DUE_ID}/boleto`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ digitableLine: '123' }),
    });

    expect(res.statusCode).toBe(400);
  });

  it('4. POST sem billing:boleto:write → 403', async () => {
    const appNoPerm = buildApp({ permissions: ['billing:read'] });
    await appNoPerm.ready();

    const res = await appNoPerm.inject({
      method: 'POST',
      url: `/api/billing/payment-dues/${DUE_ID}/boleto`,
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'c0000002-0000-0000-0000-000000000002',
      },
      body: JSON.stringify({ digitableLine: '123' }),
    });

    expect(res.statusCode).toBe(403);
    await appNoPerm.close();
  });

  it('5. POST com gate disabled → 403', async () => {
    featureGateOverride = 'disabled';

    const res = await app.inject({
      method: 'POST',
      url: `/api/billing/payment-dues/${DUE_ID}/boleto`,
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'c0000003-0000-0000-0000-000000000003',
      },
      body: JSON.stringify({ digitableLine: '123' }),
    });

    expect(res.statusCode).toBe(403);
  });

  it('6. POST referência body inválido (sem campos) → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/billing/payment-dues/${DUE_ID}/boleto`,
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'c0000004-0000-0000-0000-000000000004',
      },
      body: JSON.stringify({}),
    });

    // Zod refine: ao menos um dos campos obrigatório
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/billing/payment-dues/:id/boleto — modo upload', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    featureGateOverride = 'enabled';
  });

  it('2. POST modo upload multipart → 200 BoletoResponse', async () => {
    mockAttachBoletoUploadService.mockResolvedValueOnce(SAMPLE_BOLETO_RESPONSE);

    // Criar um multipart/form-data manualmente
    const boundary = 'test-boundary-123';
    const fileContent = Buffer.from('%PDF-1.4 test pdf content');
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from(`Content-Disposition: form-data; name="file"; filename="boleto.pdf"\r\n`),
      Buffer.from(`Content-Type: application/pdf\r\n\r\n`),
      fileContent,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const res = await app.inject({
      method: 'POST',
      url: `/api/billing/payment-dues/${DUE_ID}/boleto`,
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'idempotency-key': 'c0000005-0000-0000-0000-000000000005',
      },
      body,
    });

    expect(res.statusCode).toBe(200);
    expect(mockAttachBoletoUploadService).toHaveBeenCalledOnce();
  });

  it('9. POST multipart sem campo file → 400', async () => {
    const boundary = 'test-boundary-456';
    // Multipart sem campo 'file' — campo desconhecido ignorado
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from(`Content-Disposition: form-data; name="unknown"\r\n\r\n`),
      Buffer.from(`valor`),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const res = await app.inject({
      method: 'POST',
      url: `/api/billing/payment-dues/${DUE_ID}/boleto`,
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'idempotency-key': 'c0000006-0000-0000-0000-000000000006',
      },
      body,
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('DELETE /api/billing/payment-dues/:id/boleto', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    featureGateOverride = 'enabled';
  });

  it('7. DELETE → 200 BoletoResponse sem boleto', async () => {
    mockRemoveBoletoService.mockResolvedValueOnce(SAMPLE_BOLETO_EMPTY);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/billing/payment-dues/${DUE_ID}/boleto`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as typeof SAMPLE_BOLETO_EMPTY;
    expect(body.has_boleto).toBe(false);
    expect(body.payment_due_id).toBe(DUE_ID);
    expect(mockRemoveBoletoService).toHaveBeenCalledOnce();
  });

  it('8. DELETE sem billing:boleto:write → 403', async () => {
    const appNoPerm = buildApp({ permissions: ['billing:read'] });
    await appNoPerm.ready();

    const res = await appNoPerm.inject({
      method: 'DELETE',
      url: `/api/billing/payment-dues/${DUE_ID}/boleto`,
    });

    expect(res.statusCode).toBe(403);
    await appNoPerm.close();
  });
});

describe('sem auth', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildAppNoAuth();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('10. POST sem auth → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/billing/payment-dues/${DUE_ID}/boleto`,
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'c0000007-0000-0000-0000-000000000007',
      },
      body: JSON.stringify({ digitableLine: '123' }),
    });

    expect(res.statusCode).toBe(401);
  });
});
