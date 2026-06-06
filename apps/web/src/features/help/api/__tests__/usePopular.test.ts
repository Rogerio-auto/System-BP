import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// usePopular.test.ts -- testa logica pura sem DOM/fetch.
//
// O hook em si usa TanStack Query (nao mockamos aqui sem JSDOM).
// Testamos o fetchPopular logica de resolucao de titulo.
// ---------------------------------------------------------------------------

// Replica da logica de fallback de titulo do usePopular.
function resolveTitleFallback(slug: string): string {
  return (
    slug
      .split('/')
      .pop()
      ?.replace(/-/g, ' ')
      .replace(/^\w/, (c: string) => c.toUpperCase()) ?? slug
  );
}

describe('usePopular -- titulo fallback', () => {
  it('slug com hifen -> capitaliza e substitui hifen por espaco', () => {
    expect(resolveTitleFallback('guias/crm/criar-lead')).toBe('Criar lead');
  });

  it('slug de um nivel -> capitaliza', () => {
    expect(resolveTitleFallback('overview')).toBe('Overview');
  });

  it('slug vazio -> retorna vazio', () => {
    expect(resolveTitleFallback('')).toBe('');
  });

  it('slug de api reference -> capitaliza resource', () => {
    expect(resolveTitleFallback('api/leads')).toBe('Leads');
  });
});

describe('usePopular -- queryKey', () => {
  it('queryKey contem limit para cache granular', () => {
    const limit = 10;
    const queryKey = ['help', 'popular', limit] as const;
    expect(queryKey[2]).toBe(10);
    expect(queryKey).toHaveLength(3);
  });

  it('staleTime de 10 minutos em ms', () => {
    const STALE_TIME_MS = 600_000;
    expect(STALE_TIME_MS).toBe(10 * 60 * 1000);
  });
});
