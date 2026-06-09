// =============================================================================
// __tests__/useContextualTutorials.test.ts
//
// Testes unitários do hook useContextualTutorials.
// Testamos lógica de indexação e contratos de interface.
// Sem JSDOM — testes de função pura e contratos de exportação.
// =============================================================================

import { describe, expect, it } from 'vitest';

import type { TutorialEntry } from '../useContextualTutorials';

// ─── Lógica de indexação (extraída para teste) ────────────────────────────────

/** Mesma lógica do hook — indexa por featureKey. */
function indexByFeatureKey(data: TutorialEntry[]): Record<string, TutorialEntry> {
  const map: Record<string, TutorialEntry> = {};
  for (const t of data) {
    map[t.featureKey] = t;
  }
  return map;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TUTORIALS: TutorialEntry[] = [
  {
    id: 'tut-1',
    featureKey: 'crm.lead.create',
    title: 'Como criar um lead',
    description: 'Aprenda a criar um lead no CRM.',
    provider: 'youtube',
    videoRef: 'abc123',
    hash: null,
    articleSlug: 'guias/crm/criar-lead',
    isActive: true,
  },
  {
    id: 'tut-2',
    featureKey: 'followup.create',
    title: 'Como fazer follow-up',
    description: 'Guia de follow-up.',
    provider: 'youtube',
    videoRef: 'def456',
    hash: null,
    articleSlug: null,
    isActive: true,
  },
];

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('indexByFeatureKey — lógica de indexação', () => {
  it('retorna objeto vazio para array vazio', () => {
    const map = indexByFeatureKey([]);
    expect(map).toEqual({});
  });

  it('indexa tutorial por featureKey', () => {
    const map = indexByFeatureKey(TUTORIALS);
    expect(map['crm.lead.create']).toBeDefined();
    expect(map['crm.lead.create']?.id).toBe('tut-1');
  });

  it('acesso a key inexistente retorna undefined', () => {
    const map = indexByFeatureKey(TUTORIALS);
    expect(map['feature.inexistente']).toBeUndefined();
  });

  it('indexa múltiplos tutoriais sem colisão', () => {
    const map = indexByFeatureKey(TUTORIALS);
    expect(Object.keys(map)).toHaveLength(2);
    expect(map['followup.create']?.id).toBe('tut-2');
  });

  it('última entrada vence em caso de featureKey duplicada', () => {
    // Comportamento defensivo — backend não deve retornar duplicadas.
    const data: TutorialEntry[] = [
      { ...TUTORIALS[0]!, id: 'first' },
      { ...TUTORIALS[0]!, id: 'second' },
    ];
    const map = indexByFeatureKey(data);
    expect(map['crm.lead.create']?.id).toBe('second');
  });
});

describe('TutorialEntry — contratos de tipo', () => {
  it('hash pode ser null', () => {
    const t = TUTORIALS[0]!;
    expect(t.hash).toBeNull();
  });

  it('articleSlug pode ser null', () => {
    const t = TUTORIALS[1]!;
    expect(t.articleSlug).toBeNull();
  });

  it('isActive está presente na entrada', () => {
    const t = TUTORIALS[0]!;
    expect(t.isActive).toBe(true);
  });
});

describe('useContextualTutorials — contrato de exportação', () => {
  it('exporta useContextualTutorials como named export', async () => {
    const mod = await import('../useContextualTutorials');
    expect(typeof mod.useContextualTutorials).toBe('function');
  });

  it('exporta TUTORIALS_QUERY_KEY como array', async () => {
    const mod = await import('../useContextualTutorials');
    expect(Array.isArray(mod.TUTORIALS_QUERY_KEY)).toBe(true);
    expect(mod.TUTORIALS_QUERY_KEY[0]).toBe('help');
    expect(mod.TUTORIALS_QUERY_KEY[1]).toBe('tutorials');
  });
});
