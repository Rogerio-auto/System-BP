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

  it('resolve slug aninhado conceitos/pipeline-mdx', async () => {
    const article = await getArticleBySlug('conceitos/pipeline-mdx');
    expect(article).not.toBeNull();
    expect(article?.title).toBe('Pipeline MDX — referência de componentes');
  });

  it('devolve null para slug inexistente', async () => {
    const article = await getArticleBySlug('nao/existe');
    expect(article).toBeNull();
  });
});
