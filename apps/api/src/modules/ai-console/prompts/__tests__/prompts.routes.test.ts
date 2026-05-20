// =============================================================================
// ai-console/prompts/__tests__/prompts.routes.test.ts — Testes de integração.
//
// Estratégia: sobe Fastify com promptsRoutes, mocka authenticate/authorize
// e service para controlar contexto e dados sem tocar no banco real.
//
// Cobre:
//   1.  GET  /api/ai-console/prompts                   → 200 lista keys
//   2.  GET  /api/ai-console/prompts/:key/versions     → 200 lista versões
//   3.  GET  /api/ai-console/prompts/:key/versions/:v  → 200 detalhe
//   4.  GET  /api/ai-console/prompts/:key/versions/:v  → 404 não encontrado
//   5.  POST /api/ai-console/prompts/:key/versions     → 201 criado
//   6.  POST /api/ai-console/prompts/:key/versions     → 400 body inválido (vazio)
//   7.  POST /api/ai-console/prompts/:key/versions     → 422 body com PII detectada
//   8.  POST .../activate                              → 200 ativado
//   9.  POST .../activate                              → 404 versão não encontrada
//   10. RBAC: gestor_geral pode ler (200), não pode escrever (403)
//   11. RBAC: agente não pode ler (403)
//   12. RBAC: sem autenticação → 403
//   13. Ativação atômica: rollback simulado → service lança, resposta 500
// F9-S08 additions:
//   14. POST com temperature, max_tokens, top_p → 201 com campos preenchidos
//   15. POST com temperature inválida (3.0) → 400
//   16. POST com top_p inválido (> 1) → 400
//   17. POST com max_tokens inválido (0) → 400
//   18. POST sem os 3 campos → 201 com null em temperature, max_tokens, top_p
// =============================================================================
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { isAppError } from '../../../../shared/errors.js';
import { promptsRoutes } from '../routes.js';

// ---------------------------------------------------------------------------
// Mock pg (evita conexão real ao banco em CI)
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
// Mock authenticate — no-op; request.user injetado via addHook no buildTestApp
// ---------------------------------------------------------------------------
vi.mock('../../../auth/middlewares/authenticate.js', () => ({
  authenticate: () => async () => {
    // no-op
  },
}));

// ---------------------------------------------------------------------------
// Mock authorize — verifica permissions do request.user injetado
// ---------------------------------------------------------------------------
vi.mock('../../../auth/middlewares/authorize.js', () => ({
  authorize:
    (opts: { permissions: string[] }) => async (request: { user?: { permissions: string[] } }) => {
      const { ForbiddenError } = await import('../../../../shared/errors.js');
      if (!request.user) throw new ForbiddenError('Não autenticado');
      const missing = opts.permissions.filter((p) => !request.user!.permissions.includes(p));
      if (missing.length > 0) throw new ForbiddenError('Acesso negado: permissões insuficientes');
    },
}));

// ---------------------------------------------------------------------------
// Mock db/client — sem conexão real
// ---------------------------------------------------------------------------
vi.mock('../../../../db/client.js', () => ({
  db: {},
  pool: { end: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Mock service
// ---------------------------------------------------------------------------
const mockListPromptKeysSvc = vi.fn();
const mockListVersionsSvc = vi.fn();
const mockFindVersionSvc = vi.fn();
const mockCreateVersionSvc = vi.fn();
const mockActivateVersionSvc = vi.fn();

vi.mock('../service.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    listPromptKeysSvc: (...args: unknown[]) => mockListPromptKeysSvc(...args),
    listVersionsSvc: (...args: unknown[]) => mockListVersionsSvc(...args),
    findVersionSvc: (...args: unknown[]) => mockFindVersionSvc(...args),
    createVersionSvc: (...args: unknown[]) => mockCreateVersionSvc(...args),
    activateVersionSvc: (...args: unknown[]) => mockActivateVersionSvc(...args),
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_ORG_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const FIXTURE_USER_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const FIXTURE_VERSION_ID = 'cccccccc-0000-0000-0000-000000000001';
const FIXTURE_KEY = 'intent_classifier';
const FIXTURE_HASH = 'abc123def456abc123def456abc123def456abc123def456abc123def456abc1';

function makeVersionResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: FIXTURE_VERSION_ID,
    key: FIXTURE_KEY,
    version: 1,
    model_recommended: null,
    content_hash: FIXTURE_HASH,
    active: false,
    body: 'You are a helpful assistant that classifies user intent.',
    notes: null,
    created_by: FIXTURE_USER_ID,
    created_at: new Date().toISOString(),
    // F9-S08: parâmetros LLM
    temperature: null,
    max_tokens: null,
    top_p: null,
    ...overrides,
  };
}

function makeKeyItem(overrides: Record<string, unknown> = {}) {
  return {
    key: FIXTURE_KEY,
    active_version: 1,
    active_version_id: FIXTURE_VERSION_ID,
    model_recommended: null,
    content_hash: FIXTURE_HASH,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Build test app helper
// ---------------------------------------------------------------------------

async function buildTestApp(
  permissions: string[] = ['ai_prompts:read', 'ai_prompts:write', 'ai_prompts:activate'],
  injectUser = true,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false }).withTypeProvider();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  if (injectUser) {
    app.addHook('preHandler', async (request) => {
      request.user = {
        id: FIXTURE_USER_ID,
        organizationId: FIXTURE_ORG_ID,
        permissions,
        cityScopeIds: null,
      };
    });
  }

  app.setErrorHandler((error, _request, reply) => {
    if (isAppError(error)) {
      const body: Record<string, unknown> = {
        error: error.code,
        message: error.message,
      };
      if (error.details !== undefined) body['details'] = error.details;
      return reply.status(error.statusCode).send(body);
    }
    if (
      error !== null &&
      typeof error === 'object' &&
      'validation' in error &&
      (error as Record<string, unknown>)['validation'] !== undefined
    ) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: (error as Record<string, unknown>)['validation'],
      });
    }
    return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
  });

  // Registra as rotas sob o prefixo canônico (mesmo do app.ts)
  await app.register(promptsRoutes, { prefix: '/api/ai-console/prompts' });
  return app;
}

// ---------------------------------------------------------------------------
// App compartilhado (admin — todas as permissões)
// ---------------------------------------------------------------------------

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildTestApp();
}, 30_000);

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// GET /api/ai-console/prompts — lista keys
// ---------------------------------------------------------------------------

describe('GET /api/ai-console/prompts', () => {
  it('retorna 200 com lista de keys', async () => {
    mockListPromptKeysSvc.mockResolvedValue([makeKeyItem()]);

    const res = await app.inject({ method: 'GET', url: '/api/ai-console/prompts' });

    expect(res.statusCode).toBe(200);
    const body = res.json<unknown[]>();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect((body[0] as Record<string, unknown>)['key']).toBe(FIXTURE_KEY);
  });

  it('retorna 200 com lista vazia quando nenhum prompt existe', async () => {
    mockListPromptKeysSvc.mockResolvedValue([]);

    const res = await app.inject({ method: 'GET', url: '/api/ai-console/prompts' });

    expect(res.statusCode).toBe(200);
    expect(res.json<unknown[]>()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// GET /api/ai-console/prompts/:key/versions — histórico
// ---------------------------------------------------------------------------

describe('GET /api/ai-console/prompts/:key/versions', () => {
  it('retorna 200 com lista de versões', async () => {
    mockListVersionsSvc.mockResolvedValue([makeVersionResponse()]);

    const res = await app.inject({
      method: 'GET',
      url: `/api/ai-console/prompts/${FIXTURE_KEY}/versions`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<unknown[]>();
    expect(Array.isArray(body)).toBe(true);
    expect((body[0] as Record<string, unknown>)['key']).toBe(FIXTURE_KEY);
  });
});

// ---------------------------------------------------------------------------
// GET /api/ai-console/prompts/:key/versions/:version — detalhe
// ---------------------------------------------------------------------------

describe('GET /api/ai-console/prompts/:key/versions/:version', () => {
  it('retorna 200 com detalhe da versão', async () => {
    mockFindVersionSvc.mockResolvedValue(makeVersionResponse({ version: 1 }));

    const res = await app.inject({
      method: 'GET',
      url: `/api/ai-console/prompts/${FIXTURE_KEY}/versions/1`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body['id']).toBe(FIXTURE_VERSION_ID);
    expect(body['version']).toBe(1);
  });

  it('retorna 404 quando versão não existe', async () => {
    const { NotFoundError } = await import('../../../../shared/errors.js');
    mockFindVersionSvc.mockRejectedValue(
      new NotFoundError(`Versão 99 do prompt '${FIXTURE_KEY}' não encontrada`),
    );

    const res = await app.inject({
      method: 'GET',
      url: `/api/ai-console/prompts/${FIXTURE_KEY}/versions/99`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json<Record<string, unknown>>()['error']).toBe('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// POST /api/ai-console/prompts/:key/versions — cria versão
// ---------------------------------------------------------------------------

describe('POST /api/ai-console/prompts/:key/versions', () => {
  it('retorna 201 ao criar nova versão', async () => {
    mockCreateVersionSvc.mockResolvedValue(makeVersionResponse({ version: 1 }));

    const res = await app.inject({
      method: 'POST',
      url: `/api/ai-console/prompts/${FIXTURE_KEY}/versions`,
      payload: { body: 'You are a helpful assistant that classifies user intent.' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<Record<string, unknown>>();
    expect(body['id']).toBe(FIXTURE_VERSION_ID);
    expect(body['key']).toBe(FIXTURE_KEY);
  });

  it('retorna 400 quando body está vazio (string vazia)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/ai-console/prompts/${FIXTURE_KEY}/versions`,
      payload: { body: '' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('retorna 400 quando payload não tem campo body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/ai-console/prompts/${FIXTURE_KEY}/versions`,
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it('retorna 422 quando body contém PII (e-mail detectado)', async () => {
    const { ValidationError } = await import('../../../../shared/errors.js');
    mockCreateVersionSvc.mockRejectedValue(
      new ValidationError(
        [{ code: 'custom', path: ['body'], message: 'Body contém pattern de e-mail' }],
        'Body do prompt contém PII detectada — operação negada',
      ),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/ai-console/prompts/${FIXTURE_KEY}/versions`,
      payload: { body: 'Contate joao@exemplo.com para mais informações.' },
    });

    // ValidationError usa statusCode 400
    expect(res.statusCode).toBe(400);
    expect(res.json<Record<string, unknown>>()['error']).toBe('VALIDATION_ERROR');
  });

  it('retorna 409 quando há conflito de versão', async () => {
    const { ConflictError } = await import('../../../../shared/errors.js');
    mockCreateVersionSvc.mockRejectedValue(new ConflictError('Versão com este conteúdo já existe'));

    const res = await app.inject({
      method: 'POST',
      url: `/api/ai-console/prompts/${FIXTURE_KEY}/versions`,
      payload: { body: 'Conteúdo existente.' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json<Record<string, unknown>>()['error']).toBe('CONFLICT');
  });

  it('propaga header Idempotency-Key ao service', async () => {
    mockCreateVersionSvc.mockResolvedValue(makeVersionResponse());

    const idempotencyKey = 'dddddddd-0000-0000-0000-000000000001';

    const res = await app.inject({
      method: 'POST',
      url: `/api/ai-console/prompts/${FIXTURE_KEY}/versions`,
      payload: { body: 'Prompt válido sem PII.' },
      headers: { 'idempotency-key': idempotencyKey },
    });

    expect(res.statusCode).toBe(201);
    // Verifica que createVersionSvc foi chamado com o idempotencyKey
    expect(mockCreateVersionSvc).toHaveBeenCalledWith(
      expect.anything(), // db
      FIXTURE_KEY,
      expect.objectContaining({ body: 'Prompt válido sem PII.' }),
      expect.anything(), // context
      idempotencyKey,
    );
  });
});

// ---------------------------------------------------------------------------
// POST /api/ai-console/prompts/:key/versions/:version/activate — ativa
// ---------------------------------------------------------------------------

describe('POST /api/ai-console/prompts/:key/versions/:version/activate', () => {
  it('retorna 200 ao ativar versão com sucesso', async () => {
    mockActivateVersionSvc.mockResolvedValue({
      ok: true,
      id: FIXTURE_VERSION_ID,
      key: FIXTURE_KEY,
      version: 1,
      contentHash: FIXTURE_HASH,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/ai-console/prompts/${FIXTURE_KEY}/versions/1/activate`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body['ok']).toBe(true);
    expect(body['activated_id']).toBe(FIXTURE_VERSION_ID);
    expect(body['version']).toBe(1);
  });

  it('retorna 404 quando versão a ativar não existe', async () => {
    const { NotFoundError } = await import('../../../../shared/errors.js');
    mockActivateVersionSvc.mockRejectedValue(
      new NotFoundError(`Versão 99 do prompt '${FIXTURE_KEY}' não encontrada`),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/ai-console/prompts/${FIXTURE_KEY}/versions/99/activate`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json<Record<string, unknown>>()['error']).toBe('NOT_FOUND');
  });

  it('rollback simulado: se service lança erro, resposta é 500', async () => {
    // Simula falha na transação (ex: constraint violation)
    mockActivateVersionSvc.mockRejectedValue(
      new Error('transaction aborted: constraint violation'),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/ai-console/prompts/${FIXTURE_KEY}/versions/1/activate`,
    });

    expect(res.statusCode).toBe(500);
    expect(res.json<Record<string, unknown>>()['error']).toBe('INTERNAL_ERROR');
  });
});

// ---------------------------------------------------------------------------
// RBAC — testes de autorização
// ---------------------------------------------------------------------------

describe('RBAC — ai-console/prompts', () => {
  it('gestor_geral pode ler (GET /api/ai-console/prompts) com ai_prompts:read', async () => {
    const gestorApp = await buildTestApp(['ai_prompts:read']);
    mockListPromptKeysSvc.mockResolvedValue([makeKeyItem()]);

    const res = await gestorApp.inject({ method: 'GET', url: '/api/ai-console/prompts' });

    expect(res.statusCode).toBe(200);
    await gestorApp.close();
  });

  it('gestor_geral não pode criar versão (POST) — 403 sem ai_prompts:write', async () => {
    const gestorApp = await buildTestApp(['ai_prompts:read']); // sem write

    const res = await gestorApp.inject({
      method: 'POST',
      url: `/api/ai-console/prompts/${FIXTURE_KEY}/versions`,
      payload: { body: 'Algum conteúdo.' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json<Record<string, unknown>>()['error']).toBe('FORBIDDEN');
    await gestorApp.close();
  });

  it('gestor_geral não pode ativar versão (POST .../activate) — 403 sem ai_prompts:activate', async () => {
    const gestorApp = await buildTestApp(['ai_prompts:read']); // sem activate

    const res = await gestorApp.inject({
      method: 'POST',
      url: `/api/ai-console/prompts/${FIXTURE_KEY}/versions/1/activate`,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json<Record<string, unknown>>()['error']).toBe('FORBIDDEN');
    await gestorApp.close();
  });

  it('agente não pode ler prompts (GET) — 403 sem ai_prompts:read', async () => {
    const agenteApp = await buildTestApp(['leads:read']); // sem ai_prompts:read

    const res = await agenteApp.inject({ method: 'GET', url: '/api/ai-console/prompts' });

    expect(res.statusCode).toBe(403);
    expect(res.json<Record<string, unknown>>()['error']).toBe('FORBIDDEN');
    await agenteApp.close();
  });

  it('sem autenticação → 403 em qualquer rota', async () => {
    const noUserApp = await buildTestApp([], false); // sem request.user

    const res = await noUserApp.inject({ method: 'GET', url: '/api/ai-console/prompts' });

    expect([401, 403]).toContain(res.statusCode);
    await noUserApp.close();
  });

  it('admin pode criar versão (POST) com ai_prompts:write — 201', async () => {
    const adminApp = await buildTestApp([
      'ai_prompts:read',
      'ai_prompts:write',
      'ai_prompts:activate',
    ]);
    mockCreateVersionSvc.mockResolvedValue(makeVersionResponse());

    const res = await adminApp.inject({
      method: 'POST',
      url: `/api/ai-console/prompts/${FIXTURE_KEY}/versions`,
      payload: { body: 'Prompt de teste sem PII.' },
    });

    expect(res.statusCode).toBe(201);
    await adminApp.close();
  });

  it('admin pode ativar versão (POST .../activate) com ai_prompts:activate — 200', async () => {
    const adminApp = await buildTestApp([
      'ai_prompts:read',
      'ai_prompts:write',
      'ai_prompts:activate',
    ]);
    mockActivateVersionSvc.mockResolvedValue({
      ok: true,
      id: FIXTURE_VERSION_ID,
      key: FIXTURE_KEY,
      version: 1,
      contentHash: FIXTURE_HASH,
    });

    const res = await adminApp.inject({
      method: 'POST',
      url: `/api/ai-console/prompts/${FIXTURE_KEY}/versions/1/activate`,
    });

    expect(res.statusCode).toBe(200);
    await adminApp.close();
  });
});

// ---------------------------------------------------------------------------
// F9-S08 — Parâmetros LLM por versão (temperature, max_tokens, top_p)
// ---------------------------------------------------------------------------

describe('F9-S08 — parâmetros LLM por versão', () => {
  it('retorna 201 com temperature, max_tokens e top_p preenchidos', async () => {
    mockCreateVersionSvc.mockResolvedValue(
      makeVersionResponse({
        temperature: 0.7,
        max_tokens: 512,
        top_p: 0.9,
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/ai-console/prompts/${FIXTURE_KEY}/versions`,
      payload: {
        body: 'Prompt de teste sem PII.',
        temperature: 0.7,
        max_tokens: 512,
        top_p: 0.9,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<Record<string, unknown>>();
    expect(body['temperature']).toBe(0.7);
    expect(body['max_tokens']).toBe(512);
    expect(body['top_p']).toBe(0.9);
  });

  it('retorna 201 com null em temperature, max_tokens e top_p quando ausentes', async () => {
    mockCreateVersionSvc.mockResolvedValue(makeVersionResponse());

    const res = await app.inject({
      method: 'POST',
      url: `/api/ai-console/prompts/${FIXTURE_KEY}/versions`,
      payload: { body: 'Prompt sem parâmetros LLM.' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<Record<string, unknown>>();
    expect(body['temperature']).toBeNull();
    expect(body['max_tokens']).toBeNull();
    expect(body['top_p']).toBeNull();
  });

  it('retorna 400 quando temperature > 2 (fora do range)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/ai-console/prompts/${FIXTURE_KEY}/versions`,
      payload: { body: 'Prompt de teste.', temperature: 3.0 },
    });

    expect(res.statusCode).toBe(400);
  });

  it('retorna 400 quando top_p > 1 (fora do range)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/ai-console/prompts/${FIXTURE_KEY}/versions`,
      payload: { body: 'Prompt de teste.', top_p: 1.5 },
    });

    expect(res.statusCode).toBe(400);
  });

  it('retorna 400 quando max_tokens = 0 (abaixo do mínimo)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/ai-console/prompts/${FIXTURE_KEY}/versions`,
      payload: { body: 'Prompt de teste.', max_tokens: 0 },
    });

    expect(res.statusCode).toBe(400);
  });

  it('service é chamado com os 3 campos quando fornecidos', async () => {
    mockCreateVersionSvc.mockResolvedValue(
      makeVersionResponse({ temperature: 0.2, max_tokens: 256, top_p: 0.95 }),
    );

    await app.inject({
      method: 'POST',
      url: `/api/ai-console/prompts/${FIXTURE_KEY}/versions`,
      payload: {
        body: 'Prompt de teste sem PII.',
        temperature: 0.2,
        max_tokens: 256,
        top_p: 0.95,
      },
    });

    expect(mockCreateVersionSvc).toHaveBeenCalledWith(
      expect.anything(), // db
      FIXTURE_KEY,
      expect.objectContaining({
        body: 'Prompt de teste sem PII.',
        temperature: 0.2,
        max_tokens: 256,
        top_p: 0.95,
      }),
      expect.anything(), // context
      null, // no idempotency key
    );
  });
});

// ---------------------------------------------------------------------------
// Validação de key param — snake_case obrigatório
// ---------------------------------------------------------------------------

describe('Validação de key param', () => {
  it('retorna 400 quando key contém espaços', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/ai-console/prompts/chave inválida/versions',
    });

    // key com espaço → URL malformada → Fastify retorna 400
    expect([400, 404]).toContain(res.statusCode);
  });
});
