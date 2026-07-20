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
// Handlers de `push` / `notificationclick` chegam no F27-S07 — este arquivo
// já está pronto para recebê-los (listener de mensagens abaixo é o único
// listener de app-level presente por enquanto).
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
