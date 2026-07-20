// =============================================================================
// features/pwa/vapid.ts — Conversão da chave pública VAPID (base64url).
//
// `PushManager.subscribe({ applicationServerKey })` exige um `Uint8Array` (ou
// `ArrayBuffer`) — não aceita a string base64url que `GET /push/public-key`
// devolve (doc 24 §5.4). Conversão padrão RFC 8291.
//
// Pura — sem I/O, sem `navigator`/`window` — testável isoladamente.
// `atob` é global tanto no browser quanto no Node 20 (stack do projeto).
// =============================================================================

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}
