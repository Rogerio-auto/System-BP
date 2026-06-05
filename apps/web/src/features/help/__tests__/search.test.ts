import { describe, expect, it } from 'vitest';

import { getIndexSize, searchHelp } from '../search';

describe('searchHelp', () => {
  it('indexa pelo menos 13 artigos (home + 3 conceitos + 3 trilhas + 6 guias CRM)', () => {
    expect(getIndexSize()).toBeGreaterThanOrEqual(13);
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

  it('busca por "admin" encontra a trilha comecar/admin', () => {
    const out = searchHelp('admin');
    const slugs = out.map((r) => r.slug);
    expect(slugs).toContain('comecar/admin');
  });

  it('busca por "gestor" encontra a trilha comecar/gestor', () => {
    const out = searchHelp('gestor');
    const slugs = out.map((r) => r.slug);
    expect(slugs).toContain('comecar/gestor');
  });

  it('busca por "agente" encontra a trilha comecar/agente', () => {
    const out = searchHelp('agente');
    const slugs = out.map((r) => r.slug);
    expect(slugs).toContain('comecar/agente');
  });

  it('respeita o limit', () => {
    const out = searchHelp('a', 1);
    expect(out.length).toBeLessThanOrEqual(1);
  });

  it('busca por "criar lead" encontra guias/crm/criar-lead', () => {
    const out = searchHelp('criar lead');
    const slugs = out.map((r) => r.slug);
    expect(slugs).toContain('guias/crm/criar-lead');
  });

  it('busca por "importar" encontra guias/crm/importar-leads', () => {
    const out = searchHelp('importar');
    const slugs = out.map((r) => r.slug);
    expect(slugs).toContain('guias/crm/importar-leads');
  });

  it('busca por "kanban" encontra guias/crm/kanban', () => {
    const out = searchHelp('kanban');
    const slugs = out.map((r) => r.slug);
    expect(slugs).toContain('guias/crm/kanban');
  });

  it('busca por "converter" encontra guias/crm/converter-em-cliente', () => {
    const out = searchHelp('converter');
    const slugs = out.map((r) => r.slug);
    expect(slugs).toContain('guias/crm/converter-em-cliente');
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
