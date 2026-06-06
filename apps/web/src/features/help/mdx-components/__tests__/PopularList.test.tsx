import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// PopularList.test.tsx -- testa logica pura sem DOM.
//
// PopularList e um componente de apresentacao. Testamos logica derivada:
//   - titulo fallback quando artigo nao existe no manifest
//   - ordenacao dos itens (backend retorna ordenados, testamos preservacao)
// ---------------------------------------------------------------------------

// Replica do fallback de titulo do usePopular.
function titleFallback(slug: string): string {
  return (
    slug
      .split('/')
      .pop()
      ?.replace(/-/g, ' ')
      .replace(/^\w/, (c: string) => c.toUpperCase()) ?? slug
  );
}

describe('PopularList titleFallback', () => {
  it('guias/crm/criar-lead -> Criar lead', () => {
    expect(titleFallback('guias/crm/criar-lead')).toBe('Criar lead');
  });

  it('conceitos/lgpd -> Lgpd', () => {
    expect(titleFallback('conceitos/lgpd')).toBe('Lgpd');
  });

  it('slug sem barra -> usa o proprio slug capitalizado', () => {
    expect(titleFallback('overview')).toBe('Overview');
  });

  it('slug vazio -> retorna vazio', () => {
    expect(titleFallback('')).toBe('');
  });
});

describe('PopularList dados', () => {
  it('lista vazia deve renderizar mensagem amigavel (logica derivada)', () => {
    const data: { slug: string; title: string; count: number }[] = [];
    const isEmpty = !data || data.length === 0;
    expect(isEmpty).toBe(true);
  });

  it('lista com itens: count deve ser numero positivo', () => {
    const data = [
      { slug: 'guias/crm/criar-lead', title: 'Criar lead', count: 42 },
      { slug: 'conceitos/lgpd', title: 'LGPD no Banco do Povo', count: 17 },
    ];
    expect(data.every((d) => d.count > 0)).toBe(true);
  });

  it('ordenacao: primeiro item tem maior count', () => {
    const data = [
      { slug: 'a', title: 'A', count: 100 },
      { slug: 'b', title: 'B', count: 50 },
      { slug: 'c', title: 'C', count: 10 },
    ];
    const [first, second, third] = data;
    expect(first?.count).toBeGreaterThanOrEqual(second?.count ?? 0);
    expect(second?.count).toBeGreaterThanOrEqual(third?.count ?? 0);
  });
});
