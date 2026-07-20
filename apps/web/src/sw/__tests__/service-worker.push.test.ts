// =============================================================================
// sw/__tests__/service-worker.push.test.ts — Verificação F27-S08 (doc 24
// §5.4/§13) dos handlers `push`/`notificationclick` do service worker.
//
// `sw/service-worker.ts` roda no escopo `ServiceWorkerGlobalScope` (sem
// `window`/DOM) e é compilado pelo `vite-plugin-pwa` (injectManifest) — não é
// importável diretamente em vitest (ambiente `node`, sem `self.__WB_MANIFEST`
// nem workbox). Por isso este teste NÃO importa o módulo: segue o mesmo
// padrão estrutural de `__tests__/App.routing.test.tsx` (lê o arquivo como
// string) para travar os 2 invariantes de segurança/LGPD do doc 24 §5.4 como
// regressão — qualquer edição que remova o guard falha aqui.
//
//   1. Resolução de deep-link: `parsePushPayload` usa `resolveNotificationHref`
//      (a MESMA fonte única do sino, `features/notifications/deep-link.ts`)
//      a partir de `entity_type`/`entity_id` — não confia em um `href` vindo
//      pronto no payload do push (canal não-confiável, doc 24 §5.3). A função
//      `resolveNotificationHref` em si já tem cobertura completa de mapeamento
//      em `features/notifications/__tests__/navigation.test.ts`.
//   2. Guard same-origin no `notificationclick` (fix histórico do F27-S07):
//      antes de navegar/abrir janela, o handler SÓ aceita `url.origin ===
//      self.location.origin` — qualquer href absoluto/cross-origin (payload
//      de push adulterado, canal de terceiro) cai no fallback interno
//      (`DEFAULT_PUSH_HREF`), nunca abre uma URL externa.
// =============================================================================

import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

const SW_SRC = fs.readFileSync(path.resolve(__dirname, '../service-worker.ts'), 'utf-8');

describe('service-worker.ts — push: deep-link resolvido via fonte única (doc 24 §5.4)', () => {
  it('importa resolveNotificationHref de features/notifications/deep-link (não duplica o mapa)', () => {
    expect(SW_SRC).toMatch(
      /import\s*\{\s*resolveNotificationHref\s*\}\s*from\s*['"]\.\.\/features\/notifications\/deep-link['"]/,
    );
  });

  it('parsePushPayload lê entity_type/entity_id do payload (não um href pronto de terceiro)', () => {
    expect(SW_SRC).toContain("typeof raw?.entity_type === 'string'");
    expect(SW_SRC).toContain("typeof raw?.entity_id === 'string'");
    expect(SW_SRC).toContain('resolveNotificationHref(entityType, entityId)');
  });

  it('payload malformado/ausente cai no título e rota padrão (nunca falha silenciosamente sem notificar)', () => {
    expect(SW_SRC).toContain('DEFAULT_PUSH_TITLE');
    expect(SW_SRC).toContain('DEFAULT_PUSH_HREF');
    expect(SW_SRC).toMatch(/catch\s*\{\s*return\s*\{\s*title:\s*DEFAULT_PUSH_TITLE/);
  });

  it('showNotification NUNCA recebe `body` no payload exibido (LGPD §5.3 — só title)', () => {
    const showNotificationCall = SW_SRC.slice(
      SW_SRC.indexOf('self.registration.showNotification'),
      SW_SRC.indexOf('self.registration.showNotification') + 300,
    );
    expect(showNotificationCall).not.toContain('body:');
  });
});

describe('service-worker.ts — notificationclick: guard same-origin (fix F27-S07)', () => {
  it('resolve a URL alvo com `new URL(href, self.location.origin)` (nunca navega direto pro href cru)', () => {
    expect(SW_SRC).toContain('new URL(data?.href ?? DEFAULT_PUSH_HREF, self.location.origin)');
  });

  it('só usa a URL resolvida quando o origin bate com self.location.origin — senão cai no fallback', () => {
    expect(SW_SRC).toMatch(
      /return url\.origin === self\.location\.origin \? url\.href : fallback;/,
    );
  });

  it('o fallback também é ancorado em self.location.origin (nunca undefined/relative solto)', () => {
    expect(SW_SRC).toContain('new URL(DEFAULT_PUSH_HREF, self.location.origin).href');
  });

  it('uma URL malformada (parse lança) cai no fallback via catch — nunca propaga nem abre algo não validado', () => {
    const notificationClickHandler = SW_SRC.slice(
      SW_SRC.indexOf("self.addEventListener('notificationclick'"),
    );
    expect(notificationClickHandler).toMatch(/catch\s*\{\s*return fallback;\s*\}/);
  });

  it('abre/navega SOMENTE via targetUrl (a variável validada) — nunca via data.href bruto', () => {
    const notificationClickHandler = SW_SRC.slice(
      SW_SRC.indexOf("self.addEventListener('notificationclick'"),
    );
    // `existing.navigate` e `clients.openWindow` só devem referenciar `targetUrl`.
    expect(notificationClickHandler).toContain('existing.navigate(targetUrl)');
    expect(notificationClickHandler).toContain('self.clients.openWindow(targetUrl)');
    expect(notificationClickHandler).not.toContain('navigate(data');
    expect(notificationClickHandler).not.toContain('openWindow(data');
  });
});
