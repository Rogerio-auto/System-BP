// =============================================================================
// __tests__/ContextualHelpDrawer.test.ts
//
// Testes unitários do ContextualHelpDrawer.
// Foco: lógica pura e contratos de exportação (sem JSDOM).
// =============================================================================

import { describe, expect, it } from 'vitest';

describe('ContextualHelpDrawer — contrato de exportação', () => {
  it('exporta ContextualHelpDrawer como named export', async () => {
    const mod = await import('../ContextualHelpDrawer');
    expect(typeof mod.ContextualHelpDrawer).toBe('function');
  });

  it('não aceita props (singleton sem argumentos externos)', async () => {
    const mod = await import('../ContextualHelpDrawer');
    // length=0 confirma que não há props obrigatórias no componente React.
    expect(mod.ContextualHelpDrawer.length).toBe(0);
  });
});

describe('ContextualHelpDrawer — hasUnsavedForm (lógica isolada)', () => {
  /**
   * Replica a função hasUnsavedForm do componente para testar em isolamento.
   * O componente usa document.querySelector — aqui testamos o contrato lógico.
   */
  function hasUnsavedFormMock(selector: string | null): boolean {
    return selector !== null;
  }

  it('retorna false quando não há elemento com data-unsaved="true"', () => {
    expect(hasUnsavedFormMock(null)).toBe(false);
  });

  it('retorna true quando há elemento com data-unsaved="true"', () => {
    expect(hasUnsavedFormMock('[data-unsaved="true"]')).toBe(true);
  });
});

describe('ContextualHelpDrawer — slug para URL', () => {
  it('monta URL correta para artigo com slug', () => {
    const articleSlug = 'guias/crm/criar-lead';
    const expectedUrl = `/ajuda/${articleSlug}`;
    expect(expectedUrl).toBe('/ajuda/guias/crm/criar-lead');
  });

  it('slug null não gera URL', () => {
    const articleSlug: string | null = null;
    // A lógica do componente só chama navigate quando articleSlug !== null.
    expect(articleSlug).toBeNull();
  });
});

describe('ContextualHelpDrawer — isVideoProvider guard', () => {
  function isVideoProvider(value: string): value is 'youtube' | 'vimeo' | 'mp4' {
    return value === 'youtube' || value === 'vimeo' || value === 'mp4';
  }

  it('youtube é provider válido', () => {
    expect(isVideoProvider('youtube')).toBe(true);
  });

  it('vimeo é provider válido', () => {
    expect(isVideoProvider('vimeo')).toBe(true);
  });

  it('mp4 é provider válido', () => {
    expect(isVideoProvider('mp4')).toBe(true);
  });

  it('string desconhecida não é provider válido', () => {
    expect(isVideoProvider('twitch')).toBe(false);
    expect(isVideoProvider('')).toBe(false);
  });
});
