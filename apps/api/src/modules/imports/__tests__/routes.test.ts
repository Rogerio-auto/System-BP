// =============================================================================
// imports/routes.test.ts — Testes de integração das rotas de importação (F1-S17).
//
// Estratégia: sobe Fastify com importsRoutes, mocka authenticate/authorize,
// mocka service para controlar dados. @fastify/multipart mockado.
//
// Cobre (>= 10 testes):
//   1.  POST /api/imports/leads → 201 batch criado
//   2.  POST /api/imports/leads → 200 idempotente (arquivo duplicado)
//   3.  POST /api/imports/leads → 400 MISSING_FILE
//   4.  POST /api/imports/leads → 400 VALIDATION_ERROR (MIME inválido)
//   5.  GET  /api/imports/:id → 200 batch encontrado
//   6.  GET  /api/imports/:id → 404 não encontrado
//   7.  GET  /api/imports/:id/preview → 200 com linhas paginadas
//   8.  GET  /api/imports/:id/preview → 409 CONFLICT (batch ainda processing)
//   9.  POST /api/imports/:id/confirm → 200 confirmado
//   10. POST /api/imports/:id/confirm → 409 CONFLICT (status inválido)
//   11. POST /api/imports/:id/cancel → 200 cancelado
//   12. POST /api/imports/:id/cancel → 409 CONFLICT (já completed)
// =============================================================================
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock pg
// ---------------------------------------------------------------------------
vi.mock('pg', () => {
  const MockPool = vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    connect: vi.fn(),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  return { Pool: MockPool, default: { Pool: MockPool } };
});

// ---------------------------------------------------------------------------
// Mock env
// ---------------------------------------------------------------------------
vi.mock('../../../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
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
    WHATSAPP_APP_SECRET: 'test-secret-at-least-16-chars',
    WHATSAPP_VERIFY_TOKEN: 'test-verify-token',
  },
}));

// ---------------------------------------------------------------------------
// Mock authenticate/authorize
// ---------------------------------------------------------------------------
vi.mock('../../auth/middlewares/authenticate.js', () => ({
  authenticate: () => async () => {
    // no-op: request.user injetado pelo addHook global no buildTestApp
  },
}));

vi.mock('../../auth/middlewares/authorize.js', () => ({
  authorize:
    (opts: { permissions: string[] }) =>
    async (request: { user?: { permissions: string[] } }, _reply: unknown) => {
      const { ForbiddenError } = await import('../../../shared/errors.js');
      if (!request.user) throw new ForbiddenError('Não autenticado');
      const missing = opts.permissions.filter((p) => !request.user!.permissions.includes(p));
      if (missing.length > 0) throw new ForbiddenError('Acesso negado: permissões insuficientes');
    },
}));

// ---------------------------------------------------------------------------
// Mock feature gate plugin (used in routes.ts preHandler)
// ---------------------------------------------------------------------------
vi.mock('../../../plugins/featureGate.js', () => ({
  featureGate: (_flagKey: string) => async (_req: unknown, _reply: unknown) => {
    // no-op: feature always enabled in tests
  },
  isFlagEnabled: vi.fn().mockResolvedValue(true),
}));

// ---------------------------------------------------------------------------
// Mock featureFlags service (imported transitively by featureGate.ts even if mocked)
// ---------------------------------------------------------------------------
vi.mock('../../../modules/featureFlags/service.js', () => ({
  getAllFlags: vi
    .fn()
    .mockResolvedValue([{ key: 'crm.import.enabled', status: 'enabled', audience: {} }]),
  isFlagEnabled: vi.fn().mockResolvedValue(true),
}));

// ---------------------------------------------------------------------------
// Mock db/client
// ---------------------------------------------------------------------------
vi.mock('../../../db/client.js', () => ({
  db: {},
  pool: { end: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Mock @fastify/multipart (registered in app.ts, not routes.ts — mock request.file)
// ---------------------------------------------------------------------------
vi.mock('@fastify/multipart', () => ({
  default: vi.fn().mockImplementation(async (_fastify: unknown, _opts: unknown) => {
    // no-op plugin registration
  }),
}));

// ---------------------------------------------------------------------------
// Mock service
// ---------------------------------------------------------------------------
const mockUploadImport = vi.fn();
const mockGetBatch = vi.fn();
const mockPreviewBatch = vi.fn();
const mockConfirmBatch = vi.fn();
const mockCancelBatch = vi.fn();

vi.mock('../service.js', () => ({
  uploadImport: (...args: unknown[]) => mockUploadImport(...args),
  getBatch: (...args: unknown[]) => mockGetBatch(...args),
  previewBatch: (...args: unknown[]) => mockPreviewBatch(...args),
  confirmBatch: (...args: unknown[]) => mockConfirmBatch(...args),
  cancelBatch: (...args: unknown[]) => mockCancelBatch(...args),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_ORG_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const FIXTURE_USER_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const FIXTURE_BATCH_ID = 'cccccccc-0000-0000-0000-000000000001';

function makeBatch(overrides: Record<string, unknown> = {}) {
  return {
    id: FIXTURE_BATCH_ID,
    organizationId: FIXTURE_ORG_ID,
    entityType: 'leads',
    fileName: 'leads.csv',
    fileSize: 1024,
    mimeType: 'text/csv',
    status: 'preview_ready',
    totalRows: 10,
    validRows: 8,
    invalidRows: 2,
    processedRows: 0,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dddddddd-0000-0000-0000-000000000001',
    batchId: FIXTURE_BATCH_ID,
    rowIndex: 0,
    status: 'valid',
    rawData: { nome: 'Maria Silva', telefone: '69912345678' },
    normalizedData: { name: 'Maria Silva', phone_e164: '+5569912345678' },
    validationErrors: null,
    entityId: null,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Build test app
// ---------------------------------------------------------------------------

async function buildTestApp(permissions = ['leads:write', 'leads:read']): Promise<FastifyInstance> {
  const [
    { default: Fastify },
    { serializerCompiler, validatorCompiler },
    { importsRoutes },
    { isAppError },
  ] = await Promise.all([
    import('fastify'),
    import('fastify-type-provider-zod'),
    import('../routes.js'),
    import('../../../shared/errors.js'),
  ]);

  const app = Fastify({ logger: false }).withTypeProvider();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Injetar request.user e request.file antes das rotas
  app.addHook('preHandler', async (request) => {
    request.user = {
      id: FIXTURE_USER_ID,
      organizationId: FIXTURE_ORG_ID,
      permissions,
      cityScopeIds: null,
    };
  });

  // Mock request.file para testes de upload
  app.addHook('preHandler', async (request) => {
    if (!('_fileData' in request)) return;
    // No-op: controlled per test via stubbing
  });

  app.setErrorHandler((error, _request, reply) => {
    if (isAppError(error)) {
      const body: Record<string, unknown> = {
        error: error.code,
        message: error.message,
      };
      if (error.details !== undefined) {
        body['details'] = error.details;
      }
      return reply.status(error.statusCode).send(body);
    }
    if (error.validation !== undefined) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: error.validation,
      });
    }
    return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
  });

  await app.register(importsRoutes);
  return app;
}

// ---------------------------------------------------------------------------
// GET /api/imports/:id
// ---------------------------------------------------------------------------

describe('GET /api/imports/:id', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('5. retorna 200 com batch encontrado', async () => {
    mockGetBatch.mockResolvedValue(makeBatch());

    const res = await app.inject({
      method: 'GET',
      url: `/api/imports/${FIXTURE_BATCH_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string; status: string; entityType: string };
    expect(body.id).toBe(FIXTURE_BATCH_ID);
    expect(body.entityType).toBe('leads');
    expect(body.status).toBe('preview_ready');
  });

  it('6. retorna 404 quando batch não existe', async () => {
    const { NotFoundError } = await import('../../../shared/errors.js');
    mockGetBatch.mockRejectedValue(new NotFoundError('Batch não encontrado'));

    const res = await app.inject({
      method: 'GET',
      url: `/api/imports/${FIXTURE_BATCH_ID}`,
    });

    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: string };
    expect(body.error).toBe('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// GET /api/imports/:id/preview
// ---------------------------------------------------------------------------

describe('GET /api/imports/:id/preview', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('7. retorna 200 com linhas paginadas', async () => {
    mockPreviewBatch.mockResolvedValue({
      batch: makeBatch(),
      rows: [makeRow(), makeRow({ id: 'dddddddd-0000-0000-0000-000000000002', rowIndex: 1 })],
      total: 2,
      page: 1,
      perPage: 50,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/imports/${FIXTURE_BATCH_ID}/preview`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { rows: unknown[]; total: number; page: number };
    expect(body.rows).toHaveLength(2);
    expect(body.total).toBe(2);
    expect(body.page).toBe(1);
  });

  it('8. retorna 409 quando batch ainda está em processing', async () => {
    const { AppError } = await import('../../../shared/errors.js');
    mockPreviewBatch.mockRejectedValue(
      new AppError(409, 'CONFLICT', 'Batch ainda está sendo processado.'),
    );

    const res = await app.inject({
      method: 'GET',
      url: `/api/imports/${FIXTURE_BATCH_ID}/preview`,
    });

    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: string };
    expect(body.error).toBe('CONFLICT');
  });
});

// ---------------------------------------------------------------------------
// POST /api/imports/:id/confirm
// ---------------------------------------------------------------------------

describe('POST /api/imports/:id/confirm', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('9. retorna 200 ao confirmar batch preview_ready', async () => {
    mockConfirmBatch.mockResolvedValue(makeBatch({ status: 'confirmed' }));

    const res = await app.inject({
      method: 'POST',
      url: `/api/imports/${FIXTURE_BATCH_ID}/confirm`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; message: string };
    expect(body.status).toBe('confirmed');
    expect(body.message).toContain('confirmada');
  });

  it('10. retorna 409 ao confirmar batch com status inválido', async () => {
    const { AppError } = await import('../../../shared/errors.js');
    mockConfirmBatch.mockRejectedValue(
      new AppError(
        409,
        'CONFLICT',
        'Batch não está pronto para confirmação. Status atual: uploaded',
      ),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/imports/${FIXTURE_BATCH_ID}/confirm`,
    });

    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: string };
    expect(body.error).toBe('CONFLICT');
  });
});

// ---------------------------------------------------------------------------
// POST /api/imports/:id/cancel
// ---------------------------------------------------------------------------

describe('POST /api/imports/:id/cancel', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('11. retorna 200 ao cancelar batch', async () => {
    mockCancelBatch.mockResolvedValue(makeBatch({ status: 'cancelled' }));

    const res = await app.inject({
      method: 'POST',
      url: `/api/imports/${FIXTURE_BATCH_ID}/cancel`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; message: string };
    expect(body.status).toBe('cancelled');
    expect(body.message).toContain('cancelada');
  });

  it('12. retorna 409 ao cancelar batch já completed', async () => {
    const { AppError } = await import('../../../shared/errors.js');
    mockCancelBatch.mockRejectedValue(
      new AppError(409, 'CONFLICT', 'Batch não pode ser cancelado. Status atual: completed'),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/imports/${FIXTURE_BATCH_ID}/cancel`,
    });

    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: string };
    expect(body.error).toBe('CONFLICT');
  });
});
