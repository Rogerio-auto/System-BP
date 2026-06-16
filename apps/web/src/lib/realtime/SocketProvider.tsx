// =============================================================================
// lib/realtime/SocketProvider.tsx — Provider Socket.io autenticado (F16-S15).
//
// Responsabilidades:
//   - Conectar ao namespace /livechat com JWT do auth store.
//   - Atualizar auth token em reconexões silenciosas (refresh automático).
//   - Reconectar com backoff exponencial (padrão socket.io-client v4).
//   - Expor a instância do socket via contexto + hook useSocket().
//   - Desconectar no unmount para evitar memory leaks.
//
// Namespace /livechat:
//   - Definido no servidor: fastify plugin (plugins/socket.ts F16-S14).
//   - O servidor dá join automático em workspace:{orgId} após handshake.
//   - Para conversation:{convId}: cliente emite conversation:join.
//     O hook useConversationSocket gerencia esse join/leave.
//
// Auth:
//   - Token lido do auth-store no mount e atualizado via subscribe().
//   - Enviado em socket.handshake.auth.token para o middleware authMiddleware.
//   - Cookie httpOnly + Bearer header são alternativas aceitas pelo servidor;
//     aqui usamos handshake.auth pois cookies podem não ser enviados no WS.
//
// LGPD (doc 17 §8.3):
//   - Apenas o access_token (JWT opaco) trafega no handshake — sem PII.
//   - Não logamos nada do socket aqui — erros ficam só no devtools.
// =============================================================================

import * as React from 'react';
import type { Socket } from 'socket.io-client';
import { io } from 'socket.io-client';

import { useAuthStore } from '../auth-store';

// ---------------------------------------------------------------------------
// URL do servidor
// ---------------------------------------------------------------------------

/**
 * Resolve a URL base do servidor Socket.io.
 *
 * Dev: VITE_SOCKET_URL=http://localhost:3333 (mesma porta do Fastify).
 * Prod: mesmo origin da SPA (Nginx faz proxy /socket.io/ → API).
 */
function resolveSocketUrl(): string {
  return (import.meta.env['VITE_SOCKET_URL'] as string | undefined) ?? window.location.origin;
}

// ---------------------------------------------------------------------------
// Contexto
// ---------------------------------------------------------------------------

type SocketContextValue = Socket | null;

const SocketContext = React.createContext<SocketContextValue>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface SocketProviderProps {
  readonly children: React.ReactNode;
}

/**
 * SocketProvider — conecta ao namespace /livechat autenticado.
 *
 * Monte DENTRO do AuthGuard (access token já disponível).
 * Um único provider cobre toda a árvore da app.
 */
export function SocketProvider({ children }: SocketProviderProps): React.JSX.Element {
  const socketRef = React.useRef<Socket | null>(null);
  const [socket, setSocket] = React.useState<Socket | null>(null);

  React.useEffect(() => {
    const initialToken = useAuthStore.getState().accessToken ?? '';

    // Conecta ao namespace /livechat no servidor.
    // socket.io-client v4: io(baseURL + namespace, opts)
    // O servidor expõe: io.of('/livechat') com path=/socket.io/ (padrão).
    const sock = io(`${resolveSocketUrl()}/livechat`, {
      path: '/socket.io/',
      // Token no handshake — o servidor lê em socket.handshake.auth.token
      auth: { token: initialToken },
      // Transportes: websocket com polling como fallback
      transports: ['websocket', 'polling'],
      // Reconexão automática com backoff (padrão socket.io-client)
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 30_000,
      reconnectionAttempts: Infinity,
    });

    socketRef.current = sock;
    setSocket(sock);

    return () => {
      sock.disconnect();
      socketRef.current = null;
      setSocket(null);
    };
  }, []);

  // Atualiza o auth token quando o store muda (ex: refresh silencioso via interceptor 401).
  // O socket.io-client enviará o token atualizado no próximo handshake de reconexão.
  React.useEffect(() => {
    const unsubscribe = useAuthStore.subscribe((state) => {
      const sock = socketRef.current;
      if (sock && state.accessToken) {
        // `auth` é mutável em socket.io-client v4 — atualiza sem reconectar.
        // A nova referência será usada no próximo handshake.
        sock.auth = { token: state.accessToken };
      }
    });
    return unsubscribe;
  }, []);

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * useSocket — acessa a instância do Socket do contexto do provider.
 *
 * Retorna null se o provider não estiver montado ou o socket ainda não
 * estiver inicializado. Componentes consumidores devem tratar o caso null.
 *
 * @example
 * const socket = useSocket();
 * useEffect(() => {
 *   if (!socket) return;
 *   socket.on('message:new', handleNewMessage);
 *   return () => { socket.off('message:new', handleNewMessage); };
 * }, [socket]);
 */
export function useSocket(): Socket | null {
  return React.useContext(SocketContext);
}
