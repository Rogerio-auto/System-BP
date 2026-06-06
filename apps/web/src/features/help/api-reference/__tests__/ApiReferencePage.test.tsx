// =============================================================================
// __tests__/ApiReferencePage.test.tsx — Testes do ApiReferencePage
//
// Nota: componente usa react-router e TanStack Query.
// Os testes usam mocks simples para evitar dependências externas.
// =============================================================================

import { describe, expect, it } from 'vitest';

import { parseSpec } from '../ApiReferencePage';
import type { OpenApiSpec } from '../types';

// parseSpec é a função interna de parsing — testamos sua lógica diretamente

// Fixture de spec mínimo válido
const MINIMAL_SPEC = {
  openapi: '3.1.0',
  info: { title: 'API Teste', version: '1.0.0' },
  tags: [
    { name: 'Leads', description: 'Gestão de leads' },
    { name: 'Auth', description: 'Autenticação' },
  ],
  paths: {
    '/leads': {
      get: {
        operationId: 'list-leads',
        summary: 'Listar leads',
        tags: ['Leads'],
        parameters: [{ name: 'page', in: 'query', schema: { type: 'integer' } }],
        responses: { '200': { description: 'Sucesso' } },
      },
      post: {
        operationId: 'create-lead',
        summary: 'Criar lead',
        tags: ['Leads'],
        responses: { '201': { description: 'Criado' } },
      },
    },
    '/auth/login': {
      post: {
        operationId: 'auth-login',
        summary: 'Login',
        tags: ['Auth'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  email: { type: 'string' },
                  password: { type: 'string' },
                },
                required: ['email', 'password'],
              },
            },
          },
        },
        responses: {
          '200': { description: 'Autenticado' },
          '401': { description: 'Não autorizado' },
        },
      },
    },
  },
};

describe('parseSpec', () => {
  it('retorna grupos por tag', () => {
    const groups = parseSpec(MINIMAL_SPEC as OpenApiSpec);
    expect(groups.length).toBe(2);
    const tags = groups.map((g) => g.tag);
    expect(tags).toContain('Leads');
    expect(tags).toContain('Auth');
  });

  it('preserva ordem das tags conforme declarado no spec', () => {
    const groups = parseSpec(MINIMAL_SPEC as OpenApiSpec);
    expect(groups[0]!.tag).toBe('Leads');
    expect(groups[1]!.tag).toBe('Auth');
  });

  it('agrega endpoints corretamente por tag', () => {
    const groups = parseSpec(MINIMAL_SPEC as OpenApiSpec);
    const leadsGroup = groups.find((g) => g.tag === 'Leads')!;
    expect(leadsGroup).toBeDefined();
    expect(leadsGroup.endpoints.length).toBe(2);

    const methods = leadsGroup.endpoints.map((e) => e.method);
    expect(methods).toContain('GET');
    expect(methods).toContain('POST');
  });

  it('endpoints incluem operationId, summary e path corretos', () => {
    const groups = parseSpec(MINIMAL_SPEC as OpenApiSpec);
    const authGroup = groups.find((g) => g.tag === 'Auth')!;
    expect(authGroup).toBeDefined();
    const ep = authGroup!.endpoints[0]!;
    expect(ep.operationId).toBe('auth-login');
    expect(ep.summary).toBe('Login');
    expect(ep.path).toBe('/auth/login');
  });

  it('endpoints sem tag vão para o grupo Other', () => {
    const specNoTags = {
      ...MINIMAL_SPEC,
      paths: {
        '/status': {
          get: {
            operationId: 'health',
            summary: 'Health check',
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    };
    const groups = parseSpec(specNoTags as OpenApiSpec);
    const other = groups.find((g) => g.tag === 'Other');
    expect(other).toBeDefined();
    expect(other!.endpoints.length).toBe(1);
  });
});

// Re-export parseSpec for test (needs to be exported from module)
// This is a structural test — the actual UI tests would require jsdom
