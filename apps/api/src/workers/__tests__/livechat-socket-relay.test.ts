// =============================================================================
// livechat-socket-relay.test.ts — Testes do plugin Socket.io + relay (F16-S14).
//
// Estratégia: mocks de socket, db, verifyAccessToken e amqplib.
//   Nenhuma conexão real com RabbitMQ, Postgres ou rede.
//
// Cenários cobertos:
//
// — authMiddleware (handshake) —
//   1.  Token ausente (sem header, sem cookie, sem auth.token) → next(UNAUTHORIZED)
//   2.  Token inválido / expirado → next(UNAUTHORIZED)
//   3.  Token com claim org ausente → next(UNAUTHORIZED)
//   4.  Token válido → socket.data populado, next() sem erro
//   5.  Token via cookie access_token → autenticado com sucesso
//   6.  Token via socket.handshake.auth.token → autenticado com sucesso
//
// — extractToken —
//   7.  Bearer header tem prioridade sobre cookie
//   8.  Cookie tem prioridade sobre auth.token
//
// — setupSocketHandlers —
//   9.  Ao conectar: socket.join('workspace:{orgId}') chamado automaticamente
//  10.  conversation:join com payload inválido → socket.emit('error', INVALID_PAYLOAD)
//  11.  conversation:join → conversa fora da org → socket.emit('error', FORBIDDEN)
//  12.  conversation:join → conversa da org → socket.join('conversation:{id}')
//  13.  conversation:leave → socket.leave('conversation:{id}')
//
// — relay (startSocketRelay) —
//  14.  Corpo não-JSON → nack(false, false), sem ack
//  15.  Payload JSON mas inválido (faltam campos) → nack(false, false)
//  16.  Payload válido → io.of('/livechat').to(room).emit(event, data) + ack
//  17.  Payload válido para room de conversa → emit na room correta (isolamento)
// =============================================================================

import type { Socket } from 'socket.io';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Variáveis hoistadas (resolvem o "Cannot access before initialization" do vi.mock)
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const mockVerifyAccessToken = vi.fn();
  const mockDbSelect = vi.fn();

  const mockChannel = {
    prefetch: vi.fn().mockResolvedValue(undefined),
    consume: vi.fn().mockResolvedValue({ consumerTag: 'test-tag' }),
    ack: vi.fn(),
    nack: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    // startSocketRelay() chama assertTopology(channel) antes de consumir (fix de
    // boot com broker fresco em CI) — sem estes métodos o mock quebra com
    // "channel.assertExchange is not a function".
    assertExchange: vi.fn().mockResolvedValue(undefined),
    assertQueue: vi.fn().mockResolvedValue(undefined),
    bindQueue: vi.fn().mockResolvedValue(undefined),
  };

  const mockConnection = {
    createChannel: vi.fn().mockResolvedValue(mockChannel),
    close: vi.fn().mockResolvedValue(undefined),
  };

  return { mockVerifyAccessToken, mockDbSelect, mockChannel, mockConnection };
});

// ---------------------------------------------------------------------------
// Mock env (DEVE ser declarado antes dos imports reais)
// ---------------------------------------------------------------------------
vi.mock('../../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    JWT_ACCESS_SECRET: 'a'.repeat(64),
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_SECRET: 'b'.repeat(64),
    JWT_REFRESH_TTL: '30d',
    API_HOST: '0.0.0.0',
    API_PORT: 3333,
    API_PUBLIC_URL: 'http://localhost:3333',
    CORS_ALLOWED_ORIGINS: ['http://localhost:5173'],
    LANGGRAPH_INTERNAL_TOKEN: 'a'.repeat(33),
    LANGGRAPH_SERVICE_URL: 'http://localhost:8000',
    WHATSAPP_APP_SECRET: 'test-whatsapp-secret-at-least-16ch',
    WHATSAPP_VERIFY_TOKEN: 'test-verify-token',
    RABBITMQ_URL: 'amqp://localhost:5672',
    FX_BRL_PER_USD: 5.75,
    LGPD_DEDUPE_PEPPER: 'a'.repeat(44),
    META_WHATSAPP_ACCESS_TOKEN: 'test-token',
    META_WHATSAPP_PHONE_NUMBER_ID: '123456789',
  },
}));

// ---------------------------------------------------------------------------
// Mock pg (evita conexão real)
// ---------------------------------------------------------------------------
vi.mock('pg', () => {
  const MockPool = vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  return { Pool: MockPool, default: { Pool: MockPool } };
});

// ---------------------------------------------------------------------------
// Mock drizzle-orm
// ---------------------------------------------------------------------------
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ __eq: val })),
  and: vi.fn((...args: unknown[]) => ({ __and: args })),
  sql: Object.assign(
    vi.fn(() => ({})),
    { mapWith: vi.fn() },
  ),
  relations: vi.fn().mockReturnValue({}),
  primaryKey: vi.fn().mockReturnValue({}),
  index: vi.fn().mockReturnValue({ on: vi.fn().mockReturnValue({}) }),
  uniqueIndex: vi.fn().mockReturnValue({ on: vi.fn().mockReturnValue({}) }),
  pgTable: vi.fn(),
  uuid: vi.fn().mockReturnValue({
    primaryKey: vi.fn().mockReturnThis(),
    default: vi.fn().mockReturnThis(),
    notNull: vi.fn().mockReturnThis(),
    references: vi.fn().mockReturnThis(),
  }),
  text: vi.fn().mockReturnValue({
    notNull: vi.fn().mockReturnThis(),
    default: vi.fn().mockReturnThis(),
  }),
  boolean: vi.fn().mockReturnValue({
    notNull: vi.fn().mockReturnThis(),
    default: vi.fn().mockReturnThis(),
  }),
  timestamp: vi.fn().mockReturnValue({
    notNull: vi.fn().mockReturnThis(),
    default: vi.fn().mockReturnThis(),
  }),
  integer: vi.fn().mockReturnValue({
    notNull: vi.fn().mockReturnThis(),
    default: vi.fn().mockReturnThis(),
  }),
  jsonb: vi.fn().mockReturnValue({
    notNull: vi.fn().mockReturnThis(),
    default: vi.fn().mockReturnThis(),
  }),
  check: vi.fn().mockReturnValue({}),
  customType: vi
    .fn()
    .mockReturnValue(vi.fn().mockReturnValue({ notNull: vi.fn().mockReturnThis() })),
}));

// ---------------------------------------------------------------------------
// Mock drizzle-orm/node-postgres
// ---------------------------------------------------------------------------
vi.mock('drizzle-orm/node-postgres', () => ({
  drizzle: vi.fn().mockReturnValue({
    select: mocks.mockDbSelect,
  }),
}));

// ---------------------------------------------------------------------------
// Mock amqplib (evita conexão real com RabbitMQ)
// ---------------------------------------------------------------------------
vi.mock('amqplib', () => ({
  default: {
    connect: vi.fn().mockResolvedValue(mocks.mockConnection),
  },
}));

// ---------------------------------------------------------------------------
// Mock db/client (injeta db com select mockado)
// ---------------------------------------------------------------------------
vi.mock('../../db/client.js', () => ({
  db: {
    select: mocks.mockDbSelect,
  },
  pool: {
    end: vi.fn(),
    on: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mock verifyAccessToken
// ---------------------------------------------------------------------------
vi.mock('../../shared/jwt.js', () => ({
  verifyAccessToken: (...args: unknown[]) => mocks.mockVerifyAccessToken(...args),
}));

// ---------------------------------------------------------------------------
// Mock logger (silencioso nos testes)
// ---------------------------------------------------------------------------
vi.mock('../../lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Imports reais (após todos os mocks)
// ---------------------------------------------------------------------------
import {
  authMiddleware,
  extractToken,
  setupSocketHandlers,
  type AuthenticatedSocket,
  type SocketAuthData,
} from '../../plugins/socket.js';
import { startSocketRelay } from '../livechat-socket-relay.js';

// ---------------------------------------------------------------------------
// Helpers para criar mocks de socket
// ---------------------------------------------------------------------------

function makeSocket(
  overrides: {
    headers?: Record<string, string>;
    cookieHeader?: string;
    auth?: Record<string, unknown>;
  } = {},
): Socket {
  return {
    id: 'socket-test-id',
    conn: { transport: { name: 'websocket' } },
    handshake: {
      headers: {
        ...(overrides.headers ?? {}),
        ...(overrides.cookieHeader ? { cookie: overrides.cookieHeader } : {}),
      },
      auth: overrides.auth ?? {},
    },
    data: {} as SocketAuthData,
    join: vi.fn().mockResolvedValue(undefined),
    leave: vi.fn().mockResolvedValue(undefined),
    emit: vi.fn(),
    on: vi.fn(),
  } as unknown as Socket;
}

function makeAuthenticatedSocket(userId: string, organizationId: string): AuthenticatedSocket {
  const socket = makeSocket({ headers: { authorization: 'Bearer valid-token' } });
  (socket as AuthenticatedSocket).data = { userId, organizationId };
  return socket as AuthenticatedSocket;
}

// ---------------------------------------------------------------------------
// Helper para db mock: configura select().from().where().limit() fluente
// ---------------------------------------------------------------------------

function setupDbSelectReturning(rows: unknown[]): void {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
  mocks.mockDbSelect.mockReturnValue(chain);
}

// ---------------------------------------------------------------------------
// Testes: extractToken
// ---------------------------------------------------------------------------

describe('extractToken', () => {
  it('7. retorna token do Authorization Bearer header', () => {
    const socket = makeSocket({ headers: { authorization: 'Bearer mytoken123' } });
    expect(extractToken(socket)).toBe('mytoken123');
  });

  it('Bearer header tem prioridade sobre cookie', () => {
    const socket = makeSocket({
      headers: { authorization: 'Bearer from-header' },
      cookieHeader: 'access_token=from-cookie',
    });
    expect(extractToken(socket)).toBe('from-header');
  });

  it('8. cookie tem prioridade sobre auth.token', () => {
    const socket = makeSocket({
      cookieHeader: 'access_token=from-cookie',
      auth: { token: 'from-auth-obj' },
    });
    expect(extractToken(socket)).toBe('from-cookie');
  });

  it('retorna null quando nenhum token está presente', () => {
    const socket = makeSocket();
    expect(extractToken(socket)).toBeNull();
  });

  it('5. extrai token corretamente do cookie access_token com outros cookies ao redor', () => {
    const socket = makeSocket({ cookieHeader: 'other=x; access_token=cookie-token; another=y' });
    expect(extractToken(socket)).toBe('cookie-token');
  });

  it('6. extrai token de socket.handshake.auth.token', () => {
    const socket = makeSocket({ auth: { token: 'auth-obj-token' } });
    expect(extractToken(socket)).toBe('auth-obj-token');
  });
});

// ---------------------------------------------------------------------------
// Testes: authMiddleware
// ---------------------------------------------------------------------------

describe('authMiddleware', () => {
  beforeEach(() => {
    mocks.mockVerifyAccessToken.mockReset();
  });

  it('1. rejeita com UNAUTHORIZED quando token está ausente', async () => {
    const socket = makeSocket();
    const next = vi.fn();

    await authMiddleware(socket, next);

    expect(next).toHaveBeenCalledOnce();
    const err = next.mock.calls[0]?.[0] as Error | undefined;
    expect(err).toBeInstanceOf(Error);
    expect(err?.message).toBe('UNAUTHORIZED');
  });

  it('2. rejeita com UNAUTHORIZED quando token é inválido/expirado', async () => {
    const socket = makeSocket({ headers: { authorization: 'Bearer invalid-token' } });
    const next = vi.fn();
    mocks.mockVerifyAccessToken.mockRejectedValue(new Error('Token inválido'));

    await authMiddleware(socket, next);

    expect(next).toHaveBeenCalledOnce();
    const err = next.mock.calls[0]?.[0] as Error | undefined;
    expect(err?.message).toBe('UNAUTHORIZED');
  });

  it('3. rejeita quando token não tem claim org', async () => {
    const socket = makeSocket({ headers: { authorization: 'Bearer token-sem-org' } });
    const next = vi.fn();
    // verifyAccessToken retorna payload sem `org`
    mocks.mockVerifyAccessToken.mockResolvedValue({ sub: 'user-id-123' });

    await authMiddleware(socket, next);

    const err = next.mock.calls[0]?.[0] as Error | undefined;
    expect(err?.message).toBe('UNAUTHORIZED');
  });

  it('4. autentica com sucesso e popula socket.data', async () => {
    const socket = makeSocket({ headers: { authorization: 'Bearer valid-jwt' } });
    const next = vi.fn();
    mocks.mockVerifyAccessToken.mockResolvedValue({
      sub: 'user-uuid-123',
      org: 'org-uuid-456',
    });

    await authMiddleware(socket, next);

    expect(next).toHaveBeenCalledOnce();
    // next sem argumento = sucesso
    expect(next).toHaveBeenCalledWith();
    expect((socket as AuthenticatedSocket).data.userId).toBe('user-uuid-123');
    expect((socket as AuthenticatedSocket).data.organizationId).toBe('org-uuid-456');
  });

  it('5. autentica via cookie access_token', async () => {
    const socket = makeSocket({ cookieHeader: 'access_token=cookie-jwt' });
    const next = vi.fn();
    mocks.mockVerifyAccessToken.mockResolvedValue({ sub: 'user-id', org: 'org-id' });

    await authMiddleware(socket, next);

    expect(mocks.mockVerifyAccessToken).toHaveBeenCalledWith('cookie-jwt');
    expect(next).toHaveBeenCalledWith();
  });

  it('6. autentica via socket.handshake.auth.token', async () => {
    const socket = makeSocket({ auth: { token: 'auth-obj-jwt' } });
    const next = vi.fn();
    mocks.mockVerifyAccessToken.mockResolvedValue({ sub: 'user-id', org: 'org-id' });

    await authMiddleware(socket, next);

    expect(mocks.mockVerifyAccessToken).toHaveBeenCalledWith('auth-obj-jwt');
    expect(next).toHaveBeenCalledWith();
  });
});

// ---------------------------------------------------------------------------
// Testes: setupSocketHandlers
// ---------------------------------------------------------------------------

describe('setupSocketHandlers', () => {
  beforeEach(() => {
    mocks.mockDbSelect.mockReset();
  });

  it('9. join automático em workspace:{orgId} ao conectar', () => {
    const socket = makeAuthenticatedSocket('user-1', 'org-aaa');
    setupSocketHandlers(socket);
    expect(socket.join).toHaveBeenCalledWith('workspace:org-aaa');
  });

  it('10. conversation:join com payload inválido emite error INVALID_PAYLOAD', () => {
    const socket = makeAuthenticatedSocket('user-1', 'org-aaa');
    setupSocketHandlers(socket);

    // Captura o handler registrado para 'conversation:join'
    const onCalls = (socket.on as ReturnType<typeof vi.fn>).mock.calls as Array<
      [string, (payload: unknown) => void]
    >;
    const joinHandler = onCalls.find(([event]) => event === 'conversation:join')?.[1];

    expect(joinHandler).toBeDefined();
    joinHandler?.({ notAConversationId: 'bad-payload' });

    expect(socket.emit).toHaveBeenCalledWith('error', {
      code: 'INVALID_PAYLOAD',
      message: expect.stringContaining('conversationId'),
    });
  });

  it('11. conversation:join com conversa fora da org → emite error FORBIDDEN', async () => {
    const socket = makeAuthenticatedSocket('user-1', 'org-aaa');
    setupSocketHandlers(socket);
    setupDbSelectReturning([]); // db não encontra a conversa na org

    const onCalls = (socket.on as ReturnType<typeof vi.fn>).mock.calls as Array<
      [string, (payload: unknown) => void]
    >;
    const joinHandler = onCalls.find(([event]) => event === 'conversation:join')?.[1];

    joinHandler?.({ conversationId: '11111111-1111-1111-1111-111111111111' });

    // Aguarda a Promise interna (validateConversationScope é async)
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    expect(socket.emit).toHaveBeenCalledWith('error', {
      code: 'FORBIDDEN',
      message: expect.stringContaining('escopo'),
    });
    expect(socket.join).not.toHaveBeenCalledWith(
      'conversation:11111111-1111-1111-1111-111111111111',
    );
  });

  it('12. conversation:join com conversa da org → socket.join(conversation:{id})', async () => {
    const orgId = 'org-bbb';
    const convId = '22222222-2222-2222-2222-222222222222';
    const socket = makeAuthenticatedSocket('user-2', orgId);
    setupSocketHandlers(socket);
    setupDbSelectReturning([{ id: convId }]); // conversa encontrada na org

    const onCalls = (socket.on as ReturnType<typeof vi.fn>).mock.calls as Array<
      [string, (payload: unknown) => void]
    >;
    const joinHandler = onCalls.find(([event]) => event === 'conversation:join')?.[1];

    joinHandler?.({ conversationId: convId });

    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    expect(socket.join).toHaveBeenCalledWith(`conversation:${convId}`);
    // Nenhum evento de erro deve ter sido emitido
    expect(socket.emit).not.toHaveBeenCalledWith('error', expect.anything());
  });

  it('13. conversation:leave → socket.leave(conversation:{id})', () => {
    const convId = '33333333-3333-3333-3333-333333333333';
    const socket = makeAuthenticatedSocket('user-3', 'org-ccc');
    setupSocketHandlers(socket);

    const onCalls = (socket.on as ReturnType<typeof vi.fn>).mock.calls as Array<
      [string, (payload: unknown) => void]
    >;
    const leaveHandler = onCalls.find(([event]) => event === 'conversation:leave')?.[1];

    leaveHandler?.({ conversationId: convId });

    expect(socket.leave).toHaveBeenCalledWith(`conversation:${convId}`);
  });
});

// ---------------------------------------------------------------------------
// Testes: startSocketRelay
// ---------------------------------------------------------------------------

describe('startSocketRelay — relay RabbitMQ → Socket.io', () => {
  /** Cria um mock de SocketIOServer mínimo para os testes do relay */
  function makeIoMock(): {
    io: { of: ReturnType<typeof vi.fn> };
    emitFn: ReturnType<typeof vi.fn>;
    toFn: ReturnType<typeof vi.fn>;
  } {
    const emitFn = vi.fn();
    const toFn = vi.fn().mockReturnValue({ emit: emitFn });
    const namespaceFn = vi.fn().mockReturnValue({ to: toFn });
    return { io: { of: namespaceFn }, emitFn, toFn };
  }

  /** Captura o handler de mensagem registrado na última chamada de channel.consume */
  function captureConsumeHandler(): (msg: { content: Buffer } | null) => void {
    const calls = (mocks.mockChannel.consume as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const lastCall = calls[calls.length - 1];
    // consume(queue, handler, options) — handler é o 2º argumento
    return lastCall?.[1] as (msg: { content: Buffer } | null) => void;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockChannel.consume.mockResolvedValue({ consumerTag: 'test-tag' });
    mocks.mockChannel.prefetch.mockResolvedValue(undefined);
    mocks.mockConnection.createChannel.mockResolvedValue(mocks.mockChannel);
  });

  it('14. corpo não-JSON → nack(false, false) sem ack', async () => {
    const { io } = makeIoMock();
    await startSocketRelay(io as never);
    const handler = captureConsumeHandler();

    handler({ content: Buffer.from('not-valid-json{{{') });

    expect(mocks.mockChannel.nack).toHaveBeenCalledWith(expect.anything(), false, false);
    expect(mocks.mockChannel.ack).not.toHaveBeenCalled();
  });

  it('15. payload JSON mas com campos ausentes → nack(false, false) sem ack', async () => {
    const { io } = makeIoMock();
    await startSocketRelay(io as never);
    const handler = captureConsumeHandler();

    // Payload JSON válido mas faltam room, event, data
    handler({ content: Buffer.from(JSON.stringify({ foo: 'bar' })) });

    expect(mocks.mockChannel.nack).toHaveBeenCalledWith(expect.anything(), false, false);
    expect(mocks.mockChannel.ack).not.toHaveBeenCalled();
  });

  it('16. payload válido → emit na room correta + ack', async () => {
    const { io, emitFn, toFn } = makeIoMock();
    await startSocketRelay(io as never);
    const handler = captureConsumeHandler();

    const job = {
      room: 'workspace:org-id-test',
      event: 'message.new',
      data: { messageId: 'msg-001' },
    };
    handler({ content: Buffer.from(JSON.stringify(job)) });

    expect(toFn).toHaveBeenCalledWith('workspace:org-id-test');
    expect(emitFn).toHaveBeenCalledWith('message.new', { messageId: 'msg-001' });
    expect(mocks.mockChannel.ack).toHaveBeenCalledOnce();
    expect(mocks.mockChannel.nack).not.toHaveBeenCalled();
  });

  it('17. payload para sala de conversa → emit na room conversation:{id} (isolamento)', async () => {
    const { io, emitFn, toFn } = makeIoMock();
    await startSocketRelay(io as never);
    const handler = captureConsumeHandler();

    const convId = 'aaaabbbb-cccc-dddd-eeee-ffff00001111';
    const job = {
      room: `conversation:${convId}`,
      event: 'conversation.updated',
      data: { status: 'resolved' },
    };
    handler({ content: Buffer.from(JSON.stringify(job)) });

    expect(toFn).toHaveBeenCalledWith(`conversation:${convId}`);
    expect(emitFn).toHaveBeenCalledWith('conversation.updated', { status: 'resolved' });
    expect(mocks.mockChannel.ack).toHaveBeenCalledOnce();
  });

  it('18. mensagem ENVELOPADA (makeEnvelope) → desempacota payload e emite na room', async () => {
    // Regressão: os publishers reais usam makeEnvelope → {id,type,organizationId,payload,ts}.
    // O relay deve validar envelope.payload (não o envelope cru, que não tem room/event/data).
    const { io, emitFn, toFn } = makeIoMock();
    await startSocketRelay(io as never);
    const handler = captureConsumeHandler();

    const envelope = {
      id: '11111111-1111-4111-8111-111111111111',
      type: 'hm.q.socket.relay',
      organizationId: '22222222-2222-4222-8222-222222222222',
      payload: {
        room: 'workspace:org-id-test',
        event: 'message:new',
        data: { messageId: 'msg-enveloped' },
      },
      ts: Date.now(),
    };
    handler({ content: Buffer.from(JSON.stringify(envelope)) });

    expect(toFn).toHaveBeenCalledWith('workspace:org-id-test');
    expect(emitFn).toHaveBeenCalledWith('message:new', { messageId: 'msg-enveloped' });
    expect(mocks.mockChannel.ack).toHaveBeenCalledOnce();
    expect(mocks.mockChannel.nack).not.toHaveBeenCalled();
  });
});
