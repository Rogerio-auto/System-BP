// =============================================================================
// integrations/langgraph/__tests__/playground-client.test.ts — Testes (F9-S04).
//
// Estratégia:
//   - fetch injetável via fetchFn option → sem nock, sem globals alterados.
//   - LangGraphPlaygroundClient aceita timeoutMs injetável → timeout testável.
//   - Env mockada via vi.mock.
//
// Cenários cobertos:
//   1. runPlayground — envia POST com dry_run=true e headers corretos.
//   2. Propagação de X-Internal-Token.
//   3. Propagação de X-Correlation-Id.
//   4. Timeout de 12s lança ExternalServiceError.
//   5. Resposta HTTP não-ok (400, 500) lança ExternalServiceError.
//   6. Response com schema inválido lança ZodError.
//   7. Env não configurado lança ExternalServiceError na construção.
//   8. dry_run ausente ou false lança ZodError (Zod literal).
// =============================================================================
import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

import { ExternalServiceError } from '../../../shared/errors.js';
import { LangGraphPlaygroundClient, PlaygroundRequestSchema } from '../playground-client.js';
import type { PlaygroundRequest } from '../playground-client.js';

// ---------------------------------------------------------------------------
// Mock env
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

function makeRequest(overrides: Partial<PlaygroundRequest> = {}): PlaygroundRequest {
  return {
    dry_run: true,
    conversation_id: CONVERSATION_ID,
    lead_id: null,
    customer_phone: '+5569999990000',
    // message_text já redactada por DLP antes de chegar ao client
    message_text: 'Olá quero simular um crédito',
    message_attachments: [],
    message_timestamp: '2026-05-19T12:00:00.000Z',
    channel: 'whatsapp',
    chatwoot_conversation_id: `playground-${CONVERSATION_ID}`,
    chatwoot_account_id: 'playground-account',
    allow_real_reads: false,
    metadata: {
      city_id: null,
      city_name: null,
      customer_name: null,
      previous_state_loaded: false,
    },
    correlation_id: CORRELATION_ID,
    idempotency_key: `playground-${CONVERSATION_ID}`,
    ...overrides,
  };
}

/** Response mínimo válido de POST /process/whatsapp/playground (F9-S03). */
function makeValidResponse() {
  return {
    conversation_id: CONVERSATION_ID,
    dry_run: true,
    reply_type: 'text',
    reply_content: 'Olá! Como posso ajudar?',
    handoff_required: false,
    handoff_reason: null,
    trace: [],
    prompt_versions_used: [],
    tokens_total: 0,
    graph_version: '1.0.0',
    latency_ms: 500,
    errors: [],
  };
}

function makeMockFetch(status: number, body: unknown): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe('LangGraphPlaygroundClient', () => {
  describe('[7] Construção — env não configurado', () => {
    it('lança ExternalServiceError quando LANGGRAPH_SERVICE_URL ausente', () => {
      expect(
        () =>
          new LangGraphPlaygroundClient({
            baseUrl: '',
            internalToken: INTERNAL_TOKEN,
          }),
      ).toThrow(ExternalServiceError);
    });

    it('lança ExternalServiceError quando LANGGRAPH_INTERNAL_TOKEN ausente', () => {
      expect(
        () =>
          new LangGraphPlaygroundClient({
            baseUrl: LANGGRAPH_BASE_URL,
            internalToken: '',
          }),
      ).toThrow(ExternalServiceError);
    });
  });

  describe('[1] runPlayground — request e response', () => {
    it('envia POST /process/whatsapp/playground com body dry_run=true', async () => {
      const mockFetch = makeMockFetch(200, makeValidResponse());
      const client = new LangGraphPlaygroundClient({
        baseUrl: LANGGRAPH_BASE_URL,
        internalToken: INTERNAL_TOKEN,
        fetchFn: mockFetch,
      });

      await client.runPlayground(makeRequest(), CORRELATION_ID);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        RequestInit,
      ];
      expect(url).toBe(`${LANGGRAPH_BASE_URL}/process/whatsapp/playground`);
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body as string) as Record<string, unknown>;
      expect(body['dry_run']).toBe(true);
    });

    it('[2] propaga X-Internal-Token no header', async () => {
      const mockFetch = makeMockFetch(200, makeValidResponse());
      const client = new LangGraphPlaygroundClient({
        baseUrl: LANGGRAPH_BASE_URL,
        internalToken: INTERNAL_TOKEN,
        fetchFn: mockFetch,
      });

      await client.runPlayground(makeRequest(), CORRELATION_ID);

      const [, opts] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        RequestInit,
      ];
      const headers = opts.headers as Record<string, string>;
      expect(headers['X-Internal-Token']).toBe(INTERNAL_TOKEN);
    });

    it('[3] propaga X-Correlation-Id no header', async () => {
      const mockFetch = makeMockFetch(200, makeValidResponse());
      const client = new LangGraphPlaygroundClient({
        baseUrl: LANGGRAPH_BASE_URL,
        internalToken: INTERNAL_TOKEN,
        fetchFn: mockFetch,
      });

      await client.runPlayground(makeRequest(), CORRELATION_ID);

      const [, opts] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        RequestInit,
      ];
      const headers = opts.headers as Record<string, string>;
      expect(headers['X-Correlation-Id']).toBe(CORRELATION_ID);
    });

    it('retorna PlaygroundResponse válido com trace vazio', async () => {
      const mockFetch = makeMockFetch(200, makeValidResponse());
      const client = new LangGraphPlaygroundClient({
        baseUrl: LANGGRAPH_BASE_URL,
        internalToken: INTERNAL_TOKEN,
        fetchFn: mockFetch,
      });

      const result = await client.runPlayground(makeRequest(), CORRELATION_ID);

      expect(result.dry_run).toBe(true);
      expect(result.conversation_id).toBe(CONVERSATION_ID);
      expect(result.latency_ms).toBe(500);
    });
  });

  describe('[4] Timeout', () => {
    it('lança ExternalServiceError após timeout de 12s (simulado via AbortError)', async () => {
      const abortFetch = vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' }),
        ) as unknown as typeof fetch;

      const client = new LangGraphPlaygroundClient({
        baseUrl: LANGGRAPH_BASE_URL,
        internalToken: INTERNAL_TOKEN,
        timeoutMs: 1, // timeout de 1ms para forçar o abort
        fetchFn: abortFetch,
      });

      await expect(client.runPlayground(makeRequest(), CORRELATION_ID)).rejects.toThrow(
        ExternalServiceError,
      );
    });
  });

  describe('[5] HTTP errors', () => {
    it('lança ExternalServiceError para status 400', async () => {
      const mockFetch = makeMockFetch(400, { detail: 'bad request' });
      const client = new LangGraphPlaygroundClient({
        baseUrl: LANGGRAPH_BASE_URL,
        internalToken: INTERNAL_TOKEN,
        fetchFn: mockFetch,
      });

      await expect(client.runPlayground(makeRequest(), CORRELATION_ID)).rejects.toThrow(
        ExternalServiceError,
      );
    });

    it('lança ExternalServiceError para status 500', async () => {
      const mockFetch = makeMockFetch(500, { detail: 'internal error' });
      const client = new LangGraphPlaygroundClient({
        baseUrl: LANGGRAPH_BASE_URL,
        internalToken: INTERNAL_TOKEN,
        fetchFn: mockFetch,
      });

      await expect(client.runPlayground(makeRequest(), CORRELATION_ID)).rejects.toThrow(
        ExternalServiceError,
      );
    });
  });

  describe('[6] Schema inválido', () => {
    it('lança ZodError quando response body não tem dry_run=true', async () => {
      const invalidResponse = { ...makeValidResponse(), dry_run: false };
      const mockFetch = makeMockFetch(200, invalidResponse);
      const client = new LangGraphPlaygroundClient({
        baseUrl: LANGGRAPH_BASE_URL,
        internalToken: INTERNAL_TOKEN,
        fetchFn: mockFetch,
      });

      await expect(client.runPlayground(makeRequest(), CORRELATION_ID)).rejects.toThrow(ZodError);
    });

    it('lança ZodError quando response não tem conversation_id', async () => {
      const { conversation_id: _omit, ...invalidResponse } = makeValidResponse();
      const mockFetch = makeMockFetch(200, invalidResponse);
      const client = new LangGraphPlaygroundClient({
        baseUrl: LANGGRAPH_BASE_URL,
        internalToken: INTERNAL_TOKEN,
        fetchFn: mockFetch,
      });

      await expect(client.runPlayground(makeRequest(), CORRELATION_ID)).rejects.toThrow(ZodError);
    });
  });

  describe('[8] Request com dry_run ausente', () => {
    it('PlaygroundRequestSchema rejeita dry_run=false', () => {
      expect(() =>
        PlaygroundRequestSchema.parse({
          ...makeRequest(),
          dry_run: false,
        }),
      ).toThrow(ZodError);
    });
  });
});
