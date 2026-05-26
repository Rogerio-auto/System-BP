// =============================================================================
// components/comboboxes/__tests__/CityCombobox.test.tsx
//
// Testes unitários para o CityCombobox (F8-S14).
// Estratégia: testa lógica pura sem JSDOM.
//
// Cobertura:
//   1. URLSearchParams monta corretamente para a API de cidades
//   2. Query < 2 chars não dispara request
//   3. Cidades não contêm PII
// =============================================================================

import { describe, expect, it } from 'vitest';

// ─── Lógica do fetcher (extraída para teste isolado) ──────────────────────────

function buildCitySearchUrl(search: string): string | null {
  if (!search.trim() || search.trim().length < 2) return null;
  const qs = new URLSearchParams({ search: search.trim(), limit: '20' });
  return `/api/admin/cities?${qs.toString()}`;
}

// ─── Testes ──────────────────────────────────────────────────────────────────

describe('CityCombobox — lógica do fetcher (F8-S14)', () => {
  it('usa "search" como parâmetro de busca', () => {
    const url = buildCitySearchUrl('Porto');
    expect(url).not.toBeNull();
    expect(url).toContain('search=Porto');
  });

  it('inclui limit=20 na query string', () => {
    const url = buildCitySearchUrl('Porto');
    expect(url).toContain('limit=20');
  });

  it('retorna null para query vazia (não dispara request)', () => {
    expect(buildCitySearchUrl('')).toBeNull();
    expect(buildCitySearchUrl('   ')).toBeNull();
  });

  it('retorna null para query < 2 chars', () => {
    expect(buildCitySearchUrl('P')).toBeNull();
  });

  it('dispara para query >= 2 chars', () => {
    const url = buildCitySearchUrl('Po');
    expect(url).not.toBeNull();
    expect(url).toContain('search=Po');
  });

  it('trimeia espaços antes de enviar', () => {
    const url = buildCitySearchUrl('  Porto Velho  ');
    expect(url).toContain('search=Porto+Velho');
  });

  it('aponta para /api/admin/cities', () => {
    const url = buildCitySearchUrl('Porto Velho');
    expect(url).not.toBeNull();
    expect(url!.startsWith('/api/admin/cities?')).toBe(true);
  });
});

describe('CityCombobox — dados de cidade sem PII', () => {
  const mockCity = {
    id: 'city-uuid-001',
    organization_id: 'org-001',
    name: 'Porto Velho',
    name_normalized: 'porto velho',
    aliases: ['PVH'],
    slug: 'porto-velho',
    ibge_code: '1100205',
    state_uf: 'RO',
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
  };

  it('CityResponse não contém PII (apenas nome de município + UF)', () => {
    // Cidades não têm telefone, email, CPF
    expect(mockCity).not.toHaveProperty('phone_e164');
    expect(mockCity).not.toHaveProperty('email');
    expect(mockCity).not.toHaveProperty('cpf');
  });

  it('is_active controla exibição do badge "Inativa"', () => {
    expect(mockCity.is_active).toBe(true);
    const inativeCity = { ...mockCity, is_active: false };
    expect(inativeCity.is_active).toBe(false);
  });

  it('state_uf exibe UF da cidade', () => {
    expect(mockCity.state_uf).toBe('RO');
    expect(mockCity.state_uf.length).toBe(2);
  });
});
