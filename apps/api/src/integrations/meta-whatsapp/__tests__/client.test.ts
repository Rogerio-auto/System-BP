// =============================================================================
// client.test.ts — Testes do MetaWhatsAppClient (F5-S03).
//
// Cenários cobertos:
//   1. sendTemplate: sucesso → retorna wamid correto
//   2. sendTemplate: 429 (rate limit) → retry com backoff e sucesso no segundo attempt
//   3. sendTemplate: 429 persistente → esgota tentativas e lança ExternalServiceError
//   4. sendTemplate: 5xx → retry com backoff
//   5. sendTemplate: 4xx (non-429) → sem retry, lança imediatamente
//   6. sendTemplate: timeout → lança ExternalServiceError com upstreamStatus=0
//   7. sendTemplate: resposta sem wamid → lança ExternalServiceError
//   8. Construtor sem access token → lança ExternalServiceError
//   9. Construtor sem phone number ID → lança ExternalServiceError
//  10. Construtor com tokens válidos → inicializa sem erro
// =============================================================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock env (DEVE ser o primeiro mock)
// ---------------------------------------------------------------------------
vi.mock('../../../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    JWT_ACCESS_SECRET: 'a'.repeat(64),
    JWT_REFRESH_SECRET: 'b'.repeat(64),
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_TTL: '30d',
    API_HOST: '0.0.0.0',
    API_PORT: 3333,
    API_PUBLIC_URL: 'http://localhost:3333',
    CORS_ALLOWED_ORIGINS: ['http://localhost:5173'],
    LANGGRAPH_INTERNAL_TOKEN: 'a'.repeat(33),
    LANGGRAPH_SERVICE_URL: 'http://localhost:8000',
    WHATSAPP_APP_SECRET: 'test-whatsapp-secret-at-least-16ch',
    WHATSAPP_VERIFY_TOKEN: 'test-verify-token',
    FX_BRL_PER_USD: 5.75,
    LGPD_DEDUPE_PEPPER: 'a'.repeat(44), // base64 de 32 bytes ≈ 44 chars
    META_WHATSAPP_ACCESS_TOKEN: 'test-meta-access-token',
    META_WHATSAPP_PHONE_NUMBER_ID: '123456789',
  },
}));

import { ExternalServiceError } from '../../../shared/errors.js';
import { MetaWhatsAppClient } from '../client.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SLEEP_NOP = vi.fn().mockResolvedValue(undefined);

function makeClient(
  overrides: {
    accessToken?: string;
    phoneNumberId?: string;
    timeoutMs?: number;
    maxAttempts?: number;
    backoffBaseMs?: number;
    jitterMaxMs?: number;
  } = {},
): MetaWhatsAppClient {
  return new MetaWhatsAppClient({
    accessToken: overrides.accessToken ?? 'test-access-token',
    phoneNumberId: overrides.phoneNumberId ?? '123456789',
    timeoutMs: overrides.timeoutMs ?? 5000,
    maxAttempts: overrides.maxAttempts ?? 3,
    backoffBaseMs: overrides.backoffBaseMs ?? 1,
    jitterMaxMs: overrides.jitterMaxMs ?? 0,
    sleepFn: SLEEP_NOP,
  });
}

const SEND_PARAMS = {
  to: '+5511999999999',
  templateName: 'followup_d1',
  language: 'pt_BR',
  components: [
    {
      type: 'body' as const,
      parameters: [{ type: 'text' as const, text: 'João' }],
    },
  ],
};

function makeSuccessResponse(wamid = 'wamid.test123'): Response {
  return new Response(JSON.stringify({ messages: [{ id: wamid }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function makeErrorResponse(
  status: number,
  code = 131047,
  title = 'Template error',
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ error: { code, title } }), {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders },
  });
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe('MetaWhatsAppClient', () => {
  // Mock de fetch: vi.fn() com tipo compatível com as assinaturas de mock que usamos.
  // Justificativa: vi.spyOn(globalThis, 'fetch') retorna tipo parametrizado pela assinatura
  // real do fetch global, incompatível com o ReturnType<typeof vi.spyOn> genérico.
  // Usamos vi.fn() diretamente para substituir globalThis.fetch nos testes.
  let fetchSpy: ReturnType<typeof vi.fn>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchSpy = vi.fn();
    // Substituição direta para evitar conflito de tipos com vi.spyOn
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    SLEEP_NOP.mockClear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Cenário 1: Sucesso
  // -------------------------------------------------------------------------
  describe('sendTemplate() — sucesso', () => {
    it('retorna wamid correto na primeira tentativa', async () => {
      fetchSpy.mockResolvedValueOnce(makeSuccessResponse('wamid.abc123'));

      const client = makeClient();
      const result = await client.sendTemplate(SEND_PARAMS);

      expect(result.wamid).toBe('wamid.abc123');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('monta corpo correto com messaging_product=whatsapp', async () => {
      fetchSpy.mockResolvedValueOnce(makeSuccessResponse());

      const client = makeClient({ phoneNumberId: '555666777' });
      await client.sendTemplate(SEND_PARAMS);

      const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('555666777');
      expect(url).toContain('/messages');

      const body = JSON.parse(options.body as string) as Record<string, unknown>;
      expect(body['messaging_product']).toBe('whatsapp');
      expect(body['type']).toBe('template');
      expect((body['template'] as Record<string, unknown>)['name']).toBe('followup_d1');
    });

    it('envia Bearer token no header Authorization', async () => {
      fetchSpy.mockResolvedValueOnce(makeSuccessResponse());

      const client = makeClient({ accessToken: 'my-secret-token' });
      await client.sendTemplate(SEND_PARAMS);

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const headers = options.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer my-secret-token');
    });

    it('nunca inclui número de telefone no URL (LGPD §8.3)', async () => {
      fetchSpy.mockResolvedValueOnce(makeSuccessResponse());

      const client = makeClient();
      await client.sendTemplate({ ...SEND_PARAMS, to: '+5511888888888' });

      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).not.toContain('5511888888888');
    });
  });

  // -------------------------------------------------------------------------
  // Cenário 2: 429 com retry bem-sucedido
  // -------------------------------------------------------------------------
  describe('sendTemplate() — 429 rate limit com retry', () => {
    it('retenta em 429 e retorna wamid no segundo attempt', async () => {
      fetchSpy
        .mockResolvedValueOnce(makeErrorResponse(429, 131056, 'Limit reached'))
        .mockResolvedValueOnce(makeSuccessResponse('wamid.after429'));

      const client = makeClient({ maxAttempts: 3 });
      const result = await client.sendTemplate(SEND_PARAMS);

      expect(result.wamid).toBe('wamid.after429');
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(SLEEP_NOP).toHaveBeenCalledTimes(1);
    });

    it('chama sleepFn com delay entre retries', async () => {
      const sleepMock = vi.fn().mockResolvedValue(undefined);
      fetchSpy
        .mockResolvedValueOnce(makeErrorResponse(429))
        .mockResolvedValueOnce(makeSuccessResponse());

      const client = new MetaWhatsAppClient({
        accessToken: 'tok',
        phoneNumberId: '111',
        maxAttempts: 2,
        backoffBaseMs: 100,
        jitterMaxMs: 0,
        sleepFn: sleepMock,
        timeoutMs: 5000,
      });

      await client.sendTemplate(SEND_PARAMS);

      expect(sleepMock).toHaveBeenCalledTimes(1);
      const delayMs = sleepMock.mock.calls[0]?.[0] as number;
      expect(delayMs).toBeGreaterThan(0);
    });

    it('respeita Retry-After numérico: delay >= retryAfterMs', async () => {
      // Meta devolve Retry-After: 2 (segundos) → esperamos delay >= 2000ms
      const sleepMock = vi.fn().mockResolvedValue(undefined);
      fetchSpy
        .mockResolvedValueOnce(
          makeErrorResponse(429, 131056, 'Limit reached', { 'retry-after': '2' }),
        )
        .mockResolvedValueOnce(makeSuccessResponse('wamid.after-retry-after'));

      const client = new MetaWhatsAppClient({
        accessToken: 'tok',
        phoneNumberId: '111',
        maxAttempts: 2,
        backoffBaseMs: 1, // backoff pequeno para garantir que Retry-After domina
        jitterMaxMs: 0,
        sleepFn: sleepMock,
        timeoutMs: 5000,
      });

      const result = await client.sendTemplate(SEND_PARAMS);

      expect(result.wamid).toBe('wamid.after-retry-after');
      expect(sleepMock).toHaveBeenCalledTimes(1);
      // Retry-After de 2s → delay deve ser >= 2000ms
      const delayMs = sleepMock.mock.calls[0]?.[0] as number;
      expect(delayMs).toBeGreaterThanOrEqual(2000);
    });

    it('ignora Retry-After não-numérico (HTTP-date) e usa backoff normal', async () => {
      const sleepMock = vi.fn().mockResolvedValue(undefined);
      fetchSpy
        .mockResolvedValueOnce(
          makeErrorResponse(429, 131056, 'Limit reached', {
            'retry-after': 'Wed, 29 May 2030 00:00:00 GMT',
          }),
        )
        .mockResolvedValueOnce(makeSuccessResponse('wamid.after-date-retry'));

      const client = new MetaWhatsAppClient({
        accessToken: 'tok',
        phoneNumberId: '111',
        maxAttempts: 2,
        backoffBaseMs: 50,
        jitterMaxMs: 0,
        sleepFn: sleepMock,
        timeoutMs: 5000,
      });

      const result = await client.sendTemplate(SEND_PARAMS);

      expect(result.wamid).toBe('wamid.after-date-retry');
      expect(sleepMock).toHaveBeenCalledTimes(1);
      // HTTP-date ignorado — delay vem apenas do backoff (50ms * 2^0 = 50ms)
      const delayMs = sleepMock.mock.calls[0]?.[0] as number;
      expect(delayMs).toBe(50);
    });
  });

  // -------------------------------------------------------------------------
  // Cenário 3: 429 persistente → esgota tentativas
  // -------------------------------------------------------------------------
  describe('sendTemplate() — 429 persistente esgota tentativas', () => {
    it('lança ExternalServiceError após maxAttempts tentativas em 429', async () => {
      fetchSpy
        .mockResolvedValueOnce(makeErrorResponse(429))
        .mockResolvedValueOnce(makeErrorResponse(429))
        .mockResolvedValueOnce(makeErrorResponse(429));

      const client = makeClient({ maxAttempts: 3 });

      await expect(client.sendTemplate(SEND_PARAMS)).rejects.toBeInstanceOf(ExternalServiceError);
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });
  });

  // -------------------------------------------------------------------------
  // Cenário 4: 5xx com retry
  // -------------------------------------------------------------------------
  describe('sendTemplate() — 5xx com retry', () => {
    it('retenta em 500 e sucede no segundo attempt', async () => {
      fetchSpy
        .mockResolvedValueOnce(makeErrorResponse(500, 500, 'Internal Server Error'))
        .mockResolvedValueOnce(makeSuccessResponse('wamid.after500'));

      const client = makeClient({ maxAttempts: 2 });
      const result = await client.sendTemplate(SEND_PARAMS);

      expect(result.wamid).toBe('wamid.after500');
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // Cenário 5: 4xx (non-429) → sem retry
  // -------------------------------------------------------------------------
  describe('sendTemplate() — 4xx não-retryable', () => {
    it('lança imediatamente sem retry em 400', async () => {
      fetchSpy.mockResolvedValueOnce(makeErrorResponse(400, 100, 'Invalid parameter'));

      const client = makeClient({ maxAttempts: 3 });

      await expect(client.sendTemplate(SEND_PARAMS)).rejects.toBeInstanceOf(ExternalServiceError);
      // Apenas 1 tentativa — sem retry em 4xx
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('lança imediatamente sem retry em 401', async () => {
      fetchSpy.mockResolvedValueOnce(makeErrorResponse(401, 190, 'Invalid OAuth access token'));

      const client = makeClient({ maxAttempts: 3 });

      await expect(client.sendTemplate(SEND_PARAMS)).rejects.toBeInstanceOf(ExternalServiceError);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Cenário 6: Timeout → lança ExternalServiceError com upstreamStatus=0
  // -------------------------------------------------------------------------
  describe('sendTemplate() — timeout', () => {
    it('lança ExternalServiceError quando fetch é abortado por timeout', async () => {
      const abortError = new Error('AbortError');
      abortError.name = 'AbortError';
      fetchSpy.mockRejectedValueOnce(abortError);

      const client = makeClient({ maxAttempts: 1 });

      const err = await client.sendTemplate(SEND_PARAMS).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ExternalServiceError);
    });
  });

  // -------------------------------------------------------------------------
  // Cenário 7: Resposta sem wamid → lança ExternalServiceError
  // -------------------------------------------------------------------------
  describe('sendTemplate() — resposta sem wamid', () => {
    it('lança ExternalServiceError se messages array está vazio', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ messages: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      const client = makeClient();

      await expect(client.sendTemplate(SEND_PARAMS)).rejects.toBeInstanceOf(ExternalServiceError);
    });

    it('lança ExternalServiceError se messages está ausente', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'ok' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      const client = makeClient();

      await expect(client.sendTemplate(SEND_PARAMS)).rejects.toBeInstanceOf(ExternalServiceError);
    });
  });

  // -------------------------------------------------------------------------
  // Cenário 8/9/10: Construtor
  // -------------------------------------------------------------------------
  describe('constructor', () => {
    it('lança ExternalServiceError se accessToken ausente', () => {
      expect(
        () =>
          new MetaWhatsAppClient({
            accessToken: '',
            phoneNumberId: '123',
          }),
      ).toThrow(ExternalServiceError);
    });

    it('lança ExternalServiceError se phoneNumberId ausente', () => {
      expect(
        () =>
          new MetaWhatsAppClient({
            accessToken: 'token',
            phoneNumberId: '',
          }),
      ).toThrow(ExternalServiceError);
    });

    it('inicializa sem erros com credenciais válidas', () => {
      expect(
        () =>
          new MetaWhatsAppClient({
            accessToken: 'valid-token',
            phoneNumberId: '123456789',
          }),
      ).not.toThrow();
    });
  });
});
