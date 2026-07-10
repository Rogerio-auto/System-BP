// =============================================================================
// socket.test.ts — Testes de plugins/socket.ts: sala pessoal user:{userId} (F24-S08).
//
// Escopo: cobre apenas o comportamento NOVO deste slot (join automático na sala
// user:{userId}). O restante de plugins/socket.ts (authMiddleware, extractToken,
// conversation:join/leave, workspace:{orgId}) já é coberto por
// workers/__tests__/livechat-socket-relay.test.ts — não duplicado aqui.
//
// Cenários:
//   1. Ao conectar, socket.join('user:{userId}') é chamado (junto de workspace).
//   2. A sala usa o userId do JWT (socket.data), não um valor arbitrário do cliente.
//   3. Reconexão: setupSocketHandlers roda de novo no evento 'connection' →
//      socket.join('user:{userId}') é chamado novamente (rooms são transientes).
// =============================================================================
import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock env + logger (evita side-effects de boot real)
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
  },
}));

vi.mock('../../db/client.js', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
  },
}));

vi.mock('../../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../shared/jwt.js', () => ({
  verifyAccessToken: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports reais (após mocks)
// ---------------------------------------------------------------------------

import { setupSocketHandlers, type AuthenticatedSocket, type SocketAuthData } from '../socket.js';

// ---------------------------------------------------------------------------
// Helper: socket autenticado mockado
// ---------------------------------------------------------------------------

function makeAuthenticatedSocket(userId: string, organizationId: string): AuthenticatedSocket {
  const data: SocketAuthData = { userId, organizationId };
  return {
    id: 'socket-test-id',
    data,
    join: vi.fn().mockResolvedValue(undefined),
    leave: vi.fn().mockResolvedValue(undefined),
    emit: vi.fn(),
    on: vi.fn(),
  } as unknown as AuthenticatedSocket;
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe('setupSocketHandlers — sala pessoal user:{userId} (F24-S08)', () => {
  it('1. join automático em user:{userId} ao conectar', () => {
    const socket = makeAuthenticatedSocket('user-1', 'org-aaa');

    setupSocketHandlers(socket);

    expect(socket.join).toHaveBeenCalledWith('user:user-1');
    // Continua entrando também na sala do workspace (comportamento preexistente).
    expect(socket.join).toHaveBeenCalledWith('workspace:org-aaa');
  });

  it('2. a sala usa o userId do JWT (socket.data), não um valor externo', () => {
    const socket = makeAuthenticatedSocket('user-legit-do-jwt', 'org-bbb');

    setupSocketHandlers(socket);

    expect(socket.join).toHaveBeenCalledWith('user:user-legit-do-jwt');
    expect(socket.join).not.toHaveBeenCalledWith(
      expect.stringMatching(/^user:(?!user-legit-do-jwt)/),
    );
  });

  it('3. reconexão: setupSocketHandlers roda de novo → re-entra em user:{userId}', () => {
    const socket = makeAuthenticatedSocket('user-2', 'org-ccc');

    // Simula duas conexões (handshake inicial + reconexão automática).
    setupSocketHandlers(socket);
    setupSocketHandlers(socket);

    const joinCalls = (socket.join as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([room]) => room === 'user:user-2',
    );
    expect(joinCalls).toHaveLength(2);
  });

  it('isola usuários diferentes em salas diferentes', () => {
    const socketA = makeAuthenticatedSocket('user-a', 'org-shared');
    const socketB = makeAuthenticatedSocket('user-b', 'org-shared');

    setupSocketHandlers(socketA);
    setupSocketHandlers(socketB);

    expect(socketA.join).toHaveBeenCalledWith('user:user-a');
    expect(socketA.join).not.toHaveBeenCalledWith('user:user-b');
    expect(socketB.join).toHaveBeenCalledWith('user:user-b');
    expect(socketB.join).not.toHaveBeenCalledWith('user:user-a');
  });
});
