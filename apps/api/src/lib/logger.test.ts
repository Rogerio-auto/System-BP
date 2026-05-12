// =============================================================================
// logger.test.ts — Testes que validam redact canônico do Pino (LGPD §8.3).
//
// Cada path da REDACT_PATHS deve gerar '[redacted]' no output JSON.
// Campos não listados devem ser preservados integralmente.
// =============================================================================
import { Writable } from 'node:stream';

import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { REDACT_PATHS } from './logger.js';

// -----------------------------------------------------------------------------
// Helper: cria um logger de teste que captura output em memória.
// Não usa a instância exportada (que pode estar em modo pretty) — cria uma
// instância JSON pura para assertar os campos redactados.
// -----------------------------------------------------------------------------

function createTestLogger() {
  const chunks: Buffer[] = [];

  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk);
      callback();
    },
  });

  const log = pino(
    {
      level: 'trace',
      redact: {
        paths: [...REDACT_PATHS],
        censor: '[redacted]',
      },
    },
    stream,
  );

  function getLastLog(): Record<string, unknown> {
    const last = chunks[chunks.length - 1];
    if (!last) throw new Error('Nenhum log capturado');
    return JSON.parse(last.toString()) as Record<string, unknown>;
  }

  return { log, getLastLog };
}

// -----------------------------------------------------------------------------
// Helper: acessa campo aninhado por path pontilhado.
// Ex: 'req.headers.authorization' → obj.req.headers.authorization
// -----------------------------------------------------------------------------
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path
    .replace(/\[.*?\]/g, '')
    .split('.')
    .filter(Boolean);
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

// =============================================================================
// Testes de redact para cada path da lista canônica
// =============================================================================

describe('REDACT_PATHS — cada campo deve ser redactado', () => {
  // Campos que não usam wildcard e têm path direto
  const directPaths: Array<[string, Record<string, unknown>]> = [
    ['req.headers.authorization', { req: { headers: { authorization: 'Bearer secret-token' } } }],
    ['req.headers.cookie', { req: { headers: { cookie: 'session=abc123' } } }],
    ['req.body.password', { req: { body: { password: 'senha-super-secreta' } } }],
    ['req.body.refresh_token', { req: { body: { refresh_token: 'rt-token-abc' } } }],
    ['req.body.totp_secret', { req: { body: { totp_secret: 'JBSWY3DPEHPK3PXP' } } }],
    ['req.body.cpf', { req: { body: { cpf: '123.456.789-09' } } }],
    ['req.body.document_number', { req: { body: { document_number: '987.654.321-00' } } }],
    ['req.body.email', { req: { body: { email: 'titular@example.com' } } }],
    ['req.body.primary_phone', { req: { body: { primary_phone: '+5569999999999' } } }],
    ['req.body.phone', { req: { body: { phone: '+5511888888888' } } }],
    ['req.body.birth_date', { req: { body: { birth_date: '1990-01-15' } } }],
  ];

  for (const [path, payload] of directPaths) {
    it(`redacta '${path}'`, () => {
      const { log, getLastLog } = createTestLogger();
      log.info(payload, 'test-log');
      const output = getLastLog();
      const value = getNestedValue(output, path);
      expect(value).toBe('[redacted]');
    });
  }

  // Wildcards — testa via objeto aninhado
  const wildcardCases: Array<[string, Record<string, unknown>, string]> = [
    ['*.cpf', { customer: { cpf: '111.111.111-11' } }, 'customer.cpf'],
    ['*.document_number', { lead: { document_number: '222.222.222-22' } }, 'lead.document_number'],
    ['*.password', { user: { password: 'hash-or-plain' } }, 'user.password'],
    ['*.password_hash', { user: { password_hash: '$2b$12$...' } }, 'user.password_hash'],
    ['*.refresh_token', { session: { refresh_token: 'rt-xyz' } }, 'session.refresh_token'],
    ['*.totp_secret', { auth: { totp_secret: 'BASE32SECRET' } }, 'auth.totp_secret'],
  ];

  for (const [path, payload, accessPath] of wildcardCases) {
    it(`redacta wildcard '${path}'`, () => {
      const { log, getLastLog } = createTestLogger();
      log.info(payload, 'test-log');
      const output = getLastLog();
      const value = getNestedValue(output, accessPath);
      expect(value).toBe('[redacted]');
    });
  }
});

// =============================================================================
// Campos não listados devem ser preservados
// =============================================================================

describe('campos não listados — valor preservado', () => {
  it('preserva req.body.name (PII não-sensível em log)', () => {
    const { log, getLastLog } = createTestLogger();
    log.info({ req: { body: { name: 'João da Silva' } } }, 'test');
    const output = getLastLog();
    expect(getNestedValue(output, 'req.body.name')).toBe('João da Silva');
  });

  it('preserva req.body.status (campo não-PII)', () => {
    const { log, getLastLog } = createTestLogger();
    log.info({ req: { body: { status: 'active' } } }, 'test');
    const output = getLastLog();
    expect(getNestedValue(output, 'req.body.status')).toBe('active');
  });

  it('preserva req.body.organization_id (UUID não-PII)', () => {
    const { log, getLastLog } = createTestLogger();
    const id = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    log.info({ req: { body: { organization_id: id } } }, 'test');
    const output = getLastLog();
    expect(getNestedValue(output, 'req.body.organization_id')).toBe(id);
  });
});

// =============================================================================
// Garantia de completude — REDACT_PATHS não pode estar vazia
// =============================================================================

describe('REDACT_PATHS', () => {
  it('contém ao menos os campos críticos de PII', () => {
    const critical = [
      'req.headers.authorization',
      'req.body.password',
      'req.body.cpf',
      '*.password',
      '*.totp_secret',
    ];
    for (const path of critical) {
      expect(REDACT_PATHS).toContain(path);
    }
  });
});
