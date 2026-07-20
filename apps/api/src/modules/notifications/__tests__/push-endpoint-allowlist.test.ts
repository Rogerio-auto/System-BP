// =============================================================================
// notifications/__tests__/push-endpoint-allowlist.test.ts — Verificação F27-S08
// da allowlist anti-SSRF (`isAllowedPushEndpoint`, @elemento/shared-schemas).
//
// Esta função é o único portão entre "endpoint escolhido pelo cliente" e
// "URL para a qual o backend faz POST via `web-push`" (doc 24 §10). Aplicada
// na borda HTTP (Zod refine, push-routes.test.ts) E de novo no sender
// (defesa em profundidade, webPush.sender.test.ts) — este arquivo cobre a
// função pura isoladamente, com os vetores de ataque clássicos de allowlist
// por host: scheme errado, host arbitrário, IP de metadata de nuvem,
// subdomain/suffix confusion (host.evil.com vs evil.com/host), userinfo
// confusion (host@evil.com), porta não-padrão, maiúsculas/minúsculas.
// =============================================================================

import { isAllowedPushEndpoint } from '@elemento/shared-schemas';
import { describe, expect, it } from 'vitest';


describe('isAllowedPushEndpoint — hosts reconhecidos (allowlist positiva)', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc123',
    'https://android.googleapis.com/gcm/send/abc123',
    'https://updates.push.services.mozilla.com/wpush/v2/abc123',
    'https://web.push.apple.com/QMV...',
  ])('%s -> true', (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  });

  it.each([
    'https://sub.notify.windows.com/w/abc123', // sufixo WNS
    'https://client.push.apple.com/abc123', // sufixo Apple alternativo
  ])('%s (sufixo permitido) -> true', (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  });

  it('é case-insensitive no host (URL normaliza hostname para lowercase)', () => {
    expect(isAllowedPushEndpoint('https://FCM.GOOGLEAPIS.COM/fcm/send/abc')).toBe(true);
  });
});

describe('isAllowedPushEndpoint — rejeita fora da allowlist (defesa anti-SSRF)', () => {
  it('rejeita scheme http (não-HTTPS) mesmo em host válido', () => {
    expect(isAllowedPushEndpoint('http://fcm.googleapis.com/fcm/send/abc')).toBe(false);
  });

  it('rejeita host arbitrário (não é push service)', () => {
    expect(isAllowedPushEndpoint('https://evil.example.com/hook')).toBe(false);
  });

  it('rejeita IP literal de metadata de nuvem (SSRF clássico)', () => {
    expect(isAllowedPushEndpoint('https://169.254.169.254/latest/meta-data/')).toBe(false);
  });

  it('rejeita localhost/loopback', () => {
    expect(isAllowedPushEndpoint('https://localhost/internal')).toBe(false);
    expect(isAllowedPushEndpoint('https://127.0.0.1/internal')).toBe(false);
  });

  it('rejeita subdomain confusion: host legítimo como SUBDOMÍNIO do atacante', () => {
    // "fcm.googleapis.com.evil.com" tem host real = evil.com com label
    // "fcm.googleapis.com" — não deve colar com a allowlist de host exato/sufixo.
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com.evil.com/fcm/send/x')).toBe(false);
  });

  it('rejeita suffix confusion: host que TERMINA com o allowlist host sem separador de domínio', () => {
    // "evilfcm.googleapis.com" não é "fcm.googleapis.com" nem um subdomínio dele.
    expect(isAllowedPushEndpoint('https://evilfcm.googleapis.com/fcm/send/x')).toBe(false);
  });

  it('rejeita userinfo confusion: host real após @ não é considerado', () => {
    // URL com userinfo "fcm.googleapis.com@evil.com" — o hostname real é evil.com.
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com@evil.com/fcm/send/x')).toBe(false);
  });

  it('rejeita path confusion: host real não é enganado por path parecendo domínio', () => {
    expect(isAllowedPushEndpoint('https://evil.com/fcm.googleapis.com/send/x')).toBe(false);
  });

  it('rejeita string que não é uma URL válida', () => {
    expect(isAllowedPushEndpoint('not-a-url')).toBe(false);
    expect(isAllowedPushEndpoint('')).toBe(false);
  });

  it('rejeita scheme não-http (ex.: file://, javascript:)', () => {
    expect(isAllowedPushEndpoint('file:///etc/passwd')).toBe(false);
    expect(isAllowedPushEndpoint('javascript:alert(1)')).toBe(false);
  });

  it('porta não-padrão em host válido ainda é aceita (porta não faz parte do host-match)', () => {
    // Documenta o comportamento atual: a função checa apenas protocol+hostname,
    // não a porta. fcm.googleapis.com:8443 tem hostname === fcm.googleapis.com.
    // Não é uma falha de SSRF (o host ainda é o serviço real), mas fica
    // registrado aqui para não ser uma surpresa numa auditoria futura.
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com:8443/fcm/send/abc')).toBe(true);
  });
});
