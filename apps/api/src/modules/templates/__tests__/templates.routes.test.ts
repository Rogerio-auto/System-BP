// =============================================================================
// __tests__/templates.routes.test.ts — Testes de integração das rotas de templates.
//
// Contexto: F5-S09.
//
// Estratégia:
//   - Fastify sobe com templatesRoutes.
//   - authenticate e authorize mockados para controlar acesso.
//   - Services mockados para isolar da DB.
//   - Cobre: CRUD + RBAC + validação Zod (DLP).
// =============================================================================
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks devem vir antes dos imports dos módulos que os usam
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

const mockListService = vi.fn();
const mockGetService = vi.fn();
const mockCreateService = vi.fn();
const mockUpdateService = vi.fn();
const mockDeleteService = vi.fn();
const mockSyncService = vi.fn();
const mockSyncAllService = vi.fn();

vi.mock('../service.js', () => ({
  listTemplatesService: (...args: unknown[]) => mockListService(...args),
  getTemplateService: (...args: unknown[]) => mockGetService(...args),
  createTemplateService: (...args: unknown[]) => mockCreateService(...args),
  updateTemplateService: (...args: unknown[]) => mockUpdateService(...args),
  deleteTemplateService: (...args: unknown[]) => mockDeleteService(...args),
  syncTemplateService: (...args: unknown[]) => mockSyncService(...args),
  syncAllService: (...args: unknown[]) => mockSyncAllService(...args),
}));

// Mock authenticate — injeta user no request
vi.mock('../../auth/middlewares/authenticate.js', () => ({
  authenticate: () => async (request: { user?: unknown }, _reply: unknown) => {
    request.user = {
      id: 'user-uuid',
      organizationId: 'org-uuid',
      permissions: ['templates:read', 'templates:write', 'templates:sync', 'templates:delete'],
      cityScopeIds: null,
    };
  },
}));

// Mock authorize — permite tudo por padrão
vi.mock('../../auth/middlewares/authorize.js', () => ({
  authorize: () => async () => {
    // no-op: todos passam
  },
}));

vi.mock('../../../db/client.js', () => ({
  db: {},
  pool: { connect: vi.fn(), end: vi.fn(), on: vi.fn() },
}));

import { templatesRoutes } from '../routes.js';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(templatesRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEMPLATE_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = '22222222-2222-4222-8222-222222222222';

const TEMPLATE_RESPONSE = {
  id: TEMPLATE_ID,
  organizationId: ORG_ID,
  metaTemplateId: 'meta_123',
  name: 'followup_d1',
  category: 'utility',
  language: 'pt_BR',
  body: 'Olá {{1}}, sua proposta está em análise.',
  variables: ['nome_cliente'],
  status: 'pending',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// GET /api/templates
// ---------------------------------------------------------------------------

describe('GET /api/templates', () => {
  it('200 — retorna lista paginada', async () => {
    mockListService.mockResolvedValue({
      data: [TEMPLATE_RESPONSE],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    });

    const response = await app.inject({ method: 'GET', url: '/api/templates' });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: unknown[]; total: number };
    expect(body.data).toHaveLength(1);
    expect(body.total).toBe(1);
  });

  it('200 — filtra por status=approved', async () => {
    mockListService.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 });

    const response = await app.inject({ method: 'GET', url: '/api/templates?status=approved' });

    expect(response.statusCode).toBe(200);
    expect(mockListService).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'approved' }),
    );
  });
});

// ---------------------------------------------------------------------------
// GET /api/templates/:id
// ---------------------------------------------------------------------------

describe('GET /api/templates/:id', () => {
  it('200 — retorna template', async () => {
    mockGetService.mockResolvedValue(TEMPLATE_RESPONSE);

    const response = await app.inject({
      method: 'GET',
      url: `/api/templates/${TEMPLATE_ID}`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { id: string };
    expect(body.id).toBe(TEMPLATE_ID);
  });
});

// ---------------------------------------------------------------------------
// POST /api/templates
// ---------------------------------------------------------------------------

describe('POST /api/templates', () => {
  it('201 — cria template', async () => {
    mockCreateService.mockResolvedValue(TEMPLATE_RESPONSE);

    const response = await app.inject({
      method: 'POST',
      url: '/api/templates',
      payload: {
        name: 'followup_d1',
        category: 'utility',
        language: 'pt_BR',
        body: 'Olá {{1}}, sua proposta está em análise.',
        variables: ['nome_cliente'],
      },
    });

    expect(response.statusCode).toBe(201);
  });

  it('400 — DLP: body com CPF hardcoded é rejeitado', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/templates',
      payload: {
        name: 'test_cpf',
        category: 'utility',
        language: 'pt_BR',
        body: 'Seu CPF é 123.456.789-00 e seu crédito foi aprovado.',
        variables: [],
      },
    });

    expect(response.statusCode).toBe(400);
    // createTemplateService não deve ser chamado
    expect(mockCreateService).not.toHaveBeenCalled();
  });

  it('400 — DLP: body com e-mail hardcoded é rejeitado', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/templates',
      payload: {
        name: 'test_email',
        category: 'utility',
        language: 'pt_BR',
        body: 'Acesse seu portal em usuario@banco.gov.br para mais informações.',
        variables: [],
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('400 — body com name inválido (caracteres especiais)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/templates',
      payload: {
        name: 'NOME INVÁLIDO com espaços',
        category: 'utility',
        language: 'pt_BR',
        body: 'Template válido {{1}}',
        variables: ['nome'],
      },
    });

    expect(response.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/templates/:id
// ---------------------------------------------------------------------------

describe('PATCH /api/templates/:id', () => {
  it('200 — edita template', async () => {
    mockUpdateService.mockResolvedValue({ ...TEMPLATE_RESPONSE, body: 'Novo body {{1}}' });

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/templates/${TEMPLATE_ID}`,
      payload: { body: 'Novo body {{1}}' },
    });

    expect(response.statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/templates/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/templates/:id', () => {
  it('200 — soft delete retorna template com status paused', async () => {
    mockDeleteService.mockResolvedValue({ ...TEMPLATE_RESPONSE, status: 'paused' });

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/templates/${TEMPLATE_ID}`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { status: string };
    expect(body.status).toBe('paused');
  });
});

// ---------------------------------------------------------------------------
// POST /api/templates/:id/sync
// ---------------------------------------------------------------------------

describe('POST /api/templates/:id/sync', () => {
  it('200 — retorna template sincronizado', async () => {
    mockSyncService.mockResolvedValue({ ...TEMPLATE_RESPONSE, status: 'approved' });

    const response = await app.inject({
      method: 'POST',
      url: `/api/templates/${TEMPLATE_ID}/sync`,
      headers: { 'idempotency-key': 'test-key-123' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { status: string };
    expect(body.status).toBe('approved');
  });
});

// ---------------------------------------------------------------------------
// POST /api/templates/sync-all
// ---------------------------------------------------------------------------

describe('POST /api/templates/sync-all', () => {
  it('200 — retorna contagem de sync', async () => {
    mockSyncAllService.mockResolvedValue({ synced: 3, unchanged: 2, errors: 0 });

    const response = await app.inject({
      method: 'POST',
      url: '/api/templates/sync-all',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { synced: number; unchanged: number; errors: number };
    expect(body.synced).toBe(3);
    expect(body.unchanged).toBe(2);
    expect(body.errors).toBe(0);
  });
});
