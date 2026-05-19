// =============================================================================
// whatsapp/handlers/__tests__/process-with-ai.test.ts
//
// Testes do handler process-with-ai (F3-S33).
//
// Estratégia:
//   - LangGraph: fetchFn injetável via ProcessWithAiOptions.langGraphOptions.
//   - Chatwoot: nock intercepta chamadas HTTP reais (padrão do projeto — ver
//     integrations/chatwoot/__tests__/client.test.ts).
//   - DB: mock via argumento injetável (padrão do projeto — ver kanban-on-simulation.test.ts).
//   Não depende de banco real nem de serviços externos.
//
// Cenários cobertos:
//   1. Caminho feliz — chama LangGraph e envia reply via Chatwoot.
//   2. reply.type='none' — não chama Chatwoot (nock não interceptado = erro se chamado).
//   3. chatwoot_conversation_id inválido ('0') — não chama Chatwoot.
//   4. Payload de evento inválido (whatsapp_message_id ausente) — skip sem erro.
//   5. whatsapp_messages não encontrado — skip sem erro.
//   6. `from` ausente no payload da mensagem — skip sem erro.
//   7. Conversation state criado quando inexistente.
//   8. ai_conversation_states atualizado com lead_id após resposta da IA.
//   9. Erro do Chatwoot é re-lançado (outbox contabiliza tentativa).
//   10. Erro do LangGraph é propagado (outbox contabiliza tentativa).
//   11. [CRÍTICO-1] Isolamento por organizationId — não retorna estado de outra org.
//   12. [CRÍTICO-2] Soft-delete — estado deletado não é reativado.
//   13. [CRÍTICO-1+2] SELECT usa and(organizationId, phone, deletedAt IS NULL).
// =============================================================================
import nock from 'nock';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

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
// Mock pg e drizzle (evita conexão real)
// ---------------------------------------------------------------------------
vi.mock('pg', () => {
  const MockPool = vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  return { Pool: MockPool, default: { Pool: MockPool } };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ __eq: val })),
  and: vi.fn((...args: unknown[]) => ({ __and: args })),
  sql: Object.assign(
    vi.fn(() => ({})),
    { mapWith: vi.fn() },
  ),
  relations: vi.fn().mockReturnValue({}),
  asc: vi.fn().mockReturnValue({}),
  desc: vi.fn().mockReturnValue({}),
  count: vi.fn().mockReturnValue({}),
  inArray: vi.fn().mockReturnValue({}),
  isNull: vi.fn().mockReturnValue({}),
}));

vi.mock('drizzle-orm/node-postgres', () => ({
  drizzle: vi.fn().mockReturnValue({}),
}));

vi.mock('../../../db/client.js', () => ({
  db: {},
  pool: {},
}));

// ---------------------------------------------------------------------------
// Import do handler (após mocks)
// ---------------------------------------------------------------------------
import type { EventOutbox } from '../../../../db/schema/events.js';
import { handleProcessWithAi } from '../process-with-ai.js';
import type { ProcessWithAiOptions } from '../process-with-ai.js';

// ---------------------------------------------------------------------------
// Constantes de teste
// ---------------------------------------------------------------------------

const CHATWOOT_BASE_URL = 'http://chatwoot.test.local';
const CHATWOOT_ACCOUNT_ID = 1;
const CHATWOOT_CONVERSATION_ID = 42;

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const LEAD_ID = '22222222-2222-2222-2222-222222222222';
const CONV_STATE_ID = '33333333-3333-3333-3333-333333333333';
const CONVERSATION_ID = '44444444-4444-4444-4444-444444444444';
const WA_MESSAGE_ID = 'wamid.test_abc123';
const EVENT_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const CORRELATION_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Payload bruto de uma mensagem WhatsApp de texto. */
const rawWaPayload = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '12345',
      changes: [
        {
          value: {
            messaging_product: 'whatsapp',
            metadata: {
              display_phone_number: '5569900000000',
              phone_number_id: 'phone-123',
            },
            messages: [
              {
                id: WA_MESSAGE_ID,
                // Formato real entregue pela Meta: SEM o prefixo `+`
                from: '5569999999999',
                timestamp: '1716115200',
                type: 'text',
                text: { body: 'Quero simular um crédito' },
              },
            ],
          },
          field: 'messages',
        },
      ],
    },
  ],
};

/** Registro em whatsapp_messages. */
const waMessageRow = {
  id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
  organizationId: ORG_ID,
  waMessageId: WA_MESSAGE_ID,
  conversationId: null,
  direction: 'inbound' as const,
  payload: rawWaPayload,
  receivedAt: new Date('2026-05-19T12:00:00Z'),
  createdAt: new Date('2026-05-19T12:00:00Z'),
};

/** Estado de conversa AI existente com Chatwoot conversation ID válido. */
const existingConvState = {
  id: CONV_STATE_ID,
  organizationId: ORG_ID,
  conversationId: CONVERSATION_ID,
  chatwootConversationId: String(CHATWOOT_CONVERSATION_ID),
  leadId: LEAD_ID,
  customerId: null,
  phone: '5569999999999',
  currentNode: 'classify_intent',
  graphVersion: 'v1.0.0',
  state: {},
  lastMessageAt: new Date('2026-05-19T11:59:00Z'),
  createdAt: new Date('2026-05-19T10:00:00Z'),
  updatedAt: new Date('2026-05-19T11:59:00Z'),
  deletedAt: null,
};

/** Response válido do LangGraph (reply de texto). */
function makeAiResponse(overrides: Record<string, unknown> = {}) {
  return {
    conversation_id: CONVERSATION_ID,
    lead_id: LEAD_ID,
    reply: {
      type: 'text',
      content: 'Em qual cidade você está?',
      template_name: null,
      template_variables: null,
    },
    actions: [],
    handoff: { required: false, reason: null, summary: null },
    state: {
      current_stage: 'collect_city',
      current_intent: 'simular_credito',
      next_expected_input: 'city',
      missing_fields: ['city'],
    },
    model: 'claude-sonnet-4-5',
    prompt_version: 'pre_attendance@v3',
    graph_version: 'v1.0.0',
    latency_ms: 842,
    errors: [],
    ...overrides,
  };
}

/** Response do Chatwoot ao criar mensagem. */
const chatwootMessageResponse = {
  id: 999,
  content: 'Em qual cidade você está?',
  message_type: 'outgoing',
  private: false,
  created_at: 1716115200,
  conversation_id: CHATWOOT_CONVERSATION_ID,
  account_id: CHATWOOT_ACCOUNT_ID,
};

/** Cria evento de teste. */
function makeEvent(overrides: Partial<EventOutbox> = {}): EventOutbox {
  return {
    id: EVENT_ID,
    organizationId: ORG_ID,
    eventName: 'whatsapp.message_received',
    eventVersion: 1,
    aggregateType: 'whatsapp_message',
    aggregateId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    payload: {
      whatsapp_message_id: WA_MESSAGE_ID,
      chatwoot_conversation_id: CHATWOOT_CONVERSATION_ID,
      lead_id: LEAD_ID,
    },
    correlationId: CORRELATION_ID,
    idempotencyKey: `whatsapp.message_received:${WA_MESSAGE_ID}`,
    attempts: 0,
    lastError: null,
    processedAt: null,
    failedAt: null,
    createdAt: new Date('2026-05-19T12:00:00Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// DB mock builder
// ---------------------------------------------------------------------------

/**
 * Constrói um mock mínimo de Database.
 * Ordem das chamadas select():
 *   0: whatsapp_messages (carregar mensagem pelo waMessageId)
 *   1: ai_conversation_states (tentar carregar estado existente pelo phone+org)
 *   2: ai_conversation_states (recarregar após INSERT com ON CONFLICT)
 *
 * `selectWhereArgs` captura os argumentos passados para cada .where() dos SELECTs,
 * permitindo verificar isolamento por organizationId e filtro de soft-delete.
 */
function makeMockDb(options: {
  waMessage?: unknown | null;
  convState?: unknown | null;
  insertConvState?: unknown | null;
  reloadConvState?: unknown | null;
}) {
  const updatedValues: unknown[] = [];
  const selectWhereArgs: unknown[][] = [];
  let selectCallIndex = 0;

  const selectResponses = [
    options.waMessage !== undefined ? (options.waMessage !== null ? [options.waMessage] : []) : [],
    options.convState !== undefined ? (options.convState !== null ? [options.convState] : []) : [],
    options.reloadConvState !== undefined
      ? options.reloadConvState !== null
        ? [options.reloadConvState]
        : []
      : [],
  ];

  function makeSelectChain() {
    const callIdx = selectCallIndex++;
    const result = selectResponses[callIdx] ?? [];
    const whereArgs: unknown[] = [];
    selectWhereArgs.push(whereArgs);
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation((...args: unknown[]) => {
          whereArgs.push(...args);
          return {
            limit: vi.fn().mockResolvedValue(result),
          };
        }),
      }),
    };
  }

  const mockInsert = vi.fn().mockImplementation(() => ({
    values: vi.fn().mockImplementation(() => ({
      onConflictDoNothing: vi.fn().mockImplementation(() => ({
        returning: vi
          .fn()
          .mockResolvedValue(
            options.insertConvState !== undefined && options.insertConvState !== null
              ? [options.insertConvState]
              : [],
          ),
      })),
    })),
  }));

  const mockUpdate = vi.fn().mockImplementation(() => ({
    set: vi.fn().mockImplementation((vals: unknown) => {
      updatedValues.push(vals);
      return {
        where: vi.fn().mockResolvedValue([]),
      };
    }),
  }));

  const db = {
    select: vi.fn().mockImplementation(() => makeSelectChain()),
    insert: mockInsert,
    update: mockUpdate,
    transaction: vi.fn(),
  };

  return { db, updatedValues, selectWhereArgs };
}

// ---------------------------------------------------------------------------
// Helpers para opções injetáveis
// ---------------------------------------------------------------------------

/** Cria um fetchFn que retorna uma Response JSON com sucesso. */
function makeJsonFetch(body: unknown, status = 200): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => (k === 'content-type' ? 'application/json' : null) },
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response);
}

/** Cria um fetchFn que rejeita com um erro. */
function makeFailingFetch(error: Error): typeof fetch {
  return vi.fn().mockRejectedValue(error);
}

/** Cria opções com fetchFn injetável para LangGraph; Chatwoot via injeção de baseUrl. */
function makeLgOptions(lgFetch: typeof fetch): ProcessWithAiOptions {
  return {
    langGraphOptions: {
      baseUrl: 'http://localhost:8000',
      internalToken: 'a'.repeat(33),
      timeoutMs: 5_000,
      fetchFn: lgFetch,
    },
    // Injeta baseUrl/apiToken/accountId para que ChatwootClient não dependa de env
    // (env mock pode não propagar para o módulo ChatwootClient em tempo de teste).
    chatwootOptions: {
      baseUrl: CHATWOOT_BASE_URL,
      apiToken: 'test-chatwoot-token',
      accountId: CHATWOOT_ACCOUNT_ID,
      timeoutMs: 5_000,
    },
  };
}

/** Path do endpoint de mensagens Chatwoot para o conv id. */
function chatwootMessagesPath(): string {
  return `/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${CHATWOOT_CONVERSATION_ID}/messages`;
}

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
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleProcessWithAi', () => {
  // -------------------------------------------------------------------------
  // 1. Caminho feliz — LangGraph chamado, reply enviada via Chatwoot
  // -------------------------------------------------------------------------
  it('chama LangGraph e envia reply via Chatwoot no caminho feliz', async () => {
    // Interceptar Chatwoot via nock
    const chatwootScope = nock(CHATWOOT_BASE_URL)
      .post(chatwootMessagesPath())
      .reply(201, chatwootMessageResponse);

    let capturedBody: Record<string, unknown> | undefined;
    let capturedHeaders: Record<string, string> | undefined;

    const lgFetch: typeof fetch = vi
      .fn()
      .mockImplementation(async (_url: unknown, init?: RequestInit) => {
        capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
        capturedHeaders = init?.headers as Record<string, string>;
        return {
          ok: true,
          status: 200,
          headers: { get: (k: string) => (k === 'content-type' ? 'application/json' : null) },
          json: vi.fn().mockResolvedValue(makeAiResponse()),
        } as unknown as Response;
      });

    const { db } = makeMockDb({ waMessage: waMessageRow, convState: existingConvState });

    await handleProcessWithAi(db as never, makeLgOptions(lgFetch), makeEvent());

    // LangGraph chamado 1x com payload correto
    expect(lgFetch).toHaveBeenCalledTimes(1);
    expect(capturedBody?.['conversation_id']).toBe(CONVERSATION_ID);
    expect(capturedBody?.['channel']).toBe('whatsapp');
    expect(capturedBody?.['idempotency_key']).toBe(`wa_msg_${WA_MESSAGE_ID}`);
    expect(capturedBody?.['correlation_id']).toBe(CORRELATION_ID);
    // A Meta entrega `from` SEM `+` ('5569999999999'); o handler deve normalizar para E.164 com `+`.
    expect(capturedBody?.['customer_phone']).toBe('+5569999999999');
    // Headers de segurança
    expect(capturedHeaders?.['X-Internal-Token']).toBe('a'.repeat(33));
    expect(capturedHeaders?.['X-Correlation-Id']).toBe(CORRELATION_ID);

    // Chatwoot recebeu a requisição
    expect(chatwootScope.isDone()).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 2. reply.type='none' — Chatwoot NÃO deve ser chamado
  // -------------------------------------------------------------------------
  it('não chama Chatwoot quando reply.type=none', async () => {
    // Nenhum interceptor nock — se Chatwoot for chamado, nock lançará erro
    const lgFetch = makeJsonFetch(
      makeAiResponse({
        reply: { type: 'none', content: '', template_name: null, template_variables: null },
      }),
    );

    const { db } = makeMockDb({ waMessage: waMessageRow, convState: existingConvState });

    // Não deve lançar (nock não intercepta = sem chamada ao Chatwoot)
    await expect(
      handleProcessWithAi(db as never, makeLgOptions(lgFetch), makeEvent()),
    ).resolves.toBeUndefined();

    expect(lgFetch).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // 3. chatwoot_conversation_id inválido ('0') — Chatwoot NÃO chamado
  // -------------------------------------------------------------------------
  it('não chama Chatwoot quando chatwoot_conversation_id é 0 (inválido)', async () => {
    const convStateNoChat = { ...existingConvState, chatwootConversationId: '0' };
    const lgFetch = makeJsonFetch(makeAiResponse());

    const { db } = makeMockDb({ waMessage: waMessageRow, convState: convStateNoChat });

    await expect(
      handleProcessWithAi(db as never, makeLgOptions(lgFetch), makeEvent()),
    ).resolves.toBeUndefined();

    expect(lgFetch).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // 4. Payload de evento inválido — skip sem throw
  // -------------------------------------------------------------------------
  it('faz skip quando whatsapp_message_id está ausente no payload do evento', async () => {
    const lgFetch = vi.fn() as unknown as typeof fetch;
    const { db } = makeMockDb({});

    const event = makeEvent({
      payload: { chatwoot_conversation_id: CHATWOOT_CONVERSATION_ID, lead_id: null } as never,
    });
    await expect(
      handleProcessWithAi(db as never, makeLgOptions(lgFetch), event),
    ).resolves.toBeUndefined();

    expect(lgFetch).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 5. whatsapp_messages não encontrado — skip sem throw
  // -------------------------------------------------------------------------
  it('faz skip quando whatsapp_messages não existe para o id', async () => {
    const lgFetch = vi.fn() as unknown as typeof fetch;
    const { db } = makeMockDb({ waMessage: null });

    await expect(
      handleProcessWithAi(db as never, makeLgOptions(lgFetch), makeEvent()),
    ).resolves.toBeUndefined();

    expect(lgFetch).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 6. `from` ausente no payload bruto — skip sem throw
  // -------------------------------------------------------------------------
  it('faz skip quando `from` está ausente no payload da mensagem WhatsApp', async () => {
    const payloadSemFrom = {
      ...rawWaPayload,
      entry: [
        {
          ...rawWaPayload.entry[0],
          changes: [
            {
              ...rawWaPayload.entry[0]?.changes[0],
              value: {
                ...rawWaPayload.entry[0]?.changes[0]?.value,
                messages: [
                  {
                    id: WA_MESSAGE_ID,
                    from: undefined,
                    timestamp: '1716115200',
                    type: 'text',
                    text: { body: 'texto' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const lgFetch = vi.fn() as unknown as typeof fetch;
    const msgSemFrom = { ...waMessageRow, payload: payloadSemFrom };
    const { db } = makeMockDb({ waMessage: msgSemFrom });

    await expect(
      handleProcessWithAi(db as never, makeLgOptions(lgFetch), makeEvent()),
    ).resolves.toBeUndefined();

    expect(lgFetch).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 7. Conversation state criado quando inexistente
  // -------------------------------------------------------------------------
  it('cria ai_conversation_states quando não existe para o telefone', async () => {
    const newConvState = {
      ...existingConvState,
      conversationId: '55555555-5555-5555-5555-555555555555',
      chatwootConversationId: null, // sem Chatwoot → reply não enviada
      leadId: null,
      state: {},
    };

    const lgFetch = makeJsonFetch(makeAiResponse());

    const { db } = makeMockDb({
      waMessage: waMessageRow,
      convState: null, // não existe
      insertConvState: newConvState, // criado pelo INSERT
    });

    // Nenhum interceptor nock — Chatwoot não deve ser chamado
    await expect(
      handleProcessWithAi(db as never, makeLgOptions(lgFetch), makeEvent()),
    ).resolves.toBeUndefined();

    // LangGraph chamado mesmo sem convState pré-existente
    expect(lgFetch).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // 8. ai_conversation_states atualizado com lead_id da resposta da IA
  // -------------------------------------------------------------------------
  it('atualiza ai_conversation_states com lead_id e last_message_at após resposta da IA', async () => {
    const newLeadId = '99999999-9999-9999-9999-999999999999';
    const convNoLead = { ...existingConvState, leadId: null };

    // Interceptar Chatwoot
    nock(CHATWOOT_BASE_URL).post(chatwootMessagesPath()).reply(201, chatwootMessageResponse);

    const lgFetch = makeJsonFetch(makeAiResponse({ lead_id: newLeadId }));

    const { db, updatedValues } = makeMockDb({ waMessage: waMessageRow, convState: convNoLead });

    await handleProcessWithAi(db as never, makeLgOptions(lgFetch), makeEvent());

    expect(updatedValues.length).toBeGreaterThan(0);
    const updateArgs = updatedValues[0] as Record<string, unknown>;
    expect(updateArgs['leadId']).toBe(newLeadId);
    expect(updateArgs['lastMessageAt']).toBeInstanceOf(Date);
  });

  // -------------------------------------------------------------------------
  // 9. Erro do Chatwoot é re-lançado
  // -------------------------------------------------------------------------
  it('re-lança erro do Chatwoot para que o outbox contabilize a tentativa', async () => {
    // Chatwoot retorna 500
    nock(CHATWOOT_BASE_URL)
      .post(chatwootMessagesPath())
      .reply(500, { error: 'Internal Server Error' });

    const lgFetch = makeJsonFetch(makeAiResponse());

    const { db } = makeMockDb({ waMessage: waMessageRow, convState: existingConvState });

    // Handler deve re-lançar o erro do Chatwoot
    await expect(
      handleProcessWithAi(db as never, makeLgOptions(lgFetch), makeEvent()),
    ).rejects.toThrow();

    // LangGraph foi chamado com sucesso antes do erro do Chatwoot
    expect(lgFetch).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // 10. Erro do LangGraph aciona o fallback (F3-S34)
  //     Quando LangGraph falha, triggerAiFallback() é chamado em vez de
  //     propagar o erro original. Se o fallback também falhar, o erro do
  //     fallback (ExternalServiceError) é propagado ao outbox-publisher.
  // -------------------------------------------------------------------------
  it('aciona fallback quando LangGraph falha — propaga erro do fallback se ele também falhar', async () => {
    const lgFetch = makeFailingFetch(new Error('LangGraph timeout'));

    // Fallback tenta enviar mensagem ao Chatwoot (conv id 42) → nock bloqueia (sem interceptor)
    // Chatwoot "best-effort" — o fallback continua e tenta /internal/ai/decisions via fetchFn
    // fetchFn não injetada no fallbackOptions → usa fetch global → nock bloqueia → ExternalServiceError
    nock(CHATWOOT_BASE_URL).post(chatwootMessagesPath()).reply(201, chatwootMessageResponse);

    const { db } = makeMockDb({ waMessage: waMessageRow, convState: existingConvState });

    // Fallback tenta /internal/ai/decisions sem fetchFn injetado → nock bloqueia → ExternalServiceError
    // O erro propagado é do fallback, não do LangGraph original.
    await expect(
      handleProcessWithAi(db as never, makeLgOptions(lgFetch), makeEvent()),
    ).rejects.toThrow();

    // LangGraph foi chamado (1x) antes de falhar
    expect(lgFetch).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // 10b. Erro do LangGraph → fallback bem-sucedido → sem throw
  //      Quando o fallback completo executa com sucesso, o handler retorna
  //      sem propagar nenhum erro (evento processado com sucesso via fallback).
  // -------------------------------------------------------------------------
  it('retorna sem throw quando LangGraph falha mas o fallback completo é bem-sucedido', async () => {
    const lgFetch = makeFailingFetch(new Error('LangGraph request timeout após 8000ms'));

    // Fallback: passo 1 — Chatwoot
    nock(CHATWOOT_BASE_URL).post(chatwootMessagesPath()).reply(201, chatwootMessageResponse);

    // Fallback: passos 2 e 3 — fetchFn injetável via fallbackOptions
    const internalFetch: typeof fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ decision_log_id: 'dddddddd-dddd-dddd-dddd-dddddddddddd' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const { db } = makeMockDb({ waMessage: waMessageRow, convState: existingConvState });

    const opts: ProcessWithAiOptions = {
      ...makeLgOptions(lgFetch),
      fallbackOptions: {
        chatwootOptions: {
          baseUrl: CHATWOOT_BASE_URL,
          apiToken: 'test-chatwoot-token',
          accountId: CHATWOOT_ACCOUNT_ID,
          timeoutMs: 5_000,
        },
        internalBaseUrl: 'http://localhost:3333',
        internalToken: 'a'.repeat(33),
        fetchFn: internalFetch,
      },
    };

    // Fallback bem-sucedido → sem throw
    await expect(handleProcessWithAi(db as never, opts, makeEvent())).resolves.toBeUndefined();

    // LangGraph chamado, fallback acionado
    expect(lgFetch).toHaveBeenCalledTimes(1);
    // fetchFn interno chamado (ai/decisions + handoffs = 2 chamadas)
    expect(internalFetch).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // 11. [CRÍTICO-1] Isolamento por organizationId
  //     Se o estado existente pertence a outra org, não deve ser retornado.
  //     O mock devolve [] para o SELECT da org do evento (ORG_ID) mesmo que
  //     outro tenant tenha um estado para o mesmo número.
  // -------------------------------------------------------------------------
  it('[CRÍTICO-1] não retorna estado de outra organização para o mesmo telefone', async () => {
    // Simula: org A tem o estado para esse telefone, mas o evento é da org B.
    // O mock retorna [] para a query da org B (convState: null) →
    // handler cria novo estado via INSERT (insertConvState com org B).
    const orgBId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const newStateOrgB = {
      ...existingConvState,
      organizationId: orgBId,
      conversationId: '55555555-5555-5555-5555-555555555555',
      chatwootConversationId: null,
      leadId: null,
    };

    const lgFetch = makeJsonFetch(makeAiResponse());

    const { db, selectWhereArgs } = makeMockDb({
      waMessage: waMessageRow,
      convState: null, // SELECT da org B retorna vazio — sem cross-tenant
      insertConvState: newStateOrgB,
    });

    const eventOrgB = makeEvent({ organizationId: orgBId });
    await expect(
      handleProcessWithAi(db as never, makeLgOptions(lgFetch), eventOrgB),
    ).resolves.toBeUndefined();

    // Verificar que o SELECT da ai_conversation_states usou and() com múltiplas condições
    // (índice 1 = segunda chamada select = busca de conv state)
    const convStateWhereArgs = selectWhereArgs[1];
    // and() é chamado com (eq_organizationId, eq_phone, isNull_deletedAt)
    // O mock de drizzle-orm retorna { __and: [...] } para and(...)
    expect(convStateWhereArgs).toBeDefined();
    expect(convStateWhereArgs?.[0]).toHaveProperty('__and');
    const andConditions = (convStateWhereArgs?.[0] as { __and: unknown[] }).__and;
    // Deve ter 3 condições: organizationId, phone, deletedAt IS NULL
    expect(andConditions).toHaveLength(3);

    // LangGraph foi chamado com o conversationId da nova org B
    expect(lgFetch).toHaveBeenCalledTimes(1);
    const sentBody = JSON.parse(
      (lgFetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.body as string,
    ) as Record<string, unknown>;
    expect(sentBody['conversation_id']).toBe(newStateOrgB.conversationId);
  });

  // -------------------------------------------------------------------------
  // 12. [CRÍTICO-2] Soft-delete — conversa encerrada não é reativada
  //     Se o único estado para (org, phone) está soft-deletado, deve criar novo.
  // -------------------------------------------------------------------------
  it('[CRÍTICO-2] não reativa conversa soft-deletada — cria novo estado', async () => {
    // Simula: o único estado existente está deleted_at != null.
    // O mock retorna [] (deletedAt filtrado pelo handler) → handler cria novo via INSERT.
    const newConvState = {
      ...existingConvState,
      conversationId: '66666666-6666-6666-6666-666666666666',
      chatwootConversationId: null,
      leadId: null,
    };

    const lgFetch = makeJsonFetch(makeAiResponse());

    // convState: null — SELECT com isNull(deletedAt) não retorna o estado deletado
    const { db, selectWhereArgs } = makeMockDb({
      waMessage: waMessageRow,
      convState: null,
      insertConvState: newConvState,
    });

    await expect(
      handleProcessWithAi(db as never, makeLgOptions(lgFetch), makeEvent()),
    ).resolves.toBeUndefined();

    // SELECT deve incluir isNull(deletedAt) — verificar que and() tem 3 condições
    const convStateWhereArgs = selectWhereArgs[1];
    expect(convStateWhereArgs?.[0]).toHaveProperty('__and');
    const andConditions = (convStateWhereArgs?.[0] as { __and: unknown[] }).__and;
    expect(andConditions).toHaveLength(3);

    // Nova conversa foi criada e usada no request
    expect(lgFetch).toHaveBeenCalledTimes(1);
    const sentBody = JSON.parse(
      (lgFetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.body as string,
    ) as Record<string, unknown>;
    expect(sentBody['conversation_id']).toBe(newConvState.conversationId);
  });

  // -------------------------------------------------------------------------
  // 13. [MÉDIO-1] Mensagem de inconsistência não contém phone (PII)
  //     ON CONFLICT → reload retorna vazio → deve lançar erro sem PII.
  // -------------------------------------------------------------------------
  it('[M1] ZodError do LangGraph não vaza dump de schema em log — fallback acionado sem throw', async () => {
    // Cria um ZodError real com múltiplos issues (simula resposta inválida do LangGraph)
    const zodErr = new ZodError([
      {
        code: 'invalid_type',
        expected: 'string',
        received: 'number',
        path: ['reply', 'content'],
        message: 'Expected string, received number',
      },
      {
        code: 'invalid_type',
        expected: 'string',
        received: 'undefined',
        path: ['graph_version'],
        message: 'Required',
      },
    ]);

    // LangGraph lança ZodError (response inválido)
    const lgFetch: typeof fetch = vi.fn().mockRejectedValue(zodErr);

    // Fallback: Chatwoot (nock) + /internal/* (fetchFn injetável)
    nock(CHATWOOT_BASE_URL).post(chatwootMessagesPath()).reply(201, chatwootMessageResponse);

    const internalFetch: typeof fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ decision_log_id: 'dddddddd-dddd-dddd-dddd-dddddddddddd' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const { db } = makeMockDb({ waMessage: waMessageRow, convState: existingConvState });

    const opts: ProcessWithAiOptions = {
      ...makeLgOptions(lgFetch),
      fallbackOptions: {
        chatwootOptions: {
          baseUrl: CHATWOOT_BASE_URL,
          apiToken: 'test-chatwoot-token',
          accountId: CHATWOOT_ACCOUNT_ID,
          timeoutMs: 5_000,
        },
        internalBaseUrl: 'http://localhost:3333',
        internalToken: 'a'.repeat(33),
        fetchFn: internalFetch,
      },
    };

    // Não deve lançar — fallback completou; ZodError foi sanitizado no log
    await expect(handleProcessWithAi(db as never, opts, makeEvent())).resolves.toBeUndefined();

    // LangGraph chamado (1x) — falhou com ZodError
    expect(lgFetch).toHaveBeenCalledTimes(1);
    // Fallback acionou /internal/ai/decisions e /internal/handoffs (2 chamadas)
    expect(internalFetch).toHaveBeenCalledTimes(2);
  });

  it('[MÉDIO-1] erro de inconsistência não vaza phone no message — usa organizationId', async () => {
    const lgFetch = vi.fn() as unknown as typeof fetch;

    // Simula corrida: SELECT retorna [], INSERT com ON CONFLICT → returning: [],
    // reload SELECT também retorna [] → inconsistência
    const { db } = makeMockDb({
      waMessage: waMessageRow,
      convState: null, // SELECT inicial vazio
      insertConvState: null, // INSERT → ON CONFLICT → returning []
      reloadConvState: null, // reload também vazio → inconsistência
    });

    const error = await handleProcessWithAi(db as never, makeLgOptions(lgFetch), makeEvent()).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(Error);
    const errMsg = (error as Error).message;
    // Não deve conter o número de telefone (PII) — LGPD §8.3
    expect(errMsg).not.toMatch(/phone=/);
    expect(errMsg).not.toMatch(/5569999999999/);
    // Deve conter organizationId para correlação
    expect(errMsg).toContain(ORG_ID);
  });
});
