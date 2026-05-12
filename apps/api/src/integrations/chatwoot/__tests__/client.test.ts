// =============================================================================
// integrations/chatwoot/__tests__/client.test.ts
//
// Testes de integração do ChatwootClient (F1-S20).
//
// Estratégia:
//   - nock intercepta fetch (funciona em Node 22 com nock 14).
//   - ChatwootClient aceita `sleepFn` injetável → sem fake timers necessário.
//   - ChatwootClient aceita `timeoutMs` injetável → timeout testável sem wait real.
//   - Env mockada via vi.mock + Proxy para leitura em tempo real por teste.
//
// Cenários cobertos:
//   1.  updateAttributes — envia PATCH e retorna ChatwootConversationResponse
//   2.  createMessage    — envia POST e retorna ChatwootMessageResponse
//   3.  createMessage    — aceita type=incoming
//   4.  createNote       — atalho para createMessage com private=true
//   5.  assignAgent      — envia POST e retorna ChatwootAssignmentResponse
//   6.  retry em 5xx     — aciona até 3 tentativas; sucesso na 3ª
//   7.  retry esgotado   — lança ChatwootApiError após 3 falhas 5xx
//   8.  sem retry em 4xx — lança imediatamente sem retry em 404
//   9.  401              — lança ChatwootApiError com upstreamStatus=401
//   10. sem retry em 422 — lança ChatwootApiError sem retry
//   11. timeout          — lança ChatwootApiError via AbortSignal
//   12. env ausente      — lança ChatwootApiError na construção (3 variantes)
//   13. schema inválido  — lança ZodError quando resposta não bate com schema
// =============================================================================
import nock from 'nock';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '../../../config/env.js';
import { ChatwootApiError } from '../../../shared/errors.js';
import { ChatwootClient } from '../client.js';

// ---------------------------------------------------------------------------
// Mock do módulo env — Proxy que lê process.env dinamicamente por teste
// ---------------------------------------------------------------------------

vi.mock('../../../config/env.js', () => {
  const envProxy = new Proxy({} as Env, {
    get(_target, prop: string) {
      if (prop === 'CHATWOOT_BASE_URL') return process.env['CHATWOOT_BASE_URL'];
      if (prop === 'CHATWOOT_API_TOKEN') return process.env['CHATWOOT_API_TOKEN'];
      if (prop === 'CHATWOOT_ACCOUNT_ID') {
        const v = process.env['CHATWOOT_ACCOUNT_ID'];
        return v !== undefined ? Number(v) : undefined;
      }
      return (process.env as Record<string, string | undefined>)[prop];
    },
  });
  return { env: envProxy };
});

// ---------------------------------------------------------------------------
// Constantes de teste
// ---------------------------------------------------------------------------

const CHATWOOT_BASE_URL = 'https://chat.test.example.com';
const CHATWOOT_API_TOKEN = 'test-api-token-vitest';
const CHATWOOT_ACCOUNT_ID = 42;
const CONVERSATION_ID = 100;
const AGENT_ID = 7;

// sleepFn que não espera nada — elimina delays de backoff nos testes
const noopSleep = vi.fn().mockResolvedValue(undefined);

// ---------------------------------------------------------------------------
// Helpers de env
// ---------------------------------------------------------------------------

function setEnv(): void {
  process.env['CHATWOOT_BASE_URL'] = CHATWOOT_BASE_URL;
  process.env['CHATWOOT_API_TOKEN'] = CHATWOOT_API_TOKEN;
  process.env['CHATWOOT_ACCOUNT_ID'] = String(CHATWOOT_ACCOUNT_ID);
}

function clearEnv(): void {
  delete process.env['CHATWOOT_BASE_URL'];
  delete process.env['CHATWOOT_API_TOKEN'];
  delete process.env['CHATWOOT_ACCOUNT_ID'];
}

/** Cria cliente com sleepFn no-op (sem delays reais) e timeoutMs curto. */
function makeClient(): ChatwootClient {
  return new ChatwootClient({
    sleepFn: noopSleep,
    timeoutMs: 5_000,
  });
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

function conversationPath(suffix: string): string {
  return `/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${CONVERSATION_ID}${suffix}`;
}

// ---------------------------------------------------------------------------
// Fixtures de resposta
// ---------------------------------------------------------------------------

const messageResponse = {
  id: 999,
  content: 'Olá, cidadão!',
  message_type: 'outgoing',
  private: false,
  created_at: 1715000000,
  conversation_id: CONVERSATION_ID,
  account_id: CHATWOOT_ACCOUNT_ID,
};

const noteResponse = {
  ...messageResponse,
  id: 1000,
  private: true,
};

const conversationResponse = {
  id: CONVERSATION_ID,
  status: 'open',
  custom_attributes: {
    lead_id: 'uuid-lead-123',
    cidade: 'Porto Velho',
  },
};

const assignmentResponse = {
  assignee: {
    id: AGENT_ID,
    name: 'João Atendente',
    email: 'joao@bancododopovo.ro.gov.br',
    availability_status: 'online',
  },
};

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeAll(() => {
  // Impede qualquer request real escapar dos testes
  nock.disableNetConnect();
});

afterAll(() => {
  nock.enableNetConnect();
  nock.cleanAll();
});

beforeEach(() => {
  setEnv();
  noopSleep.mockClear();
});

afterEach(() => {
  nock.cleanAll();
  clearEnv();
});

// ---------------------------------------------------------------------------
// 1. updateAttributes
// ---------------------------------------------------------------------------

describe('ChatwootClient.updateAttributes()', () => {
  it('envia PATCH correto e retorna ChatwootConversationResponse validado', async () => {
    const attrs = { lead_id: 'uuid-lead-123', cidade: 'Porto Velho' };

    const scope = nock(CHATWOOT_BASE_URL)
      .patch(conversationPath('/custom_attributes'), { custom_attributes: attrs })
      .matchHeader('api_access_token', CHATWOOT_API_TOKEN)
      .reply(200, conversationResponse);

    const result = await makeClient().updateAttributes(CONVERSATION_ID, attrs);

    expect(result.id).toBe(CONVERSATION_ID);
    expect(result.status).toBe('open');
    expect(result.custom_attributes?.['lead_id']).toBe('uuid-lead-123');
    expect(scope.isDone()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. createMessage
// ---------------------------------------------------------------------------

describe('ChatwootClient.createMessage()', () => {
  it('envia POST com outgoing e retorna ChatwootMessageResponse', async () => {
    const scope = nock(CHATWOOT_BASE_URL)
      .post(conversationPath('/messages'), {
        content: 'Olá, cidadão!',
        message_type: 'outgoing',
        private: false,
      })
      .matchHeader('api_access_token', CHATWOOT_API_TOKEN)
      .reply(201, messageResponse);

    const result = await makeClient().createMessage(CONVERSATION_ID, 'Olá, cidadão!');

    expect(result.id).toBe(999);
    expect(result.private).toBe(false);
    expect(result.message_type).toBe('outgoing');
    expect(scope.isDone()).toBe(true);
  });

  it('aceita type=incoming', async () => {
    const scope = nock(CHATWOOT_BASE_URL)
      .post(conversationPath('/messages'), {
        content: 'Mensagem recebida',
        message_type: 'incoming',
        private: false,
      })
      .reply(201, { ...messageResponse, message_type: 'incoming' });

    const result = await makeClient().createMessage(
      CONVERSATION_ID,
      'Mensagem recebida',
      'incoming',
    );

    expect(result.message_type).toBe('incoming');
    expect(scope.isDone()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. createNote
// ---------------------------------------------------------------------------

describe('ChatwootClient.createNote()', () => {
  it('envia POST com private=true e retorna ChatwootMessageResponse', async () => {
    const scope = nock(CHATWOOT_BASE_URL)
      .post(conversationPath('/messages'), {
        content: 'Nota interna de handoff',
        message_type: 'outgoing',
        private: true,
      })
      .reply(201, noteResponse);

    const result = await makeClient().createNote(CONVERSATION_ID, 'Nota interna de handoff');

    expect(result.id).toBe(1000);
    expect(result.private).toBe(true);
    expect(scope.isDone()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. assignAgent
// ---------------------------------------------------------------------------

describe('ChatwootClient.assignAgent()', () => {
  it('envia POST correto e retorna ChatwootAssignmentResponse', async () => {
    const scope = nock(CHATWOOT_BASE_URL)
      .post(conversationPath('/assignments'), { assignee_id: AGENT_ID })
      .matchHeader('api_access_token', CHATWOOT_API_TOKEN)
      .reply(200, assignmentResponse);

    const result = await makeClient().assignAgent(CONVERSATION_ID, AGENT_ID);

    expect(result.assignee.id).toBe(AGENT_ID);
    expect(result.assignee.name).toBe('João Atendente');
    expect(scope.isDone()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5 & 6. Retry em 5xx
// ---------------------------------------------------------------------------

describe('Retry em 5xx', () => {
  it('aciona retry até 3 tentativas e retorna sucesso na 3ª', async () => {
    // 1ª tentativa → 503, 2ª → 500, 3ª → sucesso
    const scope = nock(CHATWOOT_BASE_URL)
      .post(conversationPath('/messages'))
      .reply(503, { error: 'Service Unavailable' })
      .post(conversationPath('/messages'))
      .reply(500, { error: 'Internal Server Error' })
      .post(conversationPath('/messages'))
      .reply(201, messageResponse);

    const result = await makeClient().createMessage(CONVERSATION_ID, 'teste retry');

    expect(result.id).toBe(999);
    // sleepFn deve ter sido chamada 2x (antes da 2ª e 3ª tentativas)
    expect(noopSleep).toHaveBeenCalledTimes(2);
    expect(scope.isDone()).toBe(true);
  });

  it('lança ChatwootApiError após esgotar 3 tentativas em 5xx', async () => {
    nock(CHATWOOT_BASE_URL)
      .post(conversationPath('/messages'))
      .reply(500, { error: 'Server Error' })
      .post(conversationPath('/messages'))
      .reply(502, { error: 'Bad Gateway' })
      .post(conversationPath('/messages'))
      .reply(503, { error: 'Service Unavailable' });

    await expect(
      makeClient().createMessage(CONVERSATION_ID, 'teste esgotamento'),
    ).rejects.toMatchObject({
      upstreamStatus: 503,
    });

    // sleepFn chamada 2x (antes da 2ª e 3ª tentativas)
    expect(noopSleep).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// 7. Sem retry em 4xx
// ---------------------------------------------------------------------------

describe('Sem retry em 4xx', () => {
  it('lança ChatwootApiError imediatamente sem retry em 404', async () => {
    // Um único interceptor — qualquer retry causaria "Nock: No match" error
    const scope = nock(CHATWOOT_BASE_URL)
      .post(conversationPath('/messages'))
      .reply(404, { error: 'Conversation not found' });

    await expect(
      makeClient().createMessage(CONVERSATION_ID, 'conversa inexistente'),
    ).rejects.toMatchObject({
      upstreamStatus: 404,
    });

    // Nenhum sleep (sem retry)
    expect(noopSleep).not.toHaveBeenCalled();
    // Exatamente 1 request feito
    expect(scope.isDone()).toBe(true);
  });

  it('lança ChatwootApiError com upstreamStatus=401 e code=CHATWOOT_API_ERROR', async () => {
    nock(CHATWOOT_BASE_URL)
      .patch(conversationPath('/custom_attributes'))
      .reply(401, { error: 'Unauthorized' });

    const error = await makeClient()
      .updateAttributes(CONVERSATION_ID, { lead_id: 'abc' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ChatwootApiError);
    if (error instanceof ChatwootApiError) {
      expect(error.upstreamStatus).toBe(401);
      expect(error.code).toBe('CHATWOOT_API_ERROR');
      expect(error.message).toContain('401');
      // Nenhum sleep (sem retry em 4xx)
      expect(noopSleep).not.toHaveBeenCalled();
    }
  });

  it('lança ChatwootApiError imediatamente sem retry em 422', async () => {
    const scope = nock(CHATWOOT_BASE_URL)
      .post(conversationPath('/assignments'))
      .reply(422, { error: 'Unprocessable Entity' });

    await expect(makeClient().assignAgent(CONVERSATION_ID, 999999)).rejects.toMatchObject({
      upstreamStatus: 422,
    });

    expect(noopSleep).not.toHaveBeenCalled();
    expect(scope.isDone()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. Timeout
// ---------------------------------------------------------------------------

describe('Timeout', () => {
  it('lança ChatwootApiError quando AbortSignal dispara', async () => {
    // Simula um fetch que nunca resolve (pendente infinito),
    // substituindo fetch globalmente apenas para este teste.
    // Isso garante que o AbortController seja o responsável pela rejeição,
    // sem depender do timing de nock.
    const originalFetch = global.fetch;

    // fetch que retorna uma promise que só rejeita quando o signal aborta
    const hangingFetch = (_url: unknown, init?: RequestInit): Promise<Response> => {
      return new Promise<Response>((_resolve, reject) => {
        // Escuta o signal de abort e rejeita com DOMException compatível
        init?.signal?.addEventListener('abort', () => {
          const abortError = new DOMException('The operation was aborted.', 'AbortError');
          reject(abortError);
        });
      });
    };

    // Substitui fetch globalmente apenas para este teste
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- substituição temporária de fetch global para teste de timeout
    global.fetch = hangingFetch as any;

    try {
      const client = new ChatwootClient({
        sleepFn: noopSleep,
        timeoutMs: 10, // dispara AbortController em 10ms
        maxAttempts: 1, // apenas 1 tentativa para que o teste seja rápido
      });

      const error = await client
        .createMessage(CONVERSATION_ID, 'teste timeout')
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ChatwootApiError);
      if (error instanceof ChatwootApiError) {
        expect(error.upstreamStatus).toBe(0);
        expect(error.message).toMatch(/timeout/i);
      }
    } finally {
      global.fetch = originalFetch;
    }
  });
});

// ---------------------------------------------------------------------------
// 9. Env não configurado
// ---------------------------------------------------------------------------

describe('Env não configurado', () => {
  it('lança ChatwootApiError na construção se CHATWOOT_BASE_URL ausente', () => {
    clearEnv();

    expect(() => new ChatwootClient()).toThrow(ChatwootApiError);
    expect(() => new ChatwootClient()).toThrow(/CHATWOOT_BASE_URL/);
  });

  it('lança ChatwootApiError na construção se CHATWOOT_API_TOKEN ausente', () => {
    clearEnv();
    process.env['CHATWOOT_BASE_URL'] = CHATWOOT_BASE_URL;

    expect(() => new ChatwootClient()).toThrow(ChatwootApiError);
    expect(() => new ChatwootClient()).toThrow(/CHATWOOT_API_TOKEN/);
  });

  it('lança ChatwootApiError na construção se CHATWOOT_ACCOUNT_ID ausente', () => {
    clearEnv();
    process.env['CHATWOOT_BASE_URL'] = CHATWOOT_BASE_URL;
    process.env['CHATWOOT_API_TOKEN'] = CHATWOOT_API_TOKEN;

    expect(() => new ChatwootClient()).toThrow(ChatwootApiError);
    expect(() => new ChatwootClient()).toThrow(/CHATWOOT_ACCOUNT_ID/);
  });
});

// ---------------------------------------------------------------------------
// 10. Validação de schema Zod
// ---------------------------------------------------------------------------

describe('Validação de schema Zod', () => {
  it('lança ZodError quando resposta não bate com o schema esperado', async () => {
    // Retorna objeto sem campo `id` (obrigatório no ChatwootMessageResponseSchema)
    nock(CHATWOOT_BASE_URL)
      .post(conversationPath('/messages'))
      .reply(201, { content: 'sem id', message_type: 'outgoing', private: false, created_at: 0 });

    await expect(
      makeClient().createMessage(CONVERSATION_ID, 'teste schema invalido'),
    ).rejects.toThrow(); // ZodError — schema.parse() lança
  });
});
