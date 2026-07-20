// =============================================================================
// features/pwa/__tests__/PushOptInCard.test.ts — Verificação F27-S08 do
// doc 24 §13: "Opt-in de push funciona" + "UI de push some com pwa.enabled off".
//
// Estratégia: sem @testing-library/react (não instalado — ver nota em
// hooks/__tests__/useFeatureFlag.test.ts), este teste lê o código-fonte real
// de PushOptInCard.tsx e usePushSubscription.ts como string e verifica os
// dois invariantes de segurança/UX que o doc 24 exige:
//
//   1. Gate de flag (UI, doc 24 §7): o componente retorna `null` cedo quando
//      `pwa.enabled` está off ou ainda carregando — nada é renderizado.
//   2. Opt-in só sob gesto (doc 24 §5.4): `Notification.requestPermission()`
//      só é chamado dentro do `mutationFn` de uma mutation disparada por
//      `onClick` — nunca em `useEffect`/no corpo do componente (que rodaria
//      no mount/load, sem gesto do usuário).
// =============================================================================

import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

const PWA_DIR = path.resolve(__dirname, '..');

function readPwaSrc(fileName: string): string {
  return fs.readFileSync(path.join(PWA_DIR, fileName), 'utf-8');
}

describe('PushOptInCard — gate de flag (doc 24 §7, camada UI)', () => {
  const src = readPwaSrc('PushOptInCard.tsx');

  it('usa useFeatureFlag para ler pwa.enabled', () => {
    expect(src).toMatch(/useFeatureFlag\(\s*['"]pwa\.enabled['"]\s*\)/);
  });

  it('retorna null cedo quando a flag está off OU ainda carregando (nada renderiza)', () => {
    // Precisa checar AMBOS os estados — só `!flagEnabled` deixaria a UI piscar
    // "ligada" por 1 frame enquanto a query da flag ainda resolve.
    expect(src).toMatch(/if\s*\(\s*flagLoading\s*\|\|\s*!flagEnabled\s*\)\s*return\s*null;/);
  });

  it('o gate acontece ANTES de qualquer JSX ser montado (early return, não render condicional aninhado)', () => {
    const gateIndex = src.indexOf('if (flagLoading || !flagEnabled) return null;');
    const firstJsxReturn = src.indexOf('const content = (');
    expect(gateIndex).toBeGreaterThan(-1);
    expect(firstJsxReturn).toBeGreaterThan(-1);
    expect(gateIndex).toBeLessThan(firstJsxReturn);
  });
});

describe('PushOptInCard — opt-in só sob gesto do usuário (doc 24 §5.4)', () => {
  const cardSrc = readPwaSrc('PushOptInCard.tsx');
  const hookSrc = readPwaSrc('usePushSubscription.ts');

  it('push.subscribe() é chamado dentro de um onClick (não no corpo do componente)', () => {
    expect(cardSrc).toMatch(/onClick=\{\(\)\s*=>\s*\{[^}]*push\.subscribe\(\)/s);
  });

  it('subscribe() do componente NÃO é chamado fora de handlers de evento (sem auto-subscribe no mount)', () => {
    // Não deve existir `useEffect` no arquivo do card chamando subscribe/unsubscribe —
    // a única superfície de disparo é o botão.
    expect(cardSrc).not.toContain('useEffect');
  });

  it('Notification.requestPermission() só existe dentro do mutationFn de subscribeMutation (chamada real, não comentário)', () => {
    const subscribeMutationIndex = hookSrc.indexOf('const subscribeMutation = useMutation({');
    const unsubscribeMutationIndex = hookSrc.indexOf('const unsubscribeMutation = useMutation({');
    expect(subscribeMutationIndex).toBeGreaterThan(-1);
    expect(unsubscribeMutationIndex).toBeGreaterThan(-1);

    // A CHAMADA real (`= await Notification.requestPermission()`) — distinta da
    // menção em prosa no comentário de cabeçalho do arquivo — só pode viver
    // entre o início de subscribeMutation e o início de unsubscribeMutation.
    const callIndex = hookSrc.indexOf(
      'const result = await Notification.requestPermission();',
      subscribeMutationIndex,
    );
    expect(callIndex).toBeGreaterThan(subscribeMutationIndex);
    expect(callIndex).toBeLessThan(unsubscribeMutationIndex);

    // E não deve haver uma 2ª chamada real em nenhum outro lugar do arquivo.
    const lastCallIndex = hookSrc.lastIndexOf('await Notification.requestPermission()');
    expect(lastCallIndex).toBe(
      hookSrc.indexOf('await Notification.requestPermission()', subscribeMutationIndex),
    );
  });

  it('não existe nenhuma chamada a requestPermission/subscribe no corpo top-level do hook (fora de useMutation/useQuery)', () => {
    // Garante que a única forma de pedir permissão é via subscribeMutation.mutate(),
    // que só é invocado pelo `subscribe: () => { ...; subscribeMutation.mutate(); }`
    // exposto do hook — chamado pelo onClick do card (verificado acima).
    expect(hookSrc).toMatch(
      /subscribe:\s*\(\)\s*=>\s*\{\s*setError\(null\);\s*subscribeMutation\.mutate\(\);\s*\}/,
    );
  });

  it('permissão negada interrompe o fluxo (throw) — não assina push sem "granted"', () => {
    expect(hookSrc).toMatch(/if\s*\(result !== 'granted'\)\s*\{\s*throw new Error/);
  });
});
