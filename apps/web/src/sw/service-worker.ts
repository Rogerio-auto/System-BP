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

// Fonte única de verdade `entity_type` -> rota interna, compartilhada com o sino.
// Módulo puro dedicado (sem zod/catálogo/DOM) — importável no SW sem inchar o
// bundle. `features/notifications/navigation.ts` re-exporta o mesmo símbolo.
import { resolveNotificationHref } from '../features/notifications/deep-link';

declare const self: ServiceWorkerGlobalScope;

// ─── Precache do app-shell ──────────────────────────────────────────────────
// `self.__WB_MANIFEST` é substituído em build time pelo plugin com a lista de
// assets do build (injectManifest). Nada de API entra aqui — só os arquivos
// do bundle do `app.*`.
precacheAndRoute(self.__WB_MANIFEST);

// Remove caches de precache de builds antigos assim que o novo SW assume.
cleanupOutdatedCaches();

// ─── Navigation (SPA) — network-first, precache só como fallback offline ─────
//
// Toda navegação tenta a REDE primeiro e só cai no `index.html` precacheado
// quando a rede falha/expira. O roteamento real continua client-side (React
// Router em `App.tsx`), e o app segue abrível offline.
//
// Por que NÃO é cache-first (bug de produção 2026-07-24): com
// `registerType:'prompt'` o SW antigo permanece no controle até o operador
// confirmar a atualização. Servindo o shell do cache, o app carregava um
// `index.html` de um build anterior, que referencia hashes de assets
// (`/assets/index-<hash>.js`) que não existem mais no servidor depois de um
// deploy — o app nunca inicializava ("carregando infinitamente"), inclusive na
// tela de login. Network-first garante shell sempre coerente com o servidor
// quando há rede, sem abrir mão do offline.
const precachedShellHandler = createHandlerBoundToURL('index.html');

/** Teto para a tentativa de rede antes de cair no shell offline. */
const NAVIGATION_NETWORK_TIMEOUT_MS = 4_000;

registerRoute(
  new NavigationRoute(async (params) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NAVIGATION_NETWORK_TIMEOUT_MS);
    try {
      const fresh = await fetch(params.request, { signal: controller.signal });
      if (fresh.ok) return fresh;
      throw new Error(`shell indisponível (status ${fresh.status})`);
    } catch {
      // Sem rede (ou shell indisponível) — serve o app-shell precacheado.
      return precachedShellHandler(params);
    } finally {
      clearTimeout(timer);
    }
  }),
);

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
// `{ title, severity, entity_type, entity_id }` (LGPD-mínimo, doc 24 §5.3).
// NÃO vem `href` pronto — resolvemos a rota interna aqui a partir de
// `entity_type`/`entity_id` (IDs opacos, não-PII) via `resolveNotificationHref`.
// Sem `body`, sem PII — push trafega por infra de terceiros (FCM/Apple/Mozilla)
// e é tratado como canal não-confiável.

interface PushNotificationPayload {
  title: string;
  /** Rota interna JÁ resolvida (nunca URL absoluta / cross-origin). */
  href: string;
}

/** Ícones do app-shell (F27-S02) — mesmos assets do manifest.webmanifest. */
const PUSH_ICON = '/pwa-192x192.png';
const PUSH_BADGE = '/pwa-192x192.png';
const DEFAULT_PUSH_TITLE = 'Nova notificação';
const DEFAULT_PUSH_HREF = '/';

/**
 * Lê o payload JSON do evento `push` e resolve o deep-link a partir de
 * `entity_type`/`entity_id` (mesmo mapa do sino). Tolerante a payload
 * ausente/malformado — nunca deixa de notificar; cai no título/rota padrão.
 */
function parsePushPayload(event: PushEvent): PushNotificationPayload {
  try {
    const raw = event.data?.json() as
      | { title?: unknown; entity_type?: unknown; entity_id?: unknown }
      | undefined;
    const title =
      typeof raw?.title === 'string' && raw.title.trim().length > 0
        ? raw.title
        : DEFAULT_PUSH_TITLE;
    const entityType = typeof raw?.entity_type === 'string' ? raw.entity_type : null;
    const entityId = typeof raw?.entity_id === 'string' ? raw.entity_id : null;
    return { title, href: resolveNotificationHref(entityType, entityId) ?? DEFAULT_PUSH_HREF };
  } catch {
    return { title: DEFAULT_PUSH_TITLE, href: DEFAULT_PUSH_HREF };
  }
}

self.addEventListener('push', (event: PushEvent) => {
  const { title, href } = parsePushPayload(event);

  event.waitUntil(
    self.registration.showNotification(title, {
      icon: PUSH_ICON,
      badge: PUSH_BADGE,
      data: { href },
    }),
  );
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();

  const data = event.notification.data as { href?: string } | undefined;
  // Defesa em profundidade (canal não-confiável, doc 24 §5.3): só navegar para
  // o MESMO origin. O href já deveria ser uma rota interna resolvida por nós,
  // mas um href absoluto/cross-origin cai no default em vez de abrir externo.
  const targetUrl = ((): string => {
    const fallback = new URL(DEFAULT_PUSH_HREF, self.location.origin).href;
    try {
      const url = new URL(data?.href ?? DEFAULT_PUSH_HREF, self.location.origin);
      return url.origin === self.location.origin ? url.href : fallback;
    } catch {
      return fallback;
    }
  })();

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
