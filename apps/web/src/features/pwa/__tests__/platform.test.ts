// =============================================================================
// features/pwa/__tests__/platform.test.ts — F27-S07
//
// detectPushUnsupportedReason: quirks de plataforma (doc 24 §11) — iOS exige
// app instalado (standalone) para expor Web Push; outros navegadores sem
// suporte caem no fallback genérico.
// =============================================================================

import { describe, expect, it } from 'vitest';

import { detectPushUnsupportedReason, isPushSupported, isStandaloneDisplayMode } from '../platform';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Mobile/15E148 Safari/604.1';
const IPAD_UA =
  'Mozilla/5.0 (iPad; CPU OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Mobile/15E148 Safari/604.1';
const ANDROID_CHROME_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const DESKTOP_FIREFOX_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0';

describe('detectPushUnsupportedReason', () => {
  it('suportado -> null (nada a explicar)', () => {
    expect(
      detectPushUnsupportedReason({
        supported: true,
        userAgent: ANDROID_CHROME_UA,
        standalone: false,
      }),
    ).toBeNull();
  });

  it('iPhone fora do modo standalone -> ios-not-installed', () => {
    expect(
      detectPushUnsupportedReason({ supported: false, userAgent: IPHONE_UA, standalone: false }),
    ).toBe('ios-not-installed');
  });

  it('iPad fora do modo standalone -> ios-not-installed', () => {
    expect(
      detectPushUnsupportedReason({ supported: false, userAgent: IPAD_UA, standalone: false }),
    ).toBe('ios-not-installed');
  });

  it('iPhone JÁ standalone mas ainda sem suporte (ex: iOS < 16.4) -> unsupported-browser', () => {
    // standalone=true significa "instalado", mas se `supported` ainda é falso
    // (versão de iOS antiga sem Web Push), a causa não é mais "não instalado".
    expect(
      detectPushUnsupportedReason({ supported: false, userAgent: IPHONE_UA, standalone: true }),
    ).toBe('unsupported-browser');
  });

  it('Firefox desktop sem suporte -> unsupported-browser', () => {
    expect(
      detectPushUnsupportedReason({
        supported: false,
        userAgent: DESKTOP_FIREFOX_UA,
        standalone: false,
      }),
    ).toBe('unsupported-browser');
  });

  it('Android Chrome sem suporte (caso raro) -> unsupported-browser (não é iOS)', () => {
    expect(
      detectPushUnsupportedReason({
        supported: false,
        userAgent: ANDROID_CHROME_UA,
        standalone: false,
      }),
    ).toBe('unsupported-browser');
  });
});

// ---------------------------------------------------------------------------
// isPushSupported / isStandaloneDisplayMode — ambiente sem DOM (vitest node)
// ---------------------------------------------------------------------------
//
// O ambiente de teste (vitest, environment default 'node') não expõe
// `navigator`/`window` — exercita exatamente o caminho de degradação
// "sem suporte" que os guards `typeof` devem cobrir sem lançar.

describe('isPushSupported (sem navigator/window no ambiente de teste)', () => {
  it('retorna false sem lançar', () => {
    expect(() => isPushSupported()).not.toThrow();
    expect(isPushSupported()).toBe(false);
  });
});

describe('isStandaloneDisplayMode (sem window no ambiente de teste)', () => {
  it('retorna false sem lançar', () => {
    expect(() => isStandaloneDisplayMode()).not.toThrow();
    expect(isStandaloneDisplayMode()).toBe(false);
  });
});
