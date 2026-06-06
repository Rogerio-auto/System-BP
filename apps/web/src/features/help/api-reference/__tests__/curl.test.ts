// =============================================================================
// __tests__/curl.test.ts — Testes do helper generateCurl
// =============================================================================

import { describe, expect, it } from 'vitest';

import { generateCurl } from '../curl';

describe('generateCurl', () => {
  it('gera curl correto para GET com query params', () => {
    const result = generateCurl({
      method: 'GET',
      path: '/leads',
      parameters: [
        { name: 'page', in: 'query', schema: { type: 'integer', example: 1 } },
        { name: 'pageSize', in: 'query', schema: { type: 'integer', example: 20 } },
      ],
    });

    expect(result).toContain('curl -X GET');
    expect(result).toContain('/leads');
    expect(result).toContain('page=1');
    expect(result).toContain('pageSize=20');
    expect(result).toContain("-H 'Authorization: Bearer");
    // GET sem body: não deve ter -d ou Content-Type
    expect(result).not.toContain('-d');
    expect(result).not.toContain('Content-Type');
  });

  it('gera curl correto para POST com body', () => {
    const result = generateCurl({
      method: 'POST',
      path: '/leads',
      parameters: [],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                name: { type: 'string', example: 'João Silva' },
                cpf: { type: 'string', example: '123.456.789-00' },
              },
              required: ['name', 'cpf'],
            },
          },
        },
      },
    });

    expect(result).toContain('curl -X POST');
    expect(result).toContain('/leads');
    expect(result).toContain("-H 'Authorization: Bearer");
    expect(result).toContain("-H 'Content-Type: application/json'");
    expect(result).toContain('-d');
    expect(result).toContain('name');
  });

  it('gera curl correto para DELETE sem body', () => {
    const result = generateCurl({
      method: 'DELETE',
      path: '/leads/{id}',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
    });

    expect(result).toContain('curl -X DELETE');
    expect(result).toContain('00000000-0000-0000-0000-000000000000');
    expect(result).toContain("-H 'Authorization: Bearer");
    // DELETE sem body: não deve ter Content-Type
    expect(result).not.toContain('Content-Type');
  });

  it('substitui path params pelo valor de exemplo', () => {
    const result = generateCurl({
      method: 'GET',
      path: '/leads/{id}/cards/{cardId}',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', example: 'lead-123' } },
        { name: 'cardId', in: 'path', required: true, schema: { type: 'integer', example: 42 } },
      ],
    });

    expect(result).toContain('lead-123');
    expect(result).toContain('42');
    // Path params não devem aparecer como variáveis não substituídas
    expect(result).not.toContain('{id}');
    expect(result).not.toContain('{cardId}');
  });

  it('usa baseUrl customizada quando fornecida', () => {
    const result = generateCurl({
      method: 'GET',
      path: '/status',
      baseUrl: 'https://staging.api.example.com/v2',
    });
    expect(result).toContain('https://staging.api.example.com/v2/status');
  });
});
