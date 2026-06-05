import { describe, expect, it } from 'vitest';

import { getIndexSize, searchHelp } from '../search';

describe('searchHelp', () => {
  it('indexa pelo menos 4 artigos (home + 3 conceitos)', () => {
    expect(getIndexSize()).toBeGreaterThanOrEqual(4);
  });

  it('query vazia retorna lista vazia', () => {
    expect(searchHelp('')).toEqual([]);
    expect(searchHelp('   ')).toEqual([]);
  });

  it('busca por "papéis" encontra o artigo conceitos/papeis-e-cidades', () => {
    const out = searchHelp('papeis');
    const slugs = out.map((r) => r.slug);
    expect(slugs).toContain('conceitos/papeis-e-cidades');
  });

  it('busca por "lgpd" encontra o artigo conceitos/lgpd', () => {
    const out = searchHelp('lgpd');
    const slugs = out.map((r) => r.slug);
    expect(slugs).toContain('conceitos/lgpd');
  });

  it('busca por "módulos" encontra o artigo conceitos/modulos-liberados', () => {
    const out = searchHelp('modulos');
    const slugs = out.map((r) => r.slug);
    expect(slugs).toContain('conceitos/modulos-liberados');
  });

  it('busca por "central" encontra a home', () => {
    const out = searchHelp('central');
    const slugs = out.map((r) => r.slug);
    expect(slugs).toContain('');
  });

  it('respeita o limit', () => {
    const out = searchHelp('a', 1);
    expect(out.length).toBeLessThanOrEqual(1);
  });

  it('cada resultado tem title e snippet não vazios', () => {
    const out = searchHelp('lgpd');
    expect(out.length).toBeGreaterThan(0);
    for (const r of out) {
      expect(typeof r.title).toBe('string');
      expect(r.title.length).toBeGreaterThan(0);
      expect(typeof r.snippet).toBe('string');
    }
  });
});
