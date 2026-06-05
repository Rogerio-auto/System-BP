import { describe, expect, it } from 'vitest';

import { getIndexSize, searchHelp } from '../search';

describe('searchHelp', () => {
  it('indexa pelo menos a home e a página de conceitos', () => {
    expect(getIndexSize()).toBeGreaterThanOrEqual(2);
  });

  it('query vazia retorna lista vazia', () => {
    expect(searchHelp('')).toEqual([]);
    expect(searchHelp('   ')).toEqual([]);
  });

  it('busca por "pipeline" encontra o artigo conceitos/pipeline-mdx', () => {
    const out = searchHelp('pipeline');
    const slugs = out.map((r) => r.slug);
    expect(slugs).toContain('conceitos/pipeline-mdx');
  });

  it('busca por "central de ajuda" encontra a home', () => {
    const out = searchHelp('central');
    const slugs = out.map((r) => r.slug);
    expect(slugs).toContain('');
  });

  it('respeita o limit', () => {
    const out = searchHelp('a', 1);
    expect(out.length).toBeLessThanOrEqual(1);
  });

  it('cada resultado tem title e snippet', () => {
    const out = searchHelp('pipeline');
    expect(out.length).toBeGreaterThan(0);
    for (const r of out) {
      expect(typeof r.title).toBe('string');
      expect(r.title.length).toBeGreaterThan(0);
      expect(typeof r.snippet).toBe('string');
    }
  });
});
