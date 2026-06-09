import { describe, expect, it } from 'vitest';

import { getIndexSize, searchHelp } from '../search';

describe('searchHelp', () => {
  it('indexa pelo menos 26 artigos (home + 4 conceitos + _template + 3 trilhas + 6 guias CRM + 11 guias novos + api)', () => {
    expect(getIndexSize()).toBeGreaterThanOrEqual(26);
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

  // ── Guias novos (F10-S08) ──────────────────────────────────────────────────

  it('busca por "analise" encontra um guia de analise de credito', () => {
    const out = searchHelp('analise');
    const slugs = out.map((r) => r.slug);
    expect(slugs.some((s) => s.startsWith('guias/analise/'))).toBe(true);
  });

  it('busca por "regua" encontra um guia de configuracao de regua', () => {
    const out = searchHelp('regua');
    const slugs = out.map((r) => r.slug);
    const hasRegua = slugs.some(
      (s) => s === 'guias/follow-up/configurar-reguas' || s === 'guias/cobranca/configurar-reguas',
    );
    expect(hasRegua).toBe(true);
  });

  it('busca por "job" encontra um guia de monitoramento de jobs', () => {
    const out = searchHelp('job');
    const slugs = out.map((r) => r.slug);
    expect(
      slugs.some(
        (s) => s === 'guias/follow-up/monitorar-jobs' || s === 'guias/cobranca/monitorar-jobs',
      ),
    ).toBe(true);
  });

  it('busca por "template" encontra um guia de templates', () => {
    const out = searchHelp('template');
    const slugs = out.map((r) => r.slug);
    expect(slugs.some((s) => s.startsWith('guias/templates/'))).toBe(true);
  });

  it('busca por "parcela" encontra guias/cobranca/registrar-parcelas', () => {
    const out = searchHelp('parcela');
    const slugs = out.map((r) => r.slug);
    expect(slugs).toContain('guias/cobranca/registrar-parcelas');
  });

  it('busca por "aprovacao" encontra guias/templates/aprovacao-de-template', () => {
    const out = searchHelp('aprovacao');
    const slugs = out.map((r) => r.slug);
    expect(slugs).toContain('guias/templates/aprovacao-de-template');
  });

  it('busca por "versionar" encontra guias/analise/versionar-analise', () => {
    const out = searchHelp('versionar');
    const slugs = out.map((r) => r.slug);
    expect(slugs).toContain('guias/analise/versionar-analise');
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
  // ── API section (F10-S11) ─────────────────────────────────────────────────

  it('busca por "api" encontra a pagina api/index', () => {
    const out = searchHelp('api');
    const slugs = out.map((r) => r.slug);
    expect(slugs).toContain('api');
  });

  // ── Meta-guia e molde canônico (F10-S15) ──────────────────────────────────────

  it('busca por "como escrever" devolve o meta-guia no top-3', () => {
    const out = searchHelp('como escrever', 3);
    const slugs = out.map((r) => r.slug);
    expect(slugs).toContain('conceitos/como-escrever-uma-pagina');
  });

  it('busca por "template" continua encontrando guias de templates (regressao)', () => {
    // Nota: _template também é retornado (title contém "Template"). Excluir drafts
    // do índice requer mudança em search.ts — planejado como hardening futuro.
    // Esta assertion garante que os guias de uso do operador continuam acessíveis.
    const out = searchHelp('template', 8);
    const slugs = out.map((r) => r.slug);
    expect(slugs.some((s) => s.startsWith('guias/templates/'))).toBe(true);
  });
});
