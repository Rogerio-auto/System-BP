// =============================================================================
// features/pwa/platform.ts — Quirks de plataforma para o opt-in de push
// (doc 24 §11).
//
// `detectPushUnsupportedReason` recebe input explícito (sem tocar em
// `navigator`/`window` diretamente) para ser testável isolada; os helpers que
// leem o browser (`isStandaloneDisplayMode`) ficam separados.
// =============================================================================

export type PushUnsupportedReason = 'ios-not-installed' | 'unsupported-browser';

export interface PushSupportInput {
  /** Resultado de `isPushSupported()` — serviceWorker + PushManager + Notification. */
  supported: boolean;
  userAgent: string;
  /** App rodando em modo standalone (instalado na tela de início). */
  standalone: boolean;
}

/**
 * Decide a razão de indisponibilidade do push para orientar a mensagem certa:
 *   - iOS/iPadOS fora do modo standalone: Safari só expõe Web Push a apps
 *     instalados na tela de início (doc 24 §11) — orientar a instalar.
 *   - Qualquer outro navegador sem suporte a Push API/Notification.
 * Retorna `null` quando o push é suportado (nada a explicar).
 */
export function detectPushUnsupportedReason(input: PushSupportInput): PushUnsupportedReason | null {
  if (input.supported) return null;
  const isIOS = /iphone|ipad|ipod/i.test(input.userAgent);
  return isIOS && !input.standalone ? 'ios-not-installed' : 'unsupported-browser';
}

/** `true` quando o app roda instalado (standalone) — iOS e navegadores padrão. */
export function isStandaloneDisplayMode(): boolean {
  if (typeof window === 'undefined') return false;
  const iosStandalone =
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  const mediaStandalone =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches;
  return iosStandalone || mediaStandalone;
}

/** `true` quando o browser expõe as APIs necessárias ao Web Push. */
export function isPushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window
  );
}
