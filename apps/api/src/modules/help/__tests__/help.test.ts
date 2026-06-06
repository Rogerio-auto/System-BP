// help/__tests__/help.test.ts - Testes das rotas de telemetria (F10-S12).
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

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

vi.mock('../../../db/client.js', () => ({ db: {} }));

vi.mock('../../auth/middlewares/authenticate.js', () => ({
  authenticate: () => async () => {
    /* no-op */
  },
}));

const mockRecordView = vi.fn();
const mockRecordFeedback = vi.fn();
const mockGetPopular = vi.fn();

vi.mock('../repository.js', () => ({
  recordView: (...args: unknown[]) => mockRecordView(...args),
  recordFeedback: (...args: unknown[]) => mockRecordFeedback(...args),
  getPopular: (...args: unknown[]) => mockGetPopular(...args),
}));

const { helpRoutes } = await import('../routes.js');

const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
type UserPayload = { id: string; organizationId: string };

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.addHook('preHandler', async (request) => {
    (request as unknown as { user: UserPayload }).user = {
      id: USER_ID,
      organizationId: 'org-test',
    };
  });

  app.setErrorHandler(async (error, _request, reply) => {
    const { AppError } = await import('../../../shared/errors.js');
    if (error instanceof AppError) {
      await reply.status(error.statusCode).send({ error: error.code, message: error.message });
      return;
    }
    if (error !== null && typeof error === 'object' && 'validation' in error) {
      await reply.status(400).send({ error: 'VALIDATION_ERROR', message: 'Validation failed' });
      return;
    }
    await reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
  });

  await app.register(helpRoutes);
  await app.ready();
  return app;
}

describe('POST /api/help/views', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    mockRecordView.mockResolvedValue(undefined);
  });
  afterAll(async () => {
    await app.close();
  });
  afterEach(() => {
    vi.clearAllMocks();
    mockRecordView.mockResolvedValue(undefined);
  });

  it('1. registra view e retorna 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/help/views',
      payload: { slug: 'modulos/credito' },
    });
    expect(res.statusCode).toBe(201);
    expect(mockRecordView).toHaveBeenCalledWith(expect.anything(), USER_ID, 'modulos/credito');
  });

  it('2. segunda view imediata retorna 204 (rate-limit silencioso)', async () => {
    const slug = 'rate-limit-test-unique';
    const first = await app.inject({ method: 'POST', url: '/api/help/views', payload: { slug } });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({ method: 'POST', url: '/api/help/views', payload: { slug } });
    expect(second.statusCode).toBe(204);
    expect(mockRecordView).toHaveBeenCalledTimes(1);
  });

  it('3. slug invalido retorna 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/help/views',
      payload: { slug: 'Modulo Invalido!' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/help/feedback', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    mockRecordFeedback.mockResolvedValue({ id: 'feedback-uuid-1' });
  });
  afterAll(async () => {
    await app.close();
  });
  afterEach(() => {
    vi.clearAllMocks();
    mockRecordFeedback.mockResolvedValue({ id: 'feedback-uuid-1' });
  });

  it('4. registra feedback e retorna 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/help/feedback',
      payload: { slug: 'modulos/credito', helpful: true, comment: 'Muito util!' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ id: 'feedback-uuid-1' });
    expect(mockRecordFeedback).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      expect.objectContaining({ slug: 'modulos/credito', helpful: true }),
    );
  });

  it('5. comment > 2000 chars retorna 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/help/feedback',
      payload: { slug: 'modulos/credito', helpful: false, comment: 'x'.repeat(2001) },
    });
    expect(res.statusCode).toBe(400);
  });

  it('6. slug invalido retorna 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/help/feedback',
      payload: { slug: '../etc/passwd', helpful: true },
    });
    expect(res.statusCode).toBe(400);
  });

  it('10. comment com PII aceito - redact no pino nao no handler', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/help/feedback',
      payload: { slug: 'modulos/credito', helpful: true, comment: 'CPF: 123.456.789-00' },
    });
    expect(res.statusCode).toBe(201);
  });
});

describe('GET /api/help/popular', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('7. retorna lista com period_days=30 e cached=false', async () => {
    mockGetPopular.mockResolvedValue([
      { slug: 'modulos/credito', count: 150 },
      { slug: 'intro', count: 80 },
    ]);
    const res = await app.inject({ method: 'GET', url: '/api/help/popular?limit=10' });
    expect(res.statusCode).toBe(200);
    type Body = {
      data: Array<{ slug: string; count: number }>;
      period_days: number;
      cached: boolean;
    };
    const body = res.json() as Body;
    expect(body.data[0]!.count).toBe(150);
    expect(body.period_days).toBe(30);
    expect(body.cached).toBe(false);
  });

  it('8. cache hit na segunda chamada com mesmo limit', async () => {
    mockGetPopular.mockResolvedValue([]);
    const res = await app.inject({ method: 'GET', url: '/api/help/popular?limit=10' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { cached: boolean }).cached).toBe(true);
    expect(mockGetPopular).not.toHaveBeenCalled();
  });

  it('9. limit=5 faz miss de cache e chama repository', async () => {
    mockGetPopular.mockResolvedValue([
      { slug: 'a', count: 10 },
      { slug: 'b', count: 8 },
    ]);
    const res = await app.inject({ method: 'GET', url: '/api/help/popular?limit=5' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: unknown[]; cached: boolean };
    expect(body.cached).toBe(false);
    expect(mockGetPopular).toHaveBeenCalledWith(expect.anything(), 5, expect.any(Date));
  });
});
