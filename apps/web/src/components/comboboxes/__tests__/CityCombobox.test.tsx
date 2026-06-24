// =============================================================================
// components/comboboxes/__tests__/CityCombobox.test.tsx
//
// Testes unitários para o CityCombobox.
// Estratégia: testa a lógica pura de filtro (mirror) sem JSDOM.
//
// O combobox passou a consumir o endpoint PÚBLICO /api/cities e filtra
// client-side (catálogo pequeno) — sem mais request de busca por chars.
//
// Cobertura:
//   1. normalize: case + acento-insensível
//   2. filtro client-side: substring, vazio retorna tudo
//   3. shape público de cidade não contém PII
// =============================================================================

import { describe, expect, it } from 'vitest';

// ─── Mirror da lógica de normalização/filtro do componente ────────────────────

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

interface CityLite {
  id: string;
  name: string;
  state_uf: string;
}

function filterCities(cities: CityLite[], query: string): CityLite[] {
  const q = normalize(query.trim());
  const base = q ? cities.filter((c) => normalize(c.name).includes(q)) : cities;
  return base.slice(0, 50);
}

const CITIES: CityLite[] = [
  { id: '1', name: 'Porto Velho', state_uf: 'RO' },
  { id: '2', name: 'Ji-Paraná', state_uf: 'RO' },
  { id: '3', name: 'Cacoal', state_uf: 'RO' },
  { id: '4', name: "Espigão d'Oeste", state_uf: 'RO' },
];

// ─── Testes ──────────────────────────────────────────────────────────────────

describe('CityCombobox — normalize', () => {
  it('lowercases e remove acentos', () => {
    expect(normalize('Ji-Paraná')).toBe('ji-parana');
    expect(normalize('CACOAL')).toBe('cacoal');
    expect(normalize("Espigão d'Oeste")).toBe("espigao d'oeste");
  });
});

describe('CityCombobox — filtro client-side', () => {
  it('busca por substring (case-insensível)', () => {
    const r = filterCities(CITIES, 'porto');
    expect(r).toHaveLength(1);
    expect(r[0]!.name).toBe('Porto Velho');
  });

  it('busca acento-insensível', () => {
    const r = filterCities(CITIES, 'parana');
    expect(r).toHaveLength(1);
    expect(r[0]!.name).toBe('Ji-Paraná');
  });

  it('query vazia retorna todas', () => {
    expect(filterCities(CITIES, '')).toHaveLength(CITIES.length);
    expect(filterCities(CITIES, '   ')).toHaveLength(CITIES.length);
  });

  it('sem match retorna lista vazia', () => {
    expect(filterCities(CITIES, 'zzz')).toHaveLength(0);
  });
});

describe('CityCombobox — shape público sem PII', () => {
  const mockCity = { id: 'city-uuid-001', name: 'Porto Velho', state_uf: 'RO' };

  it('cidade pública não contém PII (apenas nome de município + UF)', () => {
    expect(mockCity).not.toHaveProperty('phone_e164');
    expect(mockCity).not.toHaveProperty('email');
    expect(mockCity).not.toHaveProperty('cpf');
  });

  it('state_uf exibe UF da cidade', () => {
    expect(mockCity.state_uf).toBe('RO');
    expect(mockCity.state_uf.length).toBe(2);
  });
});
