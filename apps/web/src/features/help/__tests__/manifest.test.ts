import { describe, expect, it } from 'vitest';

import { getArticleBySlug, getHelpManifest } from '../manifest';

// Guarda contra a classe de bug "glob path errado, manifest vazio, tudo 404".
// Foi exatamente isso que aconteceu na primeira tentativa do F10-S02 — a CI
// passou typecheck/lint/build mas o runtime devolvia { home: null, sections: [] }
// porque o número de `..` no glob estava errado em 1. Este teste falha rápido
// se o glob deixar de bater nos .mdx em docs/help/.

describe('help manifest', () => {
  it('encontra ao menos a página index e a página de conceitos', async () => {
    const m = await getHelpManifest();
    expect(m.home).not.toBeNull();
    expect(m.home?.title).toBe('Central de Ajuda');
    expect(m.sections.length).toBeGreaterThan(0);
  });

  it('resolve slug vazio para a home', async () => {
    const article = await getArticleBySlug('');
    expect(article).not.toBeNull();
    expect(article?.slug).toBe('');
  });

  it('resolve slug aninhado conceitos/papeis-e-cidades', async () => {
    const article = await getArticleBySlug('conceitos/papeis-e-cidades');
    expect(article).not.toBeNull();
    expect(article?.title).toBe('Papéis e cidades');
  });

  it('resolve slug aninhado conceitos/lgpd', async () => {
    const article = await getArticleBySlug('conceitos/lgpd');
    expect(article).not.toBeNull();
    expect(article?.title).toBe('LGPD no Banco do Povo');
  });

  it('resolve slug aninhado conceitos/modulos-liberados', async () => {
    const article = await getArticleBySlug('conceitos/modulos-liberados');
    expect(article).not.toBeNull();
    expect(article?.title).toBe('Módulos liberados');
  });

  it('seção conceitos respeita a ordem da frontmatter (10, 20, 30)', async () => {
    const m = await getHelpManifest();
    const conceitos = m.sections.find((s) => s.slug === 'conceitos');
    expect(conceitos).toBeDefined();
    const slugs = conceitos?.articles.map((a) => a.slug) ?? [];
    expect(slugs).toEqual([
      'conceitos/papeis-e-cidades',
      'conceitos/lgpd',
      'conceitos/modulos-liberados',
    ]);
  });

  it('seção comecar aparece antes de conceitos no manifest', async () => {
    const m = await getHelpManifest();
    const slugs = m.sections.map((s) => s.slug);
    const idxComecar = slugs.indexOf('comecar');
    const idxConceitos = slugs.indexOf('conceitos');
    expect(idxComecar).toBeGreaterThanOrEqual(0);
    expect(idxConceitos).toBeGreaterThanOrEqual(0);
    expect(idxComecar).toBeLessThan(idxConceitos);
  });

  it('seção guias aparece entre comecar e conceitos no manifest', async () => {
    const m = await getHelpManifest();
    const slugs = m.sections.map((s) => s.slug);
    const idxComecar = slugs.indexOf('comecar');
    const idxGuias = slugs.indexOf('guias');
    const idxConceitos = slugs.indexOf('conceitos');
    expect(idxGuias).toBeGreaterThanOrEqual(0);
    expect(idxComecar).toBeLessThan(idxGuias);
    expect(idxGuias).toBeLessThan(idxConceitos);
  });

  it('os 6 slugs de guias/crm resolvem via getArticleBySlug', async () => {
    const slugs = [
      'guias/crm/criar-lead',
      'guias/crm/importar-leads',
      'guias/crm/kanban',
      'guias/crm/detalhes-do-lead',
      'guias/crm/converter-em-cliente',
      'guias/crm/buscar-e-filtrar',
    ];
    for (const slug of slugs) {
      const article = await getArticleBySlug(slug);
      expect(article).not.toBeNull();
      expect(article?.slug).toBe(slug);
    }
  });

  it('título display da seção comecar é "Começar" (com cedilha)', async () => {
    const m = await getHelpManifest();
    const comecar = m.sections.find((s) => s.slug === 'comecar');
    expect(comecar?.title).toBe('Começar');
  });

  it('resolve as 3 trilhas de comecar', async () => {
    const admin = await getArticleBySlug('comecar/admin');
    const gestor = await getArticleBySlug('comecar/gestor');
    const agente = await getArticleBySlug('comecar/agente');
    expect(admin?.title).toBe('Começar como administrador');
    expect(gestor?.title).toBe('Começar como gestor');
    expect(agente?.title).toBe('Começar como agente');
  });

  it('seção comecar respeita a ordem da frontmatter (admin, gestor, agente)', async () => {
    const m = await getHelpManifest();
    const comecar = m.sections.find((s) => s.slug === 'comecar');
    const slugs = comecar?.articles.map((a) => a.slug) ?? [];
    expect(slugs).toEqual(['comecar/admin', 'comecar/gestor', 'comecar/agente']);
  });

  it('devolve null para slug inexistente', async () => {
    const article = await getArticleBySlug('nao/existe');
    expect(article).toBeNull();
  });
});
