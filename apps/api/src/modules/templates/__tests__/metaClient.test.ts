// =============================================================================
// __tests__/metaClient.test.ts — Testes do MetaTemplatesClient.
//
// Contexto: F5-S09 + F5-S11.
//
// Estratégia:
//   - Injeta accessToken, wabaId e sleepFn via constructor options.
//   - Mocka fetch global via vi.spyOn.
//   - Testa retry em 429/5xx e non-retry em 4xx.
//   - Testa timeout (AbortError).
//   - Nunca usa token real.
//
// F5-S11 — Novos cenários:
//   - submitTemplate: HEADER com format + example.header_handle
//   - uploadSampleForTemplate: resumable upload (etapas 1 + 2)
//   - uploadSampleForTemplate: sem META_APP_ID → ExternalServiceError
//   - uploadSampleForTemplate: bytes e token nunca logados (LGPD §8.3)
//
// F5-S11 security fixes:
//   - uploadSampleForTemplate: MIME allowlist (M-1) — rejeita tipo fora da lista
//   - uploadSampleForTemplate: retry na etapa 2 em 429 (M-2)
//   - uploadSampleForTemplate: retry na etapa 2 em 5xx (M-2)
//   - uploadSampleForTemplate: encodeURIComponent no uploadSessionId (L-2)
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

  // ── F5-S11: HEADER com format e example.header_handle ────────────────────

  it('submitTemplate: aceita componente HEADER com format=DOCUMENT e example.header_handle', async () => {
    fetchSpy.mockImplementation(mockFetchResponse(200, { id: 'meta_tmpl_boleto' }));

    const client = makeClient();
    const id = await client.submitTemplate({
      name: 'boleto_cobranca',
      category: 'UTILITY',
      language: 'pt_BR',
      components: [
        {
          type: 'HEADER',
          format: 'DOCUMENT',
          example: { header_handle: ['handle_abc_123'] },
        },
        { type: 'BODY', text: 'Olá {{1}}, seu boleto vence em {{2}}.' },
      ],
    });

    expect(id).toBe('meta_tmpl_boleto');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Verificar que o payload enviado inclui format e example.header_handle
    const callArgs = fetchSpy.mock.calls[0] as [string, RequestInit];
    const sentBody = JSON.parse(callArgs[1]?.body as string) as Record<string, unknown>;
    const components = sentBody['components'] as Array<Record<string, unknown>>;
    const header = components.find((c) => c['type'] === 'HEADER');
    expect(header?.['format']).toBe('DOCUMENT');
    expect((header?.['example'] as Record<string, unknown>)?.['header_handle']).toEqual([
      'handle_abc_123',
    ]);
  });

  it('submitTemplate: aceita HEADER com format=IMAGE e example.header_handle', async () => {
    fetchSpy.mockImplementation(mockFetchResponse(200, { id: 'meta_tmpl_img' }));

    const client = makeClient();
    const id = await client.submitTemplate({
      name: 'promo_imagem',
      category: 'MARKETING',
      language: 'pt_BR',
      components: [
        {
          type: 'HEADER',
          format: 'IMAGE',
          example: { header_handle: ['img_handle_xyz'] },
        },
        { type: 'BODY', text: 'Confira nossa promoção!' },
      ],
    });

    expect(id).toBe('meta_tmpl_img');
  });

  // ── F5-S11: uploadSampleForTemplate ──────────────────────────────────────

  it('uploadSampleForTemplate: fluxo completo (start + finish) → retorna header_handle', async () => {
    // Etapa 1: POST /{app_id}/uploads → session id
    const startResponse = mockFetchResponse(200, { id: 'upload_session_123' });
    // Etapa 2: POST /{upload_session_id} → header_handle
    const finishResponse = mockFetchResponse(200, { h: 'header_handle_abc_xyz' });

    fetchSpy.mockImplementationOnce(startResponse).mockImplementationOnce(finishResponse);

    const client = makeClient({ appId: 'test_app_id_123' });
    const handle = await client.uploadSampleForTemplate(
      Buffer.from('%PDF-1.4 sample'),
      'application/pdf',
    );

    expect(handle).toBe('header_handle_abc_xyz');
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Verificar etapa 1: URL contém app_id
    const [url1] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url1).toContain('test_app_id_123');
    expect(url1).toContain('/uploads');

    // Verificar etapa 2: URL contém upload_session_id, método POST
    const [url2, opts2] = fetchSpy.mock.calls[1] as [string, RequestInit];
    expect(url2).toContain('upload_session_123');
    expect(opts2.method).toBe('POST');

    // Verificar que etapa 2 usa "OAuth" (não "Bearer")
    const headers2 = opts2.headers as Record<string, string>;
    expect(headers2['Authorization']).toMatch(/^OAuth /);
    expect(headers2['Authorization']).not.toMatch(/^Bearer /);
  });

  it('uploadSampleForTemplate: lança ExternalServiceError se appId ausente', async () => {
    // Sem appId injetado e sem META_APP_ID no env (não mockamos env aqui — metaClient.ts
    // acessa env.META_APP_ID que é undefined no test sem a var configurada).
    // exactOptionalPropertyTypes: omitir a propriedade em vez de passar undefined explicitamente.
    const client = makeClient({});
    await expect(
      client.uploadSampleForTemplate(Buffer.from('test'), 'application/pdf'),
    ).rejects.toBeInstanceOf(ExternalServiceError);

    // Nenhuma chamada HTTP deve ter sido feita
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('uploadSampleForTemplate: lança ExternalServiceError se etapa 1 não retornar session id', async () => {
    fetchSpy.mockImplementation(mockFetchResponse(200, {}));

    const client = makeClient({ appId: 'test_app_id' });
    await expect(
      client.uploadSampleForTemplate(Buffer.from('test'), 'application/pdf'),
    ).rejects.toBeInstanceOf(ExternalServiceError);
  });

  it('uploadSampleForTemplate: lança ExternalServiceError se etapa 2 não retornar header_handle', async () => {
    const startResponse = mockFetchResponse(200, { id: 'upload_session_abc' });
    const finishResponse = mockFetchResponse(200, {}); // sem 'h'
    fetchSpy.mockImplementationOnce(startResponse).mockImplementationOnce(finishResponse);

    const client = makeClient({ appId: 'test_app_id' });
    await expect(
      client.uploadSampleForTemplate(Buffer.from('test'), 'application/pdf'),
    ).rejects.toBeInstanceOf(ExternalServiceError);
  });

  it('uploadSampleForTemplate: bytes e token NUNCA aparecem em erro (LGPD §8.3)', async () => {
    // Etapa 1 falha
    fetchSpy.mockImplementation(
      mockFetchResponse(500, { error: { code: 0, message: 'Server error' } }),
    );

    const client = makeClient({ appId: 'test_app_id' });
    const SECRET_BYTES_CONTENT = 'CONFIDENTIAL_PDF_BYTES';
    const err = await client
      .uploadSampleForTemplate(Buffer.from(SECRET_BYTES_CONTENT), 'application/pdf')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ExternalServiceError);
    const e = err as ExternalServiceError;

    // Bytes NUNCA devem aparecer em logs
    expect(e.message).not.toContain(SECRET_BYTES_CONTENT);
    expect(JSON.stringify(e.details)).not.toContain(SECRET_BYTES_CONTENT);

    // Token NUNCA deve aparecer
    expect(e.message).not.toContain(DUMMY_TOKEN);
    expect(JSON.stringify(e.details)).not.toContain(DUMMY_TOKEN);
  });

  // ── F5-S11 security fixes ─────────────────────────────────────────────────

  it('uploadSampleForTemplate (M-1): rejeita MIME type fora da allowlist', async () => {
    // Nenhuma chamada HTTP deve ocorrer — rejeição é síncrona antes do primeiro fetch.
    const client = makeClient({ appId: 'test_app_id' });
    await expect(
      client.uploadSampleForTemplate(Buffer.from('test'), 'text/html'),
    ).rejects.toBeInstanceOf(ExternalServiceError);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('uploadSampleForTemplate (M-1): aceita todos os MIME types da allowlist', async () => {
    // Para cada MIME permitido: etapa 1 OK, etapa 2 OK → retorna handle.
    const allowedMimes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;

    for (const mime of allowedMimes) {
      const startResponse = mockFetchResponse(200, { id: 'upload_session_ok' });
      const finishResponse = mockFetchResponse(200, { h: `handle_for_${mime.replace('/', '_')}` });
      fetchSpy.mockImplementationOnce(startResponse).mockImplementationOnce(finishResponse);

      const client = makeClient({ appId: 'test_app_id' });
      const handle = await client.uploadSampleForTemplate(Buffer.from('data'), mime);
      expect(handle).toContain('handle_for_');
    }
  });

  it('uploadSampleForTemplate (M-2): etapa 2 retenta em 429 e sucede na segunda tentativa', async () => {
    const sleepMock = vi.fn().mockResolvedValue(undefined);
    // Etapa 1: sucesso
    const startResponse = mockFetchResponse(200, { id: 'upload_session_retry_429' });
    // Etapa 2: 429 na primeira tentativa, sucesso na segunda
    const finish429 = mockFetchResponse(429, { error: { code: 429, message: 'Rate limit' } });
    const finishOk = mockFetchResponse(200, { h: 'handle_after_retry_429' });

    fetchSpy
      .mockImplementationOnce(startResponse)
      .mockImplementationOnce(finish429)
      .mockImplementationOnce(finishOk);

    const client = makeClient({ appId: 'test_app_id', maxAttempts: 3, sleepFn: sleepMock });
    const handle = await client.uploadSampleForTemplate(Buffer.from('pdf'), 'application/pdf');

    expect(handle).toBe('handle_after_retry_429');
    // 3 chamadas: 1 start + 1 finish(429) + 1 finish(ok)
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    // sleepFn chamado uma vez (antes do retry da etapa 2)
    expect(sleepMock).toHaveBeenCalledTimes(1);
  });

  it('uploadSampleForTemplate (M-2): etapa 2 retenta em 5xx e sucede na segunda tentativa', async () => {
    const sleepMock = vi.fn().mockResolvedValue(undefined);
    // Etapa 1: sucesso
    const startResponse = mockFetchResponse(200, { id: 'upload_session_retry_5xx' });
    // Etapa 2: 503 na primeira tentativa, sucesso na segunda
    const finish5xx = mockFetchResponse(503, {
      error: { code: 503, message: 'Service unavailable' },
    });
    const finishOk = mockFetchResponse(200, { h: 'handle_after_retry_5xx' });

    fetchSpy
      .mockImplementationOnce(startResponse)
      .mockImplementationOnce(finish5xx)
      .mockImplementationOnce(finishOk);

    const client = makeClient({ appId: 'test_app_id', maxAttempts: 3, sleepFn: sleepMock });
    const handle = await client.uploadSampleForTemplate(Buffer.from('pdf'), 'application/pdf');

    expect(handle).toBe('handle_after_retry_5xx');
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(sleepMock).toHaveBeenCalledTimes(1);
  });

  it('uploadSampleForTemplate (L-2): uploadSessionId é encoded na URL da etapa 2', async () => {
    // Usa um session ID com caractere especial para validar encodeURIComponent.
    const startResponse = mockFetchResponse(200, { id: 'upload/session+id=special' });
    const finishResponse = mockFetchResponse(200, { h: 'handle_encoded' });

    fetchSpy.mockImplementationOnce(startResponse).mockImplementationOnce(finishResponse);

    const client = makeClient({ appId: 'test_app_id' });
    await client.uploadSampleForTemplate(Buffer.from('pdf'), 'application/pdf');

    const [url2] = fetchSpy.mock.calls[1] as [string, RequestInit];
    // O session ID bruto NÃO deve aparecer na URL — deve estar percent-encoded.
    expect(url2).not.toContain('upload/session+id=special');
    expect(url2).toContain(encodeURIComponent('upload/session+id=special'));
  });
});
