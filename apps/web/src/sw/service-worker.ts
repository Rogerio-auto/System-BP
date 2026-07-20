// =============================================================================
// sw/service-worker.ts — Service worker fonte (F27-S01)
//
// Compilado pelo `vite-plugin-pwa` em modo `injectManifest` (NÃO `generateSW`):
// escrevemos o SW à mão porque o F27-S07 precisa adicionar handlers custom de
// `push`/`notificationclick` neste MESMO arquivo — o modo automático do
// Workbox não permite handlers custom.
//
// Escopo desta fundação (doc 24 §3.4):
// - Precache do app-shell (JS/CSS/HTML do build) via Workbox.
// - Navigation fallback para `index.html` — é um SPA, roteamento client-side.
// - NUNCA cachear `api.*` — é outra origem, network-only. Zero PII em
//   repouso no dispositivo (doc 17 / doc 24 §2 e §9). Não adicionar nenhum
//   `registerRoute` que intercepte requests para o domínio da API.
// - `registerType: 'prompt'`: só troca de SW quando o operador confirma via
//   `src/pwa/UpdatePrompt.tsx`, que envia a mensagem `SKIP_WAITING` abaixo.
//
// Handlers de `push` / `notificationclick` (F27-S07, doc 24 §5.4):
// - `push`: o payload publicado pelo sender `webPush` (F27-S06) é LGPD-mínimo
//   (doc 24 §5.3) — só `title` genérico + `href` para deep-link. NUNCA espera
//   nem lê `body`/PII do payload; o conteúdo real é buscado após o operador
//   abrir o app autenticado.
// - `notificationclick`: foca uma aba já aberta (navegando-a pro deep-link)
//   ou abre uma nova via `clients.openWindow`.
// =============================================================================

/// <reference lib="webworker" />

import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope;

// ─── Precache do app-shell ──────────────────────────────────────────────────
// `self.__WB_MANIFEST` é substituído em build time pelo plugin com a lista de
// assets do build (injectManifest). Nada de API entra aqui — só os arquivos
// do bundle do `app.*`.
precacheAndRoute(self.__WB_MANIFEST);

// Remove caches de precache de builds antigos assim que o novo SW assume.
cleanupOutdatedCaches();

// ─── Navigation fallback (SPA) ───────────────────────────────────────────────
// Toda navegação (troca de rota, refresh, cold start com shell em cache) cai
// no `index.html` precacheado — o roteamento real é feito client-side pelo
// React Router em `App.tsx`. Isso é o que torna o app abrível offline.
const navigationHandler = createHandlerBoundToURL('index.html');
registerRoute(new NavigationRoute(navigationHandler));

// ─── Ciclo de vida ───────────────────────────────────────────────────────────
// `registerType: 'prompt'` (src/pwa/register.ts): o novo SW fica em `waiting`
// até o operador confirmar a atualização. `UpdatePrompt.tsx` dispara essa
// mensagem ao clicar em "Atualizar" — só então o novo SW assume o controle.
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});

self.addEventListener('activate', () => {
  void self.clients.claim();
});

// ─── Web Push (F27-S07, doc 24 §5.4) ────────────────────────────────────────
//
// Payload publicado pelo sender `webPush` (apps/api .../senders/webPush.ts):
// `{ title: string, href?: string }`. Sem `body`, sem PII — doc 24 §5.3 é
// inviolável: push trafega por infra de terceiros (FCM/Apple/Mozilla) e é
// tratado como canal não-confiável.

interface PushNotificationPayload {
  title: string;
  href?: string;
}

/** Ícones do app-shell (F27-S02) — mesmos assets do manifest.webmanifest. */
const PUSH_ICON = '/pwa-192x192.png';
const PUSH_BADGE = '/pwa-192x192.png';
const DEFAULT_PUSH_TITLE = 'Nova notificação';
const DEFAULT_PUSH_HREF = '/';

/**
 * Lê o payload JSON do evento `push`. Tolerante a payload ausente/malformado
 * (nunca deixa de notificar por causa de um payload inesperado) — cai no
 * título genérico padrão.
 */
function parsePushPayload(event: PushEvent): PushNotificationPayload {
  try {
    const raw = event.data?.json() as Partial<PushNotificationPayload> | undefined;
    const title =
      typeof raw?.title === 'string' && raw.title.trim().length > 0
        ? raw.title
        : DEFAULT_PUSH_TITLE;
    const href = typeof raw?.href === 'string' && raw.href.length > 0 ? raw.href : undefined;
    return href === undefined ? { title } : { title, href };
  } catch {
    return { title: DEFAULT_PUSH_TITLE };
  }
}

self.addEventListener('push', (event: PushEvent) => {
  const { title, href } = parsePushPayload(event);

  event.waitUntil(
    self.registration.showNotification(title, {
      icon: PUSH_ICON,
      badge: PUSH_BADGE,
      data: { href: href ?? DEFAULT_PUSH_HREF },
    }),
  );
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();

  const data = event.notification.data as { href?: string } | undefined;
  const href = data?.href ?? DEFAULT_PUSH_HREF;
  const targetUrl = new URL(href, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const windowClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      // Foca a primeira aba já aberta do app — navega pro deep-link quando o
      // browser suporta `WindowClient.navigate` (Chrome/Edge/Firefox).
      const existing = windowClients[0];
      if (existing) {
        if ('navigate' in existing) {
          try {
            await existing.navigate(targetUrl);
          } catch {
            // Navegação cross-origin ou não suportada — ainda assim foca a aba.
          }
        }
        await existing.focus();
        return;
      }

      // Nenhuma janela aberta — abre uma nova diretamente no deep-link.
      await self.clients.openWindow(targetUrl);
    })(),
  );
});
