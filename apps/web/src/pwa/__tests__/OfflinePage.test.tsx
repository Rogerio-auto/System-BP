// =============================================================================
// pwa/__tests__/OfflinePage.test.tsx — Teste estrutural sem JSDOM.
//
// O ambiente de teste não tem JSDOM configurado (mesma estratégia usada em
// outros componentes do app — ver EndpointCard.test.tsx). Validamos apenas o
// contrato de exportação do módulo.
// =============================================================================

import { describe, expect, it } from 'vitest';

describe('OfflinePage', () => {
  it('é uma função React exportada', async () => {
    const { OfflinePage } = await import('../OfflinePage');
    expect(typeof OfflinePage).toBe('function');
  });
});
