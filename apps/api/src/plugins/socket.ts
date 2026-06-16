// =============================================================================
// plugins/socket.ts — Plugin Fastify: servidor Socket.io + auth de handshake (F16-S14).
//
// Responsabilidades:
//   - Registrar Socket.io no servidor HTTP do Fastify (namespace /livechat).
//   - Autenticar cada conexão via JWT Bearer ou cookie access_token.
//   - Ao conectar, dar join automático em workspace:{organizationId}.
//   - Eventos do cliente:
//       conversation:join  → join em conversation:{conversationId} (valida escopo de org)
//       conversation:leave → leave de conversation:{conversationId}
//
// Escopo de cidade (LGPD + segurança):
//   - A sala workspace:{orgId} separa tenants completamente.
//   - conversation:{conversationId} valida que a conversa pertence à org do cliente
//     conectado — evita vazamento cross-org/cross-cidade.
//   - Escopo de cidade é garantido pelo relay: events só chegam para salas
//     de conversas da org/cidade correta (workers filtram ao publicar).
//
// LGPD (doc 17 §8.3):
//   - socket.data carrega apenas userId + organizationId (IDs opacos, sem PII).
//   - Logs estruturados não expõem token JWT (redact canônico cobre headers.authorization).
//
// Reconexão:
//   - Socket.io re-dispara o handshake em cada reconexão; o join em workspace:{}
//     é feito no evento 'connection' — portanto re-entra na sala automaticamente.
//   - Para conversation:{}, o cliente deve re-emitir conversation:join após reconectar
//     (rooms são transientes — perdidas em disconnect, padrão Socket.io).
// =============================================================================

import type { Server as HttpServer } from 'node:http';

import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { Server as SocketIOServer } from 'socket.io';
import type { Socket } from 'socket.io';
import { z } from 'zod';

import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { conversations } from '../db/schema/conversations.js';
import { logger } from '../lib/logger.js';
import { verifyAccessToken } from '../shared/jwt.js';

// ---------------------------------------------------------------------------
// Tipos exportados (usados pelo relay e por testes)
// ---------------------------------------------------------------------------

/** Dados de autenticação que ficam em socket.data após handshake bem-sucedido. */
export interface SocketAuthData {
  userId: string;
  organizationId: string;
}

/** Socket tipado com os dados de auth populados pelo middleware. */
export type AuthenticatedSocket = Socket & { data: SocketAuthData };

// ---------------------------------------------------------------------------
// Schemas de validação dos eventos emitidos pelo cliente
// ---------------------------------------------------------------------------

const ConversationPayloadSchema = z.object({
  conversationId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Extração de token do handshake
// ---------------------------------------------------------------------------

/**
 * Extrai o Bearer token do handshake Socket.io.
 *
 * Ordem de precedência:
 *   1. Authorization: Bearer <token> (header HTTP do handshake — preferido)
 *   2. Cookie access_token (browsers com httpOnly cookie)
 *   3. socket.handshake.auth.token (campo Socket.io auth passado pelo cliente JS)
 */
export function extractToken(socket: Socket): string | null {
  // 1. Authorization header
  const authHeader = socket.handshake.headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length);
  }

  // 2. Cookie access_token
  const cookieHeader = socket.handshake.headers['cookie'];
  if (typeof cookieHeader === 'string') {
    const match = /(?:^|;\s*)access_token=([^;]+)/.exec(cookieHeader);
    if (match?.[1]) {
      return decodeURIComponent(match[1]);
    }
  }

  // 3. Socket.io auth object: new Socket({ auth: { token } })
  const authObj = socket.handshake.auth as Record<string, unknown>;
  if (typeof authObj['token'] === 'string') {
    return authObj['token'];
  }

  return null;
}

// ---------------------------------------------------------------------------
// Middleware de autenticação do handshake
// ---------------------------------------------------------------------------

/**
 * Middleware Socket.io: valida JWT e popula socket.data.
 * Rejeita a conexão com erro UNAUTHORIZED se o token for inválido/ausente.
 *
 * Exportado para testes unitários.
 */
export async function authMiddleware(socket: Socket, next: (err?: Error) => void): Promise<void> {
  const token = extractToken(socket);

  if (!token) {
    logger.warn(
      {
        event: 'socket.authn.failed',
        reason: 'missing_token',
        transport: socket.conn.transport.name,
      },
      'socket handshake rejected: no token',
    );
    next(new Error('UNAUTHORIZED'));
    return;
  }

  try {
    const payload = await verifyAccessToken(token);
    // payload.org é string — validado em verifyAccessToken mas TS o vê como JWTPayload claim
    const org = payload['org'];
    if (typeof org !== 'string') {
      throw new Error('Token sem claim org');
    }

    socket.data = {
      userId: payload.sub,
      organizationId: org,
    } satisfies SocketAuthData;

    next();
  } catch {
    logger.warn(
      {
        event: 'socket.authn.failed',
        reason: 'invalid_or_expired_token',
        transport: socket.conn.transport.name,
      },
      'socket handshake rejected: invalid token',
    );
    next(new Error('UNAUTHORIZED'));
  }
}

// ---------------------------------------------------------------------------
// Validação de escopo de conversa
// ---------------------------------------------------------------------------

/**
 * Verifica que conversationId pertence à org do socket conectado.
 *
 * Escopo: filtra por id + organizationId na mesma query (index covering em prod).
 * Exportado para testes unitários.
 */
export async function validateConversationScope(
  conversationId: string,
  organizationId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)),
    )
    .limit(1);

  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Handlers de evento de um socket autenticado
// ---------------------------------------------------------------------------

/**
 * Registra handlers de evento para um socket autenticado.
 * Chamado dentro do handler 'connection' do namespace /livechat.
 *
 * Exportado para testes.
 */
export function setupSocketHandlers(socket: AuthenticatedSocket): void {
  const { userId, organizationId } = socket.data;
  const workspaceRoom = `workspace:${organizationId}`;

  logger.info(
    { event: 'socket.connected', userId, organizationId, socketId: socket.id },
    'socket client connected',
  );

  // Join automático na sala do workspace da org (re-entra em cada reconexão automática)
  void socket.join(workspaceRoom);

  // conversation:join — receber eventos de uma conversa específica
  socket.on('conversation:join', (raw: unknown) => {
    const parsed = ConversationPayloadSchema.safeParse(raw);
    if (!parsed.success) {
      socket.emit('error', {
        code: 'INVALID_PAYLOAD',
        message: 'conversationId (UUID) é obrigatório',
      });
      return;
    }

    const { conversationId } = parsed.data;

    void validateConversationScope(conversationId, organizationId).then((allowed) => {
      if (!allowed) {
        logger.warn(
          {
            event: 'socket.join.denied',
            userId,
            organizationId,
            conversationId,
            socketId: socket.id,
          },
          'socket conversation:join negado — violação de escopo',
        );
        socket.emit('error', {
          code: 'FORBIDDEN',
          message: 'Conversa não encontrada ou fora do seu escopo',
        });
        return;
      }

      const room = `conversation:${conversationId}`;
      void socket.join(room);
      logger.info(
        {
          event: 'socket.conversation.joined',
          userId,
          organizationId,
          conversationId,
          socketId: socket.id,
        },
        'socket entrou na sala de conversa',
      );
    });
  });

  // conversation:leave — sair de uma sala de conversa
  socket.on('conversation:leave', (raw: unknown) => {
    const parsed = ConversationPayloadSchema.safeParse(raw);
    if (!parsed.success) return;

    const { conversationId } = parsed.data;
    const room = `conversation:${conversationId}`;
    void socket.leave(room);
    logger.info(
      {
        event: 'socket.conversation.left',
        userId,
        organizationId,
        conversationId,
        socketId: socket.id,
      },
      'socket saiu da sala de conversa',
    );
  });

  socket.on('disconnect', (reason) => {
    logger.info(
      { event: 'socket.disconnected', userId, organizationId, socketId: socket.id, reason },
      'socket client disconnected',
    );
  });
}

// ---------------------------------------------------------------------------
// Plugin Fastify
// ---------------------------------------------------------------------------

/**
 * Registra o servidor Socket.io no Fastify.
 *
 * Namespace: /livechat
 * Auth JWT: Bearer header ou cookie access_token ou socket.handshake.auth.token.
 * Rooms:
 *   - workspace:{orgId}       — toda conexão autenticada entra automaticamente
 *   - conversation:{convId}   — sob demanda via evento conversation:join
 *
 * O decorator fastify.io expõe o SocketIOServer para uso pelo relay worker
 * (startSocketRelay em workers/livechat-socket-relay.ts).
 *
 * @example
 * // Em server.ts — após buildApp():
 * await app.register(socketPlugin);
 * await app.listen({ port: 3333 });
 * await startSocketRelay(app.io);
 */
export const socketPlugin: FastifyPluginAsync = async (fastify) => {
  const allowedOrigins = env.CORS_ALLOWED_ORIGINS;

  const io = new SocketIOServer(fastify.server as HttpServer, {
    cors: {
      origin: (origin, callback) => {
        // Permite requisições sem origin (curl, testes, SSR)
        if (!origin) {
          callback(null, true);
          return;
        }
        if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'), false);
        }
      },
      credentials: true,
    },
    pingTimeout: 20_000,
    pingInterval: 25_000,
    transports: ['websocket', 'polling'],
    path: '/socket.io/',
  });

  // Namespace /livechat — isola do namespace padrão '/' e de namespaces futuros
  const livechat = io.of('/livechat');

  // Middleware de auth em todas as conexões do namespace
  livechat.use(authMiddleware);

  // Handler de conexão autenticada
  livechat.on('connection', (socket) => {
    setupSocketHandlers(socket as AuthenticatedSocket);
  });

  // Expõe io como decorator de fastify para o relay worker
  // `as unknown as SocketIOServer` — FastifyInstance.decorate aceita unknown;
  // cast aqui é seguro porque io é SocketIOServer recém-criado neste escopo.
  fastify.decorate('io', io as unknown as SocketIOServer);

  // Graceful shutdown: fechar Socket.io antes de encerrar o Fastify
  fastify.addHook('onClose', async () => {
    await new Promise<void>((resolve) => {
      io.close(() => {
        resolve();
      });
    });
    logger.info('Socket.io server closed');
  });

  logger.info('Socket.io registered — namespace /livechat');
};

// ---------------------------------------------------------------------------
// Augmentação de tipo para o decorator fastify.io
// ---------------------------------------------------------------------------

declare module 'fastify' {
  interface FastifyInstance {
    io: SocketIOServer;
  }
}
