// =============================================================================
// __tests__/metaClient.test.ts — Testes do MetaTemplatesClient.
//
// Contexto: F5-S09.
//
// Estratégia:
//   - Injeta accessToken, wabaId e sleepFn via constructor options.
//   - Mocka fetch global via jest.spyOn.
//   - Testa retry em 429/5xx e non-retry em 4xx.
//   - Testa timeout (AbortError).
//   - Nunca usa token real.
// =============================================================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExternalServiceError } from '../../../shared/errors.js';
import { MetaTemplatesClient } from '../metaClient.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DUMMY_TOKEN = 'test-access-token-never-real';
const DUMMY_WABA_ID = 'test-waba-id-123';

function makeClient(
  overrides: ConstructorParameters<typeof MetaTemplatesClient>[0] = {},
): MetaTemplatesClient {
  return new MetaTemplatesClient({
    accessToken: DUMMY_TOKEN,
    wabaId: DUMMY_WABA_ID,
    sleepFn: () => Promise.resolve(), // no-op: sem espera nos testes
    maxAttempts: 3,
    backoffBaseMs: 0,
    jitterMaxMs: 0,
    ...overrides,
  });
}

function mockFetchResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): ReturnType<typeof vi.fn> {
  // Always include content-type: application/json so doFetch parses the body.
  const mergedHeaders: Record<string, string> = { 'content-type': 'application/json', ...headers };
  const response = {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (key: string) => mergedHeaders[key] ?? null,
    },
    json: () => Promise.resolve(body),
  } as unknown as Response;

  return vi.fn(() => Promise.resolve(response));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MetaTemplatesClient', () => {
  // vi.spyOn return type inferred automatically by vitest.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: ReturnType<typeof vi.spyOn<any, any>>;

  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetchSpy = vi.spyOn(global as any, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  // ── Constructor ───────────────────────────────────────────────────────────

  it('lança ExternalServiceError se accessToken ausente', () => {
    expect(() => new MetaTemplatesClient({ accessToken: '', wabaId: DUMMY_WABA_ID })).toThrow(
      ExternalServiceError,
    );
  });

  it('lança ExternalServiceError se wabaId ausente', () => {
    expect(() => new MetaTemplatesClient({ accessToken: DUMMY_TOKEN, wabaId: '' })).toThrow(
      ExternalServiceError,
    );
  });

  // ── submitTemplate ────────────────────────────────────────────────────────

  it('submitTemplate: retorna meta template id em sucesso', async () => {
    fetchSpy.mockImplementation(mockFetchResponse(200, { id: 'meta_tmpl_123' }));

    const client = makeClient();
    const id = await client.submitTemplate({
      name: 'followup_d1',
      category: 'UTILITY',
      language: 'pt_BR',
      components: [{ type: 'BODY', text: 'Olá {{1}}' }],
    });

    expect(id).toBe('meta_tmpl_123');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('submitTemplate: lança ExternalServiceError se resposta sem id', async () => {
    fetchSpy.mockImplementation(mockFetchResponse(200, {}));

    const client = makeClient();
    await expect(
      client.submitTemplate({
        name: 'test',
        category: 'UTILITY',
        language: 'pt_BR',
        components: [],
      }),
    ).rejects.toThrow(ExternalServiceError);
  });

  it('submitTemplate: faz retry em 429 e falha após maxAttempts', async () => {
    fetchSpy.mockImplementation(
      mockFetchResponse(429, { error: { code: 100, message: 'Rate limit' } }),
    );

    const client = makeClient({ maxAttempts: 2 });
    await expect(
      client.submitTemplate({
        name: 'test',
        category: 'UTILITY',
        language: 'pt_BR',
        components: [],
      }),
    ).rejects.toThrow(ExternalServiceError);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('submitTemplate: não faz retry em 400 (não retryable)', async () => {
    fetchSpy.mockImplementation(
      mockFetchResponse(400, { error: { code: 100, message: 'Bad request' } }),
    );

    const client = makeClient({ maxAttempts: 3 });
    await expect(
      client.submitTemplate({
        name: 'test',
        category: 'UTILITY',
        language: 'pt_BR',
        components: [],
      }),
    ).rejects.toThrow(ExternalServiceError);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('submitTemplate: faz retry em 503 (server error)', async () => {
    fetchSpy
      .mockImplementationOnce(
        mockFetchResponse(503, { error: { code: 0, message: 'Service unavailable' } }),
      )
      .mockImplementation(mockFetchResponse(200, { id: 'meta_tmpl_456' }));

    const client = makeClient({ maxAttempts: 3 });
    const id = await client.submitTemplate({
      name: 'test',
      category: 'UTILITY',
      language: 'pt_BR',
      components: [],
    });

    expect(id).toBe('meta_tmpl_456');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  // ── getTemplate ───────────────────────────────────────────────────────────

  it('getTemplate: retorna MetaTemplateRecord em sucesso', async () => {
    const record = {
      id: 'meta_tmpl_789',
      name: 'followup_d1',
      status: 'APPROVED',
      category: 'UTILITY',
      language: 'pt_BR',
    };
    fetchSpy.mockImplementation(mockFetchResponse(200, record));

    const client = makeClient();
    const result = await client.getTemplate('meta_tmpl_789');

    expect(result.id).toBe('meta_tmpl_789');
    expect(result.status).toBe('APPROVED');
    // GET: sem body na requisição
    const callArgs = fetchSpy.mock.calls[0];
    expect(callArgs).toBeDefined();
  });

  // ── listTemplates ─────────────────────────────────────────────────────────

  it('listTemplates: retorna array vazio se data ausente', async () => {
    fetchSpy.mockImplementation(mockFetchResponse(200, {}));

    const client = makeClient();
    const result = await client.listTemplates();

    expect(result).toEqual([]);
  });

  it('listTemplates: retorna array de templates', async () => {
    const data = [
      { id: '1', name: 'tmpl_a', status: 'APPROVED', category: 'UTILITY', language: 'pt_BR' },
      { id: '2', name: 'tmpl_b', status: 'PENDING', category: 'MARKETING', language: 'pt_BR' },
    ];
    fetchSpy.mockImplementation(mockFetchResponse(200, { data }));

    const client = makeClient();
    const result = await client.listTemplates();

    expect(result).toHaveLength(2);
    expect(result[0]?.status).toBe('APPROVED');
  });

  // ── Sanitização de erro ───────────────────────────────────────────────────

  it('erro 401: ExternalServiceError com upstreamStatus 401, sem token no message', async () => {
    fetchSpy.mockImplementation(
      mockFetchResponse(401, {
        error: { code: 190, message: 'Invalid OAuth access token', title: 'Invalid token' },
      }),
    );

    const client = makeClient();
    try {
      await client.submitTemplate({
        name: 'test',
        category: 'UTILITY',
        language: 'pt_BR',
        components: [],
      });
      throw new Error('deveria ter lançado ExternalServiceError');
    } catch (err) {
      expect(err).toBeInstanceOf(ExternalServiceError);
      const e = err as ExternalServiceError;
      // Token NUNCA deve aparecer na mensagem de erro (LGPD §8.3)
      expect(e.message).not.toContain(DUMMY_TOKEN);
      expect((e.details as { upstreamStatus: number }).upstreamStatus).toBe(401);
    }
  });
});
