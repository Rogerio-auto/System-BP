// =============================================================================
// whatsapp/handlers/__tests__/ai-fallback.test.ts — Testes do fallback de
// handoff automático em falha do LangGraph (F3-S34).
//
// Estratégia:
//   - Chatwoot: nock intercepta chamadas HTTP reais (padrão do projeto).
//   - /internal/*: fetchFn injetável via AiFallbackOptions.fetchFn.
//   - Sem dependência de banco — ai-fallback.ts não acessa DB diretamente.
//
// Cenários cobertos:
//   1. Fallback completo: mensagem Chatwoot + ai/decisions + handoffs (caminho feliz).
//   2. Chatwoot falha → handoff ainda é criado (falha não propaga).
//   3. chatwootConversationId = 0 → Chatwoot não é chamado.
//   4. POST /internal/ai/decisions retorna 500 → ExternalServiceError lançado.
//   5. POST /internal/handoffs retorna 422 → ExternalServiceError lançado.
//   6. leadId null → handoff não é criado (log de aviso), sem throw.
//   7. aiErrorMessage é truncado para 500 chars antes de passar ao fallback.
//   8. Idempotência: chave de idempotência do handoff inclui waMessageId.
//   9. fetch de /internal/* falha com erro de rede → ExternalServiceError lançado.
//   10. Mensagem de fallback ao Chatwoot usa o texto canônico do doc 06 §4.4.
// =============================================================================
import nock from 'nock';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

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
    CHATWOOT_BASE_URL: 'http://chatwoot.test.local',
    CHATWOOT_API_TOKEN: 'test-chatwoot-token',
    CHATWOOT_ACCOUNT_ID: 1,
  },
}));

// ---------------------------------------------------------------------------
// Import do módulo (após mocks de env)
// ---------------------------------------------------------------------------
import { ExternalServiceError } from '../../../../shared/errors.js';
import { triggerAiFallback } from '../ai-fallback.js';
import type { AiFallbackContext, AiFallbackOptions } from '../ai-fallback.js';

// ---------------------------------------------------------------------------
// Constantes de teste
// ---------------------------------------------------------------------------

const CHATWOOT_BASE_URL = 'http://chatwoot.test.local';
const CHATWOOT_ACCOUNT_ID = 1;
const CHATWOOT_CONVERSATION_ID = 42;
const INTERNAL_BASE_URL = 'http://localhost:3333';
const INTERNAL_TOKEN = 'a'.repeat(33);

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const LEAD_ID = '22222222-2222-2222-2222-222222222222';
const CONVERSATION_ID = '44444444-4444-4444-4444-444444444444';
const CORRELATION_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const WA_MESSAGE_ID = 'wamid.test_abc123';
const EVENT_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const DECISION_LOG_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const HANDOFF_ID = 'hhhhhhhhh-hhhh-hhhh-hhhh-hhhhhhhhhhhh';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Contexto padrão com todos os campos preenchidos. */
const defaultCtx: AiFallbackContext = {
  eventId: EVENT_ID,
  correlationId: CORRELATION_ID,
  conversationId: CONVERSATION_ID,
  chatwootConversationId: CHATWOOT_CONVERSATION_ID,
  organizationId: ORG_ID,
  leadId: LEAD_ID,
  waMessageId: WA_MESSAGE_ID,
  aiErrorMessage: 'LangGraph timeout após 8000ms',
};

/** Resposta Chatwoot ao criar mensagem. */
const chatwootMessageResponse = {
  id: 999,
  content: 'Recebi sua mensagem. Vou te transferir para um atendente.',
  message_type: 'outgoing',
  private: false,
  created_at: 1716115200,
  conversation_id: CHATWOOT_CONVERSATION_ID,
  account_id: CHATWOOT_ACCOUNT_ID,
};

/** Path do endpoint de mensagens Chatwoot. */
function chatwootMessagesPath(): string {
  return `/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${CHATWOOT_CONVERSATION_ID}/messages`;
}

// ---------------------------------------------------------------------------
// Helpers para injeção
// ---------------------------------------------------------------------------

/**
 * Cria opções de injeção para o fallback com fetchFn customizável.
 * Chatwoot via nock (HTTP real interceptado).
 */
function makeFallbackOptions(overrides: Partial<AiFallbackOptions> = {}): AiFallbackOptions {
  return {
    chatwootOptions: {
      baseUrl: CHATWOOT_BASE_URL,
      apiToken: 'test-chatwoot-token',
      accountId: CHATWOOT_ACCOUNT_ID,
      timeoutMs: 5_000,
    },
    internalBaseUrl: INTERNAL_BASE_URL,
    internalToken: INTERNAL_TOKEN,
    ...overrides,
  };
}

/**
 * Cria um fetchFn que retorna uma resposta JSON com sucesso para chamadas /internal/*.
 * Intercepta tanto /internal/ai/decisions quanto /internal/handoffs.
 */
function makeInternalFetch(
  decisionResponse: { status: number; body: unknown },
  handoffResponse: { status: number; body: unknown },
): {
  fetchFn: typeof fetch;
  capturedRequests: Array<{ url: string; body: unknown; headers: Record<string, string> }>;
} {
  const capturedRequests: Array<{ url: string; body: unknown; headers: Record<string, string> }> =
    [];

  const fetchFn: typeof fetch = vi
    .fn()
    .mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const urlStr = String(url);
      const body = init?.body !== undefined ? (JSON.parse(init.body as string) as unknown) : null;
      const headers = (init?.headers ?? {}) as Record<string, string>;
      capturedRequests.push({ url: urlStr, body, headers });

      if (urlStr.includes('/ai/decisions')) {
        return new Response(JSON.stringify(decisionResponse.body), {
          status: decisionResponse.status,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (urlStr.includes('/handoffs')) {
        return new Response(JSON.stringify(handoffResponse.body), {
          status: handoffResponse.status,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'unexpected endpoint' }), { status: 404 });
    });

  return { fetchFn, capturedRequests };
}

/** Resposta padrão de sucesso para ai/decisions. */
const decisionOk = { status: 200, body: { decision_log_id: DECISION_LOG_ID } };
/** Resposta padrão de sucesso para handoffs. */
const handoffOk = {
  status: 200,
  body: {
    handoff_id: HANDOFF_ID,
    chatwoot_conversation_id: String(CHATWOOT_CONVERSATION_ID),
    assigned_agent_id: null,
    status: 'requested',
  },
};

// ---------------------------------------------------------------------------
// Setup / teardown nock
// ---------------------------------------------------------------------------

beforeAll(() => {
  nock.disableNetConnect();
});

afterAll(() => {
  nock.enableNetConnect();
  nock.cleanAll();
});

afterEach(() => {
  nock.cleanAll();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('triggerAiFallback', () => {
  // -------------------------------------------------------------------------
  // 1. Fallback completo: mensagem Chatwoot + ai/decisions + handoffs
  // -------------------------------------------------------------------------
  it('executa os 3 passos do fallback: mensagem Chatwoot, ai/decisions e handoffs', async () => {
    // Interceptar Chatwoot via nock
    const chatwootScope = nock(CHATWOOT_BASE_URL)
      .post(chatwootMessagesPath())
      .reply(201, chatwootMessageResponse);

    const { fetchFn, capturedRequests } = makeInternalFetch(decisionOk, handoffOk);

    await triggerAiFallback(defaultCtx, makeFallbackOptions({ fetchFn }));

    // Chatwoot recebeu a mensagem
    expect(chatwootScope.isDone()).toBe(true);

    // /internal/ai/decisions chamado
    const decisionReq = capturedRequests.find((r) => r.url.includes('/ai/decisions'));
    expect(decisionReq).toBeDefined();
    const decisionBody = decisionReq?.body as Record<string, unknown>;
    expect(decisionBody['organizationId']).toBe(ORG_ID);
    expect(decisionBody['conversationId']).toBe(CONVERSATION_ID);
    expect(decisionBody['leadId']).toBe(LEAD_ID);
    expect(decisionBody['nodeName']).toBe('process_whatsapp_message');
    expect(decisionBody['error']).toContain('LangGraph timeout');
    expect((decisionBody['decision'] as Record<string, unknown>)['fallback_triggered']).toBe(true);
    expect((decisionBody['decision'] as Record<string, unknown>)['reason']).toBe('ai_unavailable');

    // /internal/handoffs chamado
    const handoffReq = capturedRequests.find((r) => r.url.includes('/handoffs'));
    expect(handoffReq).toBeDefined();
    const handoffBody = handoffReq?.body as Record<string, unknown>;
    expect(handoffBody['leadId']).toBe(LEAD_ID);
    expect(handoffBody['reason']).toBe('ai_unavailable');
    expect(handoffBody['organizationId']).toBe(ORG_ID);
    expect(handoffBody['conversationId']).toBe(CHATWOOT_CONVERSATION_ID);
  });

  // -------------------------------------------------------------------------
  // 2. Chatwoot falha → handoff ainda é criado (falha não propaga)
  // -------------------------------------------------------------------------
  it('continua com ai/decisions e handoffs mesmo se o Chatwoot falhar', async () => {
    // Chatwoot retorna 500
    nock(CHATWOOT_BASE_URL).post(chatwootMessagesPath()).reply(500, { error: 'server error' });

    const { fetchFn, capturedRequests } = makeInternalFetch(decisionOk, handoffOk);

    // Não deve lançar — Chatwoot é best-effort no fallback
    await expect(
      triggerAiFallback(defaultCtx, makeFallbackOptions({ fetchFn })),
    ).resolves.toBeUndefined();

    // /internal/ai/decisions e /internal/handoffs ainda foram chamados
    expect(capturedRequests.some((r) => r.url.includes('/ai/decisions'))).toBe(true);
    expect(capturedRequests.some((r) => r.url.includes('/handoffs'))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 3. chatwootConversationId = 0 → Chatwoot NÃO é chamado, handoff NÃO é criado
  //    [M2] Enviar conversationId=0 ao POST /internal/handoffs vincularia o handoff
  //    à conversa #1 do Chatwoot, que pode ser de outro cliente/organização.
  //    Comportamento correto: early return com warn, sem criar o handoff.
  // -------------------------------------------------------------------------
  it('não chama Chatwoot nem cria handoff quando chatwootConversationId é 0', async () => {
    // Sem interceptor nock — se Chatwoot for chamado, nock lançará erro
    const ctxNoChat: AiFallbackContext = { ...defaultCtx, chatwootConversationId: 0 };
    const { fetchFn, capturedRequests } = makeInternalFetch(decisionOk, handoffOk);

    await expect(
      triggerAiFallback(ctxNoChat, makeFallbackOptions({ fetchFn })),
    ).resolves.toBeUndefined();

    // ai/decisions ainda é chamado (registra a falha da IA)
    expect(capturedRequests.some((r) => r.url.includes('/ai/decisions'))).toBe(true);
    // handoffs NÃO deve ser chamado — sem conversa Chatwoot identificada
    expect(capturedRequests.some((r) => r.url.includes('/handoffs'))).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 4. POST /internal/ai/decisions retorna 500 → ExternalServiceError lançado
  // -------------------------------------------------------------------------
  it('lança ExternalServiceError quando POST /internal/ai/decisions retorna 500', async () => {
    nock(CHATWOOT_BASE_URL).post(chatwootMessagesPath()).reply(201, chatwootMessageResponse);

    const { fetchFn } = makeInternalFetch(
      { status: 500, body: { error: 'server error' } },
      handoffOk,
    );

    await expect(
      triggerAiFallback(defaultCtx, makeFallbackOptions({ fetchFn })),
    ).rejects.toBeInstanceOf(ExternalServiceError);
  });

  // -------------------------------------------------------------------------
  // 5. POST /internal/handoffs retorna 422 → ExternalServiceError lançado
  // -------------------------------------------------------------------------
  it('lança ExternalServiceError quando POST /internal/handoffs retorna 422', async () => {
    nock(CHATWOOT_BASE_URL).post(chatwootMessagesPath()).reply(201, chatwootMessageResponse);

    const { fetchFn } = makeInternalFetch(decisionOk, {
      status: 422,
      body: { message: 'invalid' },
    });

    await expect(
      triggerAiFallback(defaultCtx, makeFallbackOptions({ fetchFn })),
    ).rejects.toBeInstanceOf(ExternalServiceError);
  });

  // -------------------------------------------------------------------------
  // 6. leadId null → handoff não é criado, sem throw
  // -------------------------------------------------------------------------
  it('retorna sem criar handoff quando leadId é null', async () => {
    nock(CHATWOOT_BASE_URL).post(chatwootMessagesPath()).reply(201, chatwootMessageResponse);

    const ctxNoLead: AiFallbackContext = { ...defaultCtx, leadId: null };
    const { fetchFn, capturedRequests } = makeInternalFetch(decisionOk, handoffOk);

    await expect(
      triggerAiFallback(ctxNoLead, makeFallbackOptions({ fetchFn })),
    ).resolves.toBeUndefined();

    // ai/decisions deve ter sido chamado (registra a falha)
    expect(capturedRequests.some((r) => r.url.includes('/ai/decisions'))).toBe(true);
    // handoffs NÃO deve ter sido chamado (sem lead identificado)
    expect(capturedRequests.some((r) => r.url.includes('/handoffs'))).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 7. aiErrorMessage truncado no fallback context
  //    (verificado na integração com process-with-ai.ts — aqui testamos
  //     que mensagens longas não causam erro no fallback)
  // -------------------------------------------------------------------------
  it('aceita aiErrorMessage com 500 chars sem erro', async () => {
    nock(CHATWOOT_BASE_URL).post(chatwootMessagesPath()).reply(201, chatwootMessageResponse);

    const longError = 'x'.repeat(500);
    const ctxLong: AiFallbackContext = { ...defaultCtx, aiErrorMessage: longError };
    const { fetchFn, capturedRequests } = makeInternalFetch(decisionOk, handoffOk);

    await expect(
      triggerAiFallback(ctxLong, makeFallbackOptions({ fetchFn })),
    ).resolves.toBeUndefined();

    const decisionReq = capturedRequests.find((r) => r.url.includes('/ai/decisions'));
    const decisionBody = decisionReq?.body as Record<string, unknown>;
    // O erro deve ser enviado exatamente como passado (500 chars = dentro do limite de 2000)
    expect(decisionBody['error']).toBe(longError);
  });

  // -------------------------------------------------------------------------
  // 8. Idempotência: chave de idempotência do handoff inclui waMessageId
  // -------------------------------------------------------------------------
  it('usa waMessageId na chave de idempotência do handoff', async () => {
    nock(CHATWOOT_BASE_URL).post(chatwootMessagesPath()).reply(201, chatwootMessageResponse);

    const { fetchFn, capturedRequests } = makeInternalFetch(decisionOk, handoffOk);

    await triggerAiFallback(defaultCtx, makeFallbackOptions({ fetchFn }));

    const handoffReq = capturedRequests.find((r) => r.url.includes('/handoffs'));
    const handoffHeaders = handoffReq?.headers as Record<string, string>;
    expect(handoffHeaders['Idempotency-Key']).toContain(WA_MESSAGE_ID);

    const decisionReq = capturedRequests.find((r) => r.url.includes('/ai/decisions'));
    const decisionHeaders = decisionReq?.headers as Record<string, string>;
    expect(decisionHeaders['Idempotency-Key']).toContain(WA_MESSAGE_ID);
  });

  // -------------------------------------------------------------------------
  // 9. fetch de /internal/* falha com erro de rede → ExternalServiceError lançado
  // -------------------------------------------------------------------------
  it('lança ExternalServiceError quando fetch de /internal/ai/decisions falha com erro de rede', async () => {
    nock(CHATWOOT_BASE_URL).post(chatwootMessagesPath()).reply(201, chatwootMessageResponse);

    const failingFetch: typeof fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(
      triggerAiFallback(defaultCtx, makeFallbackOptions({ fetchFn: failingFetch })),
    ).rejects.toBeInstanceOf(ExternalServiceError);
  });

  // -------------------------------------------------------------------------
  // 10. Mensagem de fallback ao Chatwoot usa o texto canônico do doc 06 §4.4
  // -------------------------------------------------------------------------
  it('envia a mensagem canônica de fallback ao Chatwoot (doc 06 §4.4)', async () => {
    let capturedBody: Record<string, unknown> | undefined;

    // Capturar o corpo enviado ao Chatwoot via nock
    nock(CHATWOOT_BASE_URL)
      .post(chatwootMessagesPath(), (body: Record<string, unknown>) => {
        capturedBody = body;
        return true;
      })
      .reply(201, chatwootMessageResponse);

    const { fetchFn } = makeInternalFetch(decisionOk, handoffOk);

    await triggerAiFallback(defaultCtx, makeFallbackOptions({ fetchFn }));

    // A mensagem deve ser exatamente a canônica do doc 06 §4.4
    expect(capturedBody?.['content']).toBe(
      'Recebi sua mensagem. Vou te transferir para um atendente.',
    );
  });
});
