// =============================================================================
// integrations/langgraph/__tests__/client.test.ts
//
// Testes do LangGraphClient (F3-S33).
//
// Estratégia:
//   - fetch injetável via fetchFn option → sem nock, sem globals alterados.
//   - LangGraphClient aceita timeoutMs injetável → timeout testável sem wait real.
//   - Env mockada via vi.mock para controlar LANGGRAPH_SERVICE_URL e LANGGRAPH_INTERNAL_TOKEN.
//
// Cenários cobertos:
//   1. processWhatsAppMessage — envia POST com headers corretos e retorna response validado.
//   2. Propagação de X-Internal-Token no header.
//   3. Propagação de X-Correlation-Id no header.
//   4. Timeout de 8s lança ExternalServiceError.
//   5. Resposta HTTP não-ok (400, 500) lança ExternalServiceError.
//   6. Response com schema inválido lança ZodError.
//   7. Env não configurado lança ExternalServiceError na construção.
//   8. Request inválido (schema Zod) lança ZodError antes de fazer fetch.
// =============================================================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

import { ExternalServiceError } from '../../../shared/errors.js';
import { LangGraphClient } from '../client.js';
import type { LangGraphWhatsAppRequest } from '../schemas.js';

// ---------------------------------------------------------------------------
// Mock do módulo env
// ---------------------------------------------------------------------------

vi.mock('../../../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    LANGGRAPH_SERVICE_URL: 'http://langgraph.test.local:8000',
    LANGGRAPH_INTERNAL_TOKEN: 'a'.repeat(33),
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    JWT_ACCESS_SECRET: 'a'.repeat(64),
    JWT_REFRESH_SECRET: 'b'.repeat(64),
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_TTL: '30d',
    API_HOST: '0.0.0.0',
    API_PORT: 3333,
    API_PUBLIC_URL: 'http://localhost:3333',
    CORS_ALLOWED_ORIGINS: ['http://localhost:5173'],
    WHATSAPP_APP_SECRET: 'test-whatsapp-secret-at-least-16ch',
    WHATSAPP_VERIFY_TOKEN: 'test-verify-token',
  },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LANGGRAPH_BASE_URL = 'http://langgraph.test.local:8000';
const INTERNAL_TOKEN = 'a'.repeat(33);
const CORRELATION_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CONVERSATION_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

/** Request mínimo válido para POST /process/whatsapp/message (doc 06 §4.1). */
function makeRequest(overrides: Partial<LangGraphWhatsAppRequest> = {}): LangGraphWhatsAppRequest {
  return {
    organization_id: '00000000-0000-0000-0000-000000000001',
    conversation_id: CONVERSATION_ID,
    lead_id: null,
    customer_phone: '+5569999999999',
    message_text: 'Quero simular um crédito',
    message_attachments: [],
    message_timestamp: '2026-05-19T12:00:00.000Z',
    channel: 'whatsapp',
    chatwoot_conversation_id: '42',
    chatwoot_account_id: '1',
    metadata: {
      city_id: null,
      city_name: null,
      customer_name: null,
      previous_state_loaded: false,
    },
    correlation_id: CORRELATION_ID,
    idempotency_key: `wa_msg_wamid.test123`,
    ...overrides,
  };
}

/** Response válido de POST /process/whatsapp/message (doc 06 §4.2). */
function makeResponse() {
  return {
    conversation_id: CONVERSATION_ID,
    lead_id: null,
    reply: {
      type: 'text' as const,
      content: 'Claro, posso ajudar. Em qual cidade você está?',
      template_name: null,
      template_variables: null,
    },
    actions: [],
    handoff: {
      required: false,
      reason: null,
      summary: null,
    },
    state: {
      current_stage: 'collect_city',
      current_intent: 'simular_credito',
      next_expected_input: 'city',
      missing_fields: ['city', 'amount', 'term_months'],
    },
    model: 'claude-sonnet-4-5',
    prompt_version: 'pre_attendance@v3',
    graph_version: 'v1.0.0',
    latency_ms: 842,
    errors: [],
  };
}

/** Helper: cria um fetchFn que retorna uma Response JSON. */
function makeFetchFn(
  status: number,
  body: unknown,
  headers: Record<string, string> = { 'content-type': 'application/json' },
): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (key: string) => headers[key] ?? null },
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response);
}

// ---------------------------------------------------------------------------
// Helper para criar cliente com fetchFn injetável
// ---------------------------------------------------------------------------

function makeClient(fetchFn: typeof fetch, options: { timeoutMs?: number } = {}): LangGraphClient {
  return new LangGraphClient({
    baseUrl: LANGGRAPH_BASE_URL,
    internalToken: INTERNAL_TOKEN,
    timeoutMs: options.timeoutMs ?? 5_000,
    fetchFn,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LangGraphClient.processWhatsAppMessage()', () => {
  let capturedInit: RequestInit | undefined;

  beforeEach(() => {
    capturedInit = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. Caminho feliz — POST correto, response validado
  // -------------------------------------------------------------------------
  it('envia POST para /process/whatsapp/message e retorna response validado', async () => {
    const responseBody = makeResponse();
    const mockFetch = vi.fn().mockImplementation(async (_url: unknown, init?: RequestInit) => {
      capturedInit = init;
      return {
        ok: true,
        status: 200,
        headers: { get: (k: string) => (k === 'content-type' ? 'application/json' : null) },
        json: vi.fn().mockResolvedValue(responseBody),
      } as unknown as Response;
    });

    const client = makeClient(mockFetch as unknown as typeof fetch);
    const result = await client.processWhatsAppMessage(makeRequest(), CORRELATION_ID);

    // Verifica URL
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(`${LANGGRAPH_BASE_URL}/process/whatsapp/message`);

    // Verifica headers
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers?.['Content-Type']).toBe('application/json');
    expect(headers?.['X-Internal-Token']).toBe(INTERNAL_TOKEN);
    expect(headers?.['X-Correlation-Id']).toBe(CORRELATION_ID);

    // Verifica método
    expect(capturedInit?.method).toBe('POST');

    // Verifica body
    const sentBody = JSON.parse(capturedInit?.body as string) as Record<string, unknown>;
    expect(sentBody['conversation_id']).toBe(CONVERSATION_ID);
    expect(sentBody['channel']).toBe('whatsapp');

    // Verifica response parseado
    expect(result.conversation_id).toBe(CONVERSATION_ID);
    expect(result.reply.type).toBe('text');
    expect(result.graph_version).toBe('v1.0.0');
    expect(result.latency_ms).toBe(842);
    expect(result.handoff.required).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 2. X-Internal-Token propagado
  // -------------------------------------------------------------------------
  it('inclui X-Internal-Token no header da requisição', async () => {
    const customToken = 'b'.repeat(40);
    const mockFetch = vi.fn().mockImplementation(async (_u: unknown, init?: RequestInit) => {
      capturedInit = init;
      return {
        ok: true,
        status: 200,
        headers: { get: (k: string) => (k === 'content-type' ? 'application/json' : null) },
        json: vi.fn().mockResolvedValue(makeResponse()),
      } as unknown as Response;
    });

    const client = new LangGraphClient({
      baseUrl: LANGGRAPH_BASE_URL,
      internalToken: customToken,
      timeoutMs: 5_000,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    await client.processWhatsAppMessage(makeRequest(), CORRELATION_ID);

    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers?.['X-Internal-Token']).toBe(customToken);
  });

  // -------------------------------------------------------------------------
  // 3. X-Correlation-Id propagado
  // -------------------------------------------------------------------------
  it('propaga X-Correlation-Id no header da requisição', async () => {
    const customCorrelation = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    const mockFetch = vi.fn().mockImplementation(async (_u: unknown, init?: RequestInit) => {
      capturedInit = init;
      return {
        ok: true,
        status: 200,
        headers: { get: (k: string) => (k === 'content-type' ? 'application/json' : null) },
        json: vi.fn().mockResolvedValue(makeResponse()),
      } as unknown as Response;
    });

    const client = makeClient(mockFetch as unknown as typeof fetch);
    await client.processWhatsAppMessage(makeRequest(), customCorrelation);

    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers?.['X-Correlation-Id']).toBe(customCorrelation);
  });

  // -------------------------------------------------------------------------
  // 4. Timeout lança ExternalServiceError
  // -------------------------------------------------------------------------
  it('lança ExternalServiceError quando AbortSignal dispara (timeout)', async () => {
    const hangingFetch = vi
      .fn()
      .mockImplementation((_u: unknown, init?: RequestInit): Promise<Response> => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const abortError = new DOMException('The operation was aborted.', 'AbortError');
            reject(abortError);
          });
        });
      });

    const client = new LangGraphClient({
      baseUrl: LANGGRAPH_BASE_URL,
      internalToken: INTERNAL_TOKEN,
      timeoutMs: 10, // dispara em 10ms
      fetchFn: hangingFetch as unknown as typeof fetch,
    });

    const error = await client
      .processWhatsAppMessage(makeRequest(), CORRELATION_ID)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ExternalServiceError);
    if (error instanceof ExternalServiceError) {
      expect(error.message).toMatch(/timeout/i);
    }
  });

  // -------------------------------------------------------------------------
  // 5. HTTP não-ok lança ExternalServiceError
  // -------------------------------------------------------------------------
  it('lança ExternalServiceError para HTTP 500', async () => {
    const mockFetch = makeFetchFn(500, { error: 'Internal Server Error' });
    const client = makeClient(mockFetch);

    const error = await client
      .processWhatsAppMessage(makeRequest(), CORRELATION_ID)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ExternalServiceError);
    if (error instanceof ExternalServiceError) {
      expect(error.message).toContain('500');
    }
  });

  it('lança ExternalServiceError para HTTP 422', async () => {
    const mockFetch = makeFetchFn(422, { detail: 'Validation failed' });
    const client = makeClient(mockFetch);

    await expect(
      client.processWhatsAppMessage(makeRequest(), CORRELATION_ID),
    ).rejects.toBeInstanceOf(ExternalServiceError);
  });

  it('lança ExternalServiceError para HTTP 401 (token inválido)', async () => {
    const mockFetch = makeFetchFn(401, { error: 'Unauthorized' });
    const client = makeClient(mockFetch);

    await expect(
      client.processWhatsAppMessage(makeRequest(), CORRELATION_ID),
    ).rejects.toBeInstanceOf(ExternalServiceError);
  });

  // -------------------------------------------------------------------------
  // 6. Response com schema inválido lança ZodError
  // -------------------------------------------------------------------------
  it('lança ZodError quando response não respeita o schema esperado', async () => {
    // Response sem campos obrigatórios (graph_version, handoff, reply, state)
    const mockFetch = makeFetchFn(200, { conversation_id: CONVERSATION_ID });
    const client = makeClient(mockFetch);

    await expect(
      client.processWhatsAppMessage(makeRequest(), CORRELATION_ID),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it('valida reply.type como enum text|template|none', async () => {
    const invalidResponse = { ...makeResponse(), reply: { type: 'invalid_type', content: '' } };
    const mockFetch = makeFetchFn(200, invalidResponse);
    const client = makeClient(mockFetch);

    await expect(
      client.processWhatsAppMessage(makeRequest(), CORRELATION_ID),
    ).rejects.toBeInstanceOf(ZodError);
  });

  // -------------------------------------------------------------------------
  // 7. Env não configurado lança ExternalServiceError na construção
  // -------------------------------------------------------------------------
  it('lança ExternalServiceError na construção se baseUrl ausente', () => {
    expect(
      () =>
        new LangGraphClient({
          baseUrl: '',
          internalToken: INTERNAL_TOKEN,
        }),
    ).toThrow(ExternalServiceError);
  });

  it('lança ExternalServiceError na construção se internalToken ausente', () => {
    expect(
      () =>
        new LangGraphClient({
          baseUrl: LANGGRAPH_BASE_URL,
          internalToken: '',
        }),
    ).toThrow(ExternalServiceError);
  });

  // -------------------------------------------------------------------------
  // 8. Request com schema inválido lança ZodError antes de fetch
  // -------------------------------------------------------------------------
  it('lança ZodError quando customer_phone não é E.164 válido (sem +)', async () => {
    const mockFetch = vi.fn();
    const client = makeClient(mockFetch as unknown as typeof fetch);

    // customer_phone sem prefixo + — não passa regex E.164
    const badRequest = makeRequest({ customer_phone: '5569999999999' });

    await expect(client.processWhatsAppMessage(badRequest, CORRELATION_ID)).rejects.toBeInstanceOf(
      ZodError,
    );

    // fetch não deve ter sido chamado
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('[MÉDIO-2] lança ZodError quando customer_phone tem + mas não é E.164 (muito curto)', async () => {
    const mockFetch = vi.fn();
    const client = makeClient(mockFetch as unknown as typeof fetch);

    // '+1234567' → apenas 7 dígitos após +1 → menos de 7+1 = 8 total → inválido
    const badRequest = makeRequest({ customer_phone: '+123456' });

    await expect(client.processWhatsAppMessage(badRequest, CORRELATION_ID)).rejects.toBeInstanceOf(
      ZodError,
    );

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('[MÉDIO-2] aceita customer_phone válido no formato E.164', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: (k: string) => (k === 'content-type' ? 'application/json' : null) },
      json: vi.fn().mockResolvedValue(makeResponse()),
    } as unknown as Response);

    const client = makeClient(mockFetch as unknown as typeof fetch);

    // E.164 válido: +5569999999999 (Brasil)
    const validRequest = makeRequest({ customer_phone: '+5569999999999' });

    await expect(
      client.processWhatsAppMessage(validRequest, CORRELATION_ID),
    ).resolves.toBeDefined();

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('lança ZodError quando channel não é whatsapp', async () => {
    const mockFetch = vi.fn();
    const client = makeClient(mockFetch as unknown as typeof fetch);

    // Justificativa do `as`: forçando canal inválido para testar validação de schema
    const badRequest = makeRequest({ channel: 'sms' as 'whatsapp' });

    await expect(client.processWhatsAppMessage(badRequest, CORRELATION_ID)).rejects.toBeInstanceOf(
      ZodError,
    );

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
