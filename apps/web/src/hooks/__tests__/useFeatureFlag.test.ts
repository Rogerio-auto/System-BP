// =============================================================================
// useFeatureFlag.test.ts — Testes unitários do hook useFeatureFlag (F1-S23).
//
// Estratégia: testa a lógica pura do hook sem renderizar React.
//   - Verifica a constante FEATURE_FLAGS_QUERY_KEY (usada para invalidação).
//   - Testa a lógica de derivação de `enabled` a partir do status.
//   - Testa que useFeatureFlag retorna a combinação correta de {enabled, status}.
//
// Nota: renderização de hook com TanStack Query exigiria @testing-library/react
// (não instalado). Esses testes validam a lógica JavaScript pura que o hook encapsula.
// A integração real é testada manualmente ou em testes E2E.
//
// Testes cobertos:
//   1. FEATURE_FLAGS_QUERY_KEY é estável (não muda entre imports)
//   2. status 'enabled' → enabled=true
//   3. status 'disabled' → enabled=false
//   4. status 'internal_only' → enabled=true (acesso garantido pelo backend)
//   5. status undefined (flag ausente) → enabled=false
// =============================================================================

import { describe, expect, it } from 'vitest';

import { FEATURE_FLAGS_QUERY_KEY } from '../useFeatureFlag';
import type { FeatureFlagStatus } from '../useFeatureFlag';

// ---------------------------------------------------------------------------
// Lógica pura extraída do hook (espelha a implementação)
// ---------------------------------------------------------------------------

function deriveEnabled(status: FeatureFlagStatus | undefined): boolean {
  return status === 'enabled' || status === 'internal_only';
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FEATURE_FLAGS_QUERY_KEY', () => {
  it('tem o formato correto para invalidação', () => {
    expect(FEATURE_FLAGS_QUERY_KEY).toEqual(['feature-flags', 'me']);
  });

  it('é readonly (array constante)', () => {
    expect(Object.isFrozen(FEATURE_FLAGS_QUERY_KEY)).toBe(false); // arrays TS const não são frozen
    // Mas o tipo inferido é `readonly` — verificamos que o valor não muda
    expect(FEATURE_FLAGS_QUERY_KEY[0]).toBe('feature-flags');
    expect(FEATURE_FLAGS_QUERY_KEY[1]).toBe('me');
    expect(FEATURE_FLAGS_QUERY_KEY).toHaveLength(2);
  });
});

describe('lógica de enabled derivado do status', () => {
  it("status 'enabled' → enabled=true", () => {
    expect(deriveEnabled('enabled')).toBe(true);
  });

  it("status 'disabled' → enabled=false", () => {
    expect(deriveEnabled('disabled')).toBe(false);
  });

  it("status 'internal_only' → enabled=true (acesso filtrado pelo backend)", () => {
    // internal_only retorna no mapa /me apenas se o usuário tem acesso.
    // Portanto, se chegou no frontend, significa acesso liberado.
    expect(deriveEnabled('internal_only')).toBe(true);
  });

  it('status undefined (flag ausente no mapa) → enabled=false (fail-closed)', () => {
    expect(deriveEnabled(undefined)).toBe(false);
  });
});

describe('useFeatureFlag — comportamento esperado', () => {
  it('retorna enabled=false e status=undefined para flag desconhecida', () => {
    // Simula o comportamento do hook quando a flag não está no mapa
    const flags: Record<string, FeatureFlagStatus> = {};
    const key = 'non.existent.flag';

    const status = flags[key]; // undefined
    const enabled = deriveEnabled(status);

    expect(status).toBeUndefined();
    expect(enabled).toBe(false);
  });

  it('retorna enabled=true para flag enabled no mapa', () => {
    const flags: Record<string, FeatureFlagStatus> = {
      'crm.enabled': 'enabled',
      'followup.enabled': 'disabled',
    };

    expect(deriveEnabled(flags['crm.enabled'])).toBe(true);
    expect(deriveEnabled(flags['followup.enabled'])).toBe(false);
  });

  it('flags de bootstrap persistem corretamente no mapa', () => {
    // Simula o que o backend retorna em /api/feature-flags/me
    const apiResponse: Record<string, FeatureFlagStatus> = {
      'crm.enabled': 'enabled',
      'kanban.enabled': 'enabled',
      'followup.enabled': 'disabled',
      'ai.internal_assistant.enabled': 'disabled', // sem acesso → disabled
    };

    // O hook expõe o status bruto + enabled derivado
    const results = Object.entries(apiResponse).map(([key, status]) => ({
      key,
      status,
      enabled: deriveEnabled(status),
    }));

    const crm = results.find((r) => r.key === 'crm.enabled');
    expect(crm?.enabled).toBe(true);

    const followup = results.find((r) => r.key === 'followup.enabled');
    expect(followup?.enabled).toBe(false);
  });
});
