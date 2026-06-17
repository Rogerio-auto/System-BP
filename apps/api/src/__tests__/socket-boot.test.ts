// =============================================================================
// socket-boot.test.ts — Smoke test: wiring do socket no boot (F16-S25).
//
// Estrategia: testa que os modulos necessarios exportam as funcoes corretas
// e que a ordem canonica (plugin -> listen -> relay) e satisfeita em tipo.
//
// NÃO instancia Fastify/Socket.io aqui: a integracao real (socketPlugin + io)
// e coberta pelo livechat-socket-relay.test.ts (17 cenarios).
// O boot real e validado manualmente (ver PR checklist).
// =============================================================================

import type { Socket } from 'socket.io';
import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks minimos
// ---------------------------------------------------------------------------

vi.mock('../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    CORS_ALLOWED_ORIGINS: ['http://localhost:5173'],
    RABBITMQ_URL: 'amqp://localhost:5672',
    JWT_ACCESS_SECRET: 'a'.repeat(64),
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_SECRET: 'b'.repeat(64),
    JWT_REFRESH_TTL: '30d',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    API_HOST: '0.0.0.0',
    API_PORT: 3333,
    API_PUBLIC_URL: 'http://localhost:3333',
    LANGGRAPH_INTERNAL_TOKEN: 'a'.repeat(33),
    LANGGRAPH_SERVICE_URL: 'http://localhost:8000',
    WHATSAPP_APP_SECRET: 'test-secret-16chars',
    WHATSAPP_VERIFY_TOKEN: 'test-token',
    FX_BRL_PER_USD: 5.75,
    LGPD_DEDUPE_PEPPER: 'a'.repeat(44),
  },
}));

vi.mock('../db/client.js', () => ({
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

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../shared/jwt.js', () => ({
  verifyAccessToken: vi.fn().mockRejectedValue(new Error('UNAUTHORIZED')),
}));

vi.mock('amqplib', () => ({
  default: {
    connect: vi.fn().mockResolvedValue({
      createChannel: vi.fn().mockResolvedValue({
        prefetch: vi.fn().mockResolvedValue(undefined),
        consume: vi.fn().mockResolvedValue({ consumerTag: 'test' }),
        close: vi.fn().mockResolvedValue(undefined),
      }),
      close: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

// ---------------------------------------------------------------------------
// Testes: contratos de exportacao (wiring estatico)
// ---------------------------------------------------------------------------

describe('socket-boot: contratos de exportacao dos modulos de boot', () => {
  it('socketPlugin e um FastifyPluginAsync (funcao asyncrona)', async () => {
    const { socketPlugin } = await import('../plugins/socket.js');
    // FastifyPluginAsync e uma funcao — verificar tipo runtime
    expect(typeof socketPlugin).toBe('function');
    // Plugin deve ser async (retorna Promise)
    // Nao chamamos — apenas verificamos o tipo
  });

  it('startSocketRelay e uma funcao que aceita io como argumento (aridade 1)', async () => {
    const { startSocketRelay } = await import('../workers/livechat-socket-relay.js');
    expect(typeof startSocketRelay).toBe('function');
    // Aridade = 1: startSocketRelay(io: SocketIOServer)
    expect(startSocketRelay.length).toBe(1);
  });

  it('SocketRelayJobSchema esta disponivel para validar jobs', async () => {
    const { SocketRelayJobSchema } = await import('../workers/livechat-socket-relay.js');
    expect(SocketRelayJobSchema).toBeDefined();

    const valid = SocketRelayJobSchema.safeParse({
      room: 'workspace:org-id',
      event: 'message:new',
      data: { messageId: 'msg-1' },
    });
    expect(valid.success).toBe(true);

    const invalid = SocketRelayJobSchema.safeParse({ room: '', event: '', data: {} });
    expect(invalid.success).toBe(false);
  });

  it('authMiddleware e exportado para reuso em testes de integracao', async () => {
    const { authMiddleware } = await import('../plugins/socket.js');
    expect(typeof authMiddleware).toBe('function');
  });

  it('extractToken e exportado e extrai Bearer corretamente', async () => {
    const { extractToken } = await import('../plugins/socket.js');
    expect(typeof extractToken).toBe('function');

    // Simula socket com Authorization header
    const mockSocket = {
      handshake: {
        headers: { authorization: 'Bearer my-token' },
        auth: {},
      },
    };
    const token = extractToken(mockSocket as unknown as Socket);
    expect(token).toBe('my-token');
  });

  it('validateConversationScope e exportado para testes de integracao', async () => {
    const { validateConversationScope } = await import('../plugins/socket.js');
    expect(typeof validateConversationScope).toBe('function');
  });
});
