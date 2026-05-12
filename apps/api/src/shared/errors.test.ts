// =============================================================================
// Testes unitários — AppError e subclasses.
//
// Cobre:
//   - Instância e propriedades de cada subclasse
//   - Type guard isAppError
//   - ValidationError carrega ZodIssue[]
//   - Integração mínima com error handler do Fastify (status, body shape, sem stack)
// =============================================================================
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ZodIssue } from 'zod';

import {
  AppError,
  ConflictError,
  ExternalServiceError,
  ForbiddenError,
  isAppError,
  NotFoundError,
  RateLimitedError,
  UnauthorizedError,
  ValidationError,
} from './errors.js';

// ---------------------------------------------------------------------------
// Mock de 'pg' — evita conexão real durante testes de integração com buildApp
// ---------------------------------------------------------------------------
vi.mock('pg', () => {
  const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const MockPool = vi.fn().mockImplementation(() => ({
    query: mockQuery,
    connect: vi.fn().mockResolvedValue({
      query: mockQuery,
      release: vi.fn(),
    }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  return { Pool: MockPool, default: { Pool: MockPool } };
});

// ---------------------------------------------------------------------------
// Subclasses — propriedades
// ---------------------------------------------------------------------------

describe('NotFoundError', () => {
  it('tem statusCode 404 e code NOT_FOUND', () => {
    const err = new NotFoundError();
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toBe('Resource not found');
    expect(err.name).toBe('NotFoundError');
  });

  it('aceita mensagem customizada', () => {
    const err = new NotFoundError('Lead não encontrado');
    expect(err.message).toBe('Lead não encontrado');
  });

  it('é instância de AppError e Error', () => {
    const err = new NotFoundError();
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(Error);
  });
});

describe('UnauthorizedError', () => {
  it('tem statusCode 401 e code UNAUTHORIZED', () => {
    const err = new UnauthorizedError();
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('UNAUTHORIZED');
    expect(err.name).toBe('UnauthorizedError');
  });
});

describe('ForbiddenError', () => {
  it('tem statusCode 403 e code FORBIDDEN', () => {
    const err = new ForbiddenError();
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('FORBIDDEN');
    expect(err.name).toBe('ForbiddenError');
  });
});

describe('ConflictError', () => {
  it('tem statusCode 409 e code CONFLICT', () => {
    const err = new ConflictError('Email já cadastrado');
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('CONFLICT');
    expect(err.message).toBe('Email já cadastrado');
    expect(err.name).toBe('ConflictError');
  });

  it('carrega details quando fornecido', () => {
    const details = { field: 'email' };
    const err = new ConflictError('Duplicado', details);
    expect(err.details).toStrictEqual(details);
  });
});

describe('ValidationError', () => {
  const sampleIssues: ZodIssue[] = [
    {
      code: 'too_small',
      minimum: 1,
      type: 'string',
      inclusive: true,
      exact: false,
      message: 'String must contain at least 1 character(s)',
      path: ['nome'],
    },
  ];

  it('tem statusCode 400 e code VALIDATION_ERROR', () => {
    const err = new ValidationError(sampleIssues);
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.name).toBe('ValidationError');
  });

  it('carrega issues acessíveis via .issues e .details', () => {
    const err = new ValidationError(sampleIssues);
    expect(err.issues).toStrictEqual(sampleIssues);
    expect(err.details).toStrictEqual(sampleIssues);
  });

  it('aceita mensagem customizada', () => {
    const err = new ValidationError(sampleIssues, 'Campos inválidos');
    expect(err.message).toBe('Campos inválidos');
  });
});

describe('RateLimitedError', () => {
  it('tem statusCode 429 e code RATE_LIMITED', () => {
    const err = new RateLimitedError();
    expect(err.statusCode).toBe(429);
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.name).toBe('RateLimitedError');
  });
});

describe('ExternalServiceError', () => {
  it('tem statusCode 502 e code EXTERNAL_SERVICE_ERROR', () => {
    const err = new ExternalServiceError('Chatwoot indisponível');
    expect(err.statusCode).toBe(502);
    expect(err.code).toBe('EXTERNAL_SERVICE_ERROR');
    expect(err.name).toBe('ExternalServiceError');
  });

  it('carrega details quando fornecido', () => {
    const details = { upstream: 'chatwoot', status: 503 };
    const err = new ExternalServiceError('Upstream error', details);
    expect(err.details).toStrictEqual(details);
  });
});

// ---------------------------------------------------------------------------
// Type guard isAppError
// ---------------------------------------------------------------------------

describe('isAppError', () => {
  it('retorna true para qualquer AppError ou subclasse', () => {
    expect(isAppError(new AppError(500, 'NOT_FOUND', 'test'))).toBe(true);
    expect(isAppError(new NotFoundError())).toBe(true);
    expect(isAppError(new UnauthorizedError())).toBe(true);
    expect(isAppError(new ForbiddenError())).toBe(true);
    expect(isAppError(new ConflictError('x'))).toBe(true);
    expect(isAppError(new ValidationError([]))).toBe(true);
    expect(isAppError(new RateLimitedError())).toBe(true);
    expect(isAppError(new ExternalServiceError('x'))).toBe(true);
  });

  it('retorna false para Error comum', () => {
    expect(isAppError(new Error('oops'))).toBe(false);
  });

  it('retorna false para valores primitivos e null', () => {
    expect(isAppError(null)).toBe(false);
    expect(isAppError(undefined)).toBe(false);
    expect(isAppError('string')).toBe(false);
    expect(isAppError(42)).toBe(false);
    expect(isAppError({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integração com error handler do Fastify
// ---------------------------------------------------------------------------

describe('error handler — integração Fastify', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Import dinâmico garante que o mock de 'pg' esteja ativo quando app.ts for avaliado
    const { buildApp } = await import('../app.js');
    app = await buildApp();

    // Rota de teste que lança NotFoundError
    app.get('/test/not-found', async () => {
      throw new NotFoundError('Item não encontrado');
    });

    // Rota de teste que lança ValidationError com ZodIssue
    app.get('/test/validation', async () => {
      const issues: ZodIssue[] = [
        {
          code: 'invalid_type',
          expected: 'string',
          received: 'undefined',
          path: ['cpf'],
          message: 'Required',
        },
      ];
      throw new ValidationError(issues);
    });

    // Rota de teste que lança erro desconhecido (não AppError)
    app.get('/test/unknown', async () => {
      throw new Error('Erro interno inesperado');
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('AppError → status correto e body com code/message sem stack', async () => {
    const response = await app.inject({ method: 'GET', url: '/test/not-found' });

    expect(response.statusCode).toBe(404);

    const body = response.json<Record<string, unknown>>();
    expect(body['error']).toBe('NOT_FOUND');
    expect(body['message']).toBe('Item não encontrado');
    // Stack nunca deve aparecer no body
    expect(body).not.toHaveProperty('stack');
  });

  it('ValidationError → 400 com details contendo ZodIssue[]', async () => {
    const response = await app.inject({ method: 'GET', url: '/test/validation' });

    expect(response.statusCode).toBe(400);

    const body = response.json<Record<string, unknown>>();
    expect(body['error']).toBe('VALIDATION_ERROR');
    expect(Array.isArray(body['details'])).toBe(true);

    const details = body['details'] as Array<Record<string, unknown>>;
    expect(details[0]).toMatchObject({ path: ['cpf'], message: 'Required' });
  });

  it('erro desconhecido → 500 com INTERNAL_ERROR, sem stack no body', async () => {
    const response = await app.inject({ method: 'GET', url: '/test/unknown' });

    expect(response.statusCode).toBe(500);

    const body = response.json<Record<string, unknown>>();
    expect(body['error']).toBe('INTERNAL_ERROR');
    expect(body['message']).toBe('Internal server error');
    // Mensagem real do erro não deve vazar
    expect(body['message']).not.toContain('inesperado');
    expect(body).not.toHaveProperty('stack');
  });
});
