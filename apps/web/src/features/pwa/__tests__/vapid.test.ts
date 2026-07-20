// =============================================================================
// features/pwa/__tests__/vapid.test.ts — F27-S07
//
// urlBase64ToUint8Array: conversão da chave pública VAPID (base64url) exigida
// por `PushManager.subscribe({ applicationServerKey })` (doc 24 §5.4).
// =============================================================================

import { describe, expect, it } from 'vitest';

import { urlBase64ToUint8Array } from '../vapid';

describe('urlBase64ToUint8Array', () => {
  it('decodifica uma string base64 padrão (sem chars url-safe) corretamente', () => {
    // 'SGVsbG8h' é o base64 padrão de "Hello!" — fixture sem -/_' para isolar
    // a decodificação base do tratamento de caracteres url-safe (próximo teste).
    const result = urlBase64ToUint8Array('SGVsbG8h');
    const decoded = String.fromCharCode(...result);
    expect(decoded).toBe('Hello!');
  });

  it('lida com caracteres url-safe (- e _) e padding ausente', () => {
    // bytes [0xfb, 0xff] -> base64 padrão "+/8=" -> url-safe "-_8" (sem "=")
    const result = urlBase64ToUint8Array('-_8');
    expect(Array.from(result)).toEqual([0xfb, 0xff]);
  });

  it('produz um Uint8Array não vazio para uma chave VAPID de exemplo', () => {
    const fakeVapidKey = 'BExamplePublicVapidKeyBase64UrlSafe00000000000000000000000';
    const result = urlBase64ToUint8Array(fakeVapidKey);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(0);
  });

  it('é determinístico — mesma entrada produz a mesma saída', () => {
    const a = urlBase64ToUint8Array('SGVsbG8h');
    const b = urlBase64ToUint8Array('SGVsbG8h');
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});
