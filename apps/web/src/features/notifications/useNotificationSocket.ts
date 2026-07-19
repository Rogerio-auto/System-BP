// =============================================================================
// features/notifications/useNotificationSocket.ts — Sino em tempo real (F24-S13).
//
// Assina `notification.new` no socket já conectado pelo SocketProvider
// (namespace /livechat, sala `user:{userId}` — join feito no backend F24-S08).
// NÃO abre conexão própria — reusa `useSocket()` de lib/realtime.
//
// Ao chegar `notification.new`:
//   1. Bump otimista do `unread_count` em cache (badge reage sem esperar o
//      refetch), igual ao padrão de useConversationSocket (setQueriesData).
//   2. Invalida a query de notificações — refetch em segundo plano traz o
//      item novo para a lista do dropdown.
//   3. Empilha um toast local (fila cap. TOAST_MAX_VISIBLE) — estilizado por
//      severidade no NotificationDropdown.tsx via tokens do DS.
//
// Payload do socket é mínimo por LGPD (doc 17 §8.5) — sem `body`:
//   { id, type, title, severity, entityType, entityId, createdAt }
//
// O poll de 60s (useNotifications, hooks.ts) continua ativo como fallback —
// nenhuma mudança nele. Esta assinatura é apenas um "empurrão" para reduzir
// a latência percebida quando o socket está disponível.
// =============================================================================

import type { NotificationListResponse } from '@elemento/shared-schemas';
import { useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

import { useSocket } from '../../lib/realtime/useSocket';

import { notificationKeys } from './hooks';
import { resolveNotificationHref } from './navigation';

// ---------------------------------------------------------------------------
// Payload do evento (contrato do backend — F24-S08/F24-S19)
// ---------------------------------------------------------------------------

/** Severidade da notificação — controla o estilo do toast (tokens do DS). */
export type NotificationSocketSeverity = 'info' | 'warning' | 'critical';

/** Payload mínimo publicado pelo backend em `notification.new` (sem `body` — LGPD). */
export interface NotificationSocketPayload {
  id: string;
  type: string;
  title: string;
  severity: NotificationSocketSeverity;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Fila de toasts
// ---------------------------------------------------------------------------
//
// Deep-link (`resolveNotificationHref`) mora em `./navigation` — fonte única
// reusada aqui e por `NotificationItem` (lista persistente), sem duplicação
// (doc 23 §14, gap G2).

export interface NotificationToast {
  readonly id: string;
  readonly severity: NotificationSocketSeverity;
  readonly title: string;
  readonly href: string | null;
  readonly createdAt: string;
}

/** Máximo de toasts empilhados simultaneamente — o excedente descarta o mais antigo. */
const TOAST_MAX_VISIBLE = 4;

/** Duração do auto-dismiss por severidade — quanto mais grave, mais tempo na tela. */
const TOAST_DURATION_MS: Record<NotificationSocketSeverity, number> = {
  info: 5_000,
  warning: 7_000,
  critical: 10_000,
};

export interface UseNotificationSocketResult {
  readonly toasts: readonly NotificationToast[];
  readonly dismissToast: (id: string) => void;
}

/**
 * useNotificationSocket — integra `notification.new` com o cache TanStack Query
 * e mantém a fila de toasts locais.
 *
 * Deve ser montado uma única vez (NotificationDropdown, singleton na Topbar).
 * Depende do SocketProvider estar montado acima na árvore.
 */
export function useNotificationSocket(): UseNotificationSocketResult {
  const socket = useSocket();
  const qc = useQueryClient();
  const [toasts, setToasts] = React.useState<NotificationToast[]>([]);
  const timersRef = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismissToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  React.useEffect(() => {
    if (!socket) return;

    function handleNotificationNew(payload: NotificationSocketPayload): void {
      // 1. Bump otimista do badge — reage antes do refetch completar.
      qc.setQueriesData<NotificationListResponse>(
        { queryKey: notificationKeys.all, exact: false },
        (old) => (old === undefined ? old : { ...old, unread_count: old.unread_count + 1 }),
      );

      // 2. Refetch em segundo plano — traz o item novo para a lista do dropdown.
      void qc.invalidateQueries({ queryKey: notificationKeys.all });

      // 3. Empilha o toast (dedupe por id — reconexão pode reenviar o mesmo evento).
      const toastEntry: NotificationToast = {
        id: payload.id,
        severity: payload.severity,
        title: payload.title,
        href: resolveNotificationHref(payload.entityType, payload.entityId),
        createdAt: payload.createdAt,
      };

      setToasts((prev) => {
        const next = [...prev.filter((t) => t.id !== toastEntry.id), toastEntry];
        return next.length > TOAST_MAX_VISIBLE ? next.slice(next.length - TOAST_MAX_VISIBLE) : next;
      });

      const existingTimer = timersRef.current.get(toastEntry.id);
      if (existingTimer !== undefined) clearTimeout(existingTimer);
      const timer = setTimeout(() => {
        dismissToast(toastEntry.id);
      }, TOAST_DURATION_MS[toastEntry.severity]);
      timersRef.current.set(toastEntry.id, timer);
    }

    socket.on('notification.new', handleNotificationNew);

    return () => {
      socket.off('notification.new', handleNotificationNew);
    };
  }, [socket, qc, dismissToast]);

  // Limpa todos os timers pendentes no unmount (evita setState após unmount).
  React.useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  return { toasts, dismissToast };
}
