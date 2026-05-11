// =============================================================================
// Teste de integração: GET /health
// Sobe o app via buildApp() sem Postgres real — pool.query é mockado via vi.mock.
//
// Mock de 'pg': impede que Pool abra conexão real durante testes.
// O mock expõe { Pool, default: { Pool } } para cobrir tanto o import named
// original (antes do fix ESM/CJS) quanto o import default atual em db/client.ts.
//
// vi.mock é hoisted automaticamente pelo Vitest para o topo do módulo,
// garantindo que o mock esteja registrado antes de qualquer import dinâmico.
// =============================================================================
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Mock de 'pg': garante que Pool não abra conexão real com Postgres durante testes.
// db/client.ts usa `import pg from 'pg'; const { Pool } = pg;` (default import ESM/CJS).
// O mock retorna { default: { Pool: MockPool } } para satisfazer esse padrão.
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

describe('GET /health', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Import dinâmico garante que os mocks estejam ativos quando db/client.ts
    // e app.ts forem avaliados pela primeira vez neste worker.
    const { buildApp } = await import('../../app.js');
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('retorna 200 com status ok e checks.db ok quando o pool responde', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);

    // `body` é unknown (correto para resposta HTTP de origem externa ao tipo).
    // `as Record<string, unknown>`: narrowing necessário para acessar uptime_s
    // em assertions individuais. O toMatchObject já valida status e checks sem cast.
    const body = response.json<Record<string, unknown>>();

    expect(body).toMatchObject({
      status: 'ok',
      checks: { db: 'ok' },
    });

    // uptime_s deve ser número não-negativo
    expect(typeof body['uptime_s']).toBe('number');
    expect(body['uptime_s']).toBeGreaterThanOrEqual(0);
  });
});
