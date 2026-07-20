// =============================================================================
// pwa/register.ts — Registro do service worker + fluxo de atualização (F27-S01)
//
// `registerType: 'prompt'` (vite.config.ts): a troca de SW nunca é silenciosa
// (doc 24 §3.4). Quando o Workbox detecta um build novo, `onNeedRefresh` é
// chamado; expomos esse estado via um pub/sub mínimo para o `UpdatePrompt`
// (toast) consumir sem precisar de um store global novo — o operador decide
// quando atualizar clicando no toast, que chama `applyServiceWorkerUpdate`.
// =============================================================================

/// <reference types="vite-plugin-pwa/client" />

import { registerSW } from 'virtual:pwa-register';

type UpdateListener = (needsUpdate: boolean) => void;

let needsUpdate = false;
let updateServiceWorker: ((reloadPage?: boolean) => Promise<void>) | null = null;
const listeners = new Set<UpdateListener>();

function notifyListeners(): void {
  for (const listener of listeners) listener(needsUpdate);
}

/**
 * Registra o service worker do app-shell. Chamar uma única vez, em `main.tsx`.
 * Seguro em ambientes sem suporte a SW (navegadores antigos) — `registerSW`
 * do vite-plugin-pwa é um no-op nesse caso.
 */
export function registerServiceWorker(): void {
  updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh() {
      needsUpdate = true;
      notifyListeners();
    },
    onOfflineReady() {
      // App-shell pronto para uso offline. Sem toast — silencioso por design
      // (doc 24 §3.5: a página offline cobre o caso de falta de rede, não a
      // confirmação de que o cache existe).
    },
    onRegisterError(error: unknown) {
      console.error('[pwa] Falha ao registrar o service worker', error);
    },
  });
}

/**
 * Aplica a atualização pendente: sinaliza `SKIP_WAITING` ao SW em espera e
 * recarrega a página assim que ele assume o controle. Chamado pela ação do
 * operador no `UpdatePrompt` — nunca automaticamente.
 */
export function applyServiceWorkerUpdate(): void {
  if (!updateServiceWorker) return;
  needsUpdate = false;
  notifyListeners();
  void updateServiceWorker(true);
}

/**
 * Assina mudanças de disponibilidade de atualização. Retorna a função de
 * unsubscribe. Notifica o estado atual imediatamente na assinatura.
 */
export function subscribeToServiceWorkerUpdate(listener: UpdateListener): () => void {
  listeners.add(listener);
  listener(needsUpdate);
  return () => {
    listeners.delete(listener);
  };
}
