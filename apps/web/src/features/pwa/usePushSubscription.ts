// =============================================================================
// features/pwa/usePushSubscription.ts — Ciclo de vida do opt-in de push
// (doc 24 §5.4, F27-S07).
//
//   1. `supported`: detecção de suporte do browser (serviceWorker + PushManager
//      + Notification) — degrada sem quebrar em navegadores/iOS antigos (§11).
//   2. Estado da subscription já registrada no browser é uma TanStack Query
//      (é I/O assíncrono do browser, não `useEffect+fetch` — só orquestra
//      `navigator.serviceWorker.ready`/`pushManager.getSubscription()`).
//   3. `subscribe()`: SÓ deve ser chamado dentro de um gesto do usuário (botão).
//      Pede `Notification.requestPermission()`, busca a chave pública VAPID,
//      assina via `PushManager.subscribe()` e registra no backend.
//   4. `unsubscribe()`: remove no backend e cancela a subscription no browser.
//
// LGPD (doc 17 / doc 24 §5.3): endpoint/keys nunca são logados no console;
// mensagens de erro expostas na UI são genéricas.
// =============================================================================

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

import { fetchPushPublicKey, registerPushSubscription, removePushSubscription } from './api';
import { isPushSupported } from './platform';
import { urlBase64ToUint8Array } from './vapid';

// ---------------------------------------------------------------------------
// Query key
// ---------------------------------------------------------------------------

export const pushSubscriptionQueryKey = ['pwa', 'push-subscription'] as const;

// ---------------------------------------------------------------------------
// Estado da subscription no browser
// ---------------------------------------------------------------------------

interface BrowserSubscriptionState {
  subscribed: boolean;
}

/**
 * Timeout defensivo para `serviceWorker.ready`: em `pnpm dev` o SW roda com
 * `devOptions.enabled: false` (F27-S01) — sem SW registrado, `ready` nunca
 * resolve. Fora do dev (build/preview/produção) o SW resolve quase
 * instantaneamente; o timeout só evita um skeleton infinito em dev.
 */
const SERVICE_WORKER_READY_TIMEOUT_MS = 4_000;

async function waitForServiceWorkerReady(): Promise<ServiceWorkerRegistration | null> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), SERVICE_WORKER_READY_TIMEOUT_MS);
    }),
  ]);
}

async function getBrowserSubscriptionState(): Promise<BrowserSubscriptionState> {
  if (!isPushSupported()) return { subscribed: false };

  const registration = await waitForServiceWorkerReady();
  if (!registration) return { subscribed: false };

  const subscription = await registration.pushManager.getSubscription();
  return { subscribed: subscription !== null };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UsePushSubscriptionResult {
  /** Browser suporta Web Push (serviceWorker + PushManager + Notification). */
  readonly supported: boolean;
  /** `Notification.permission` atual — `null` quando não suportado. */
  readonly permission: NotificationPermission | null;
  /** Já existe subscription ativa neste browser+device. */
  readonly subscribed: boolean;
  /** Carregando o estado inicial da subscription no browser. */
  readonly isLoading: boolean;
  readonly isSubscribing: boolean;
  readonly isUnsubscribing: boolean;
  /** Mensagem de erro amigável do último subscribe/unsubscribe (se houver). */
  readonly error: string | null;
  /** Pede permissão (gesto do usuário) e assina o push. */
  readonly subscribe: () => void;
  /** Remove a subscription (backend + browser). */
  readonly unsubscribe: () => void;
}

export function usePushSubscription(): UsePushSubscriptionResult {
  const qc = useQueryClient();
  const supported = isPushSupported();

  const [permission, setPermission] = React.useState<NotificationPermission | null>(
    supported ? Notification.permission : null,
  );
  const [error, setError] = React.useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: pushSubscriptionQueryKey,
    queryFn: getBrowserSubscriptionState,
    enabled: supported,
    staleTime: 30_000,
  });

  const subscribeMutation = useMutation({
    mutationFn: async (): Promise<void> => {
      // 1. Permissão — chamado SÓ dentro do onClick do botão (gesto do usuário).
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== 'granted') {
        throw new Error('Permissão de notificação negada pelo navegador.');
      }

      // 2. Chave pública VAPID (pode estar indisponível — flag/env desligados).
      const { public_key: publicKey } = await fetchPushPublicKey();
      if (!publicKey) {
        throw new Error('Notificações push não estão disponíveis no momento.');
      }

      // 3. Assina no browser.
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const json = subscription.toJSON();
      const p256dh = json.keys?.['p256dh'];
      const auth = json.keys?.['auth'];
      if (!p256dh || !auth) {
        throw new Error('O navegador não retornou as chaves da subscription.');
      }

      // 4. Registra no backend (upsert por endpoint — idempotente).
      await registerPushSubscription({
        endpoint: subscription.endpoint,
        keys: { p256dh, auth },
        userAgent: navigator.userAgent.slice(0, 500),
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: pushSubscriptionQueryKey });
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Não foi possível ativar as notificações.');
    },
  });

  const unsubscribeMutation = useMutation({
    mutationFn: async (): Promise<void> => {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) return;

      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();
      await removePushSubscription(endpoint);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: pushSubscriptionQueryKey });
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Não foi possível desativar as notificações.');
    },
  });

  return {
    supported,
    permission,
    subscribed: data?.subscribed ?? false,
    isLoading: supported && isLoading,
    isSubscribing: subscribeMutation.isPending,
    isUnsubscribing: unsubscribeMutation.isPending,
    error,
    subscribe: () => {
      setError(null);
      subscribeMutation.mutate();
    },
    unsubscribe: () => {
      setError(null);
      unsubscribeMutation.mutate();
    },
  };
}
