// =============================================================================
// features/notifications/__tests__/navigation.test.ts — F26-S01 + F26-S04
//
// Cobertura:
//   1. resolveNotificationHref: mapeamento entity_type -> rota (fonte única
//      reusada por lista e toast — doc 23 §14, gap G2).
//   2. getNotificationActionLabel: rótulo do CTA por entity_type (gap G5).
//   3. resolveNotificationCategory/getNotificationCategoryLabel: derivação de
//      categoria a partir de entity_type (F26-S04, central de notificações).
// =============================================================================

import { describe, expect, it } from 'vitest';

import {
  getNotificationActionLabel,
  getNotificationCategoryLabel,
  NOTIFICATION_CATEGORIES,
  resolveNotificationCategory,
  resolveNotificationHref,
} from '../navigation';

// ---------------------------------------------------------------------------
// resolveNotificationHref
// ---------------------------------------------------------------------------

describe('resolveNotificationHref', () => {
  it('customer com id -> /crm/:id', () => {
    expect(resolveNotificationHref('customer', 'abc-123')).toBe('/crm/abc-123');
  });

  it('customer sem id -> /crm', () => {
    expect(resolveNotificationHref('customer', null)).toBe('/crm');
  });

  it('credit_analysis com id -> /credit-analyses/:id', () => {
    expect(resolveNotificationHref('credit_analysis', 'ca-1')).toBe('/credit-analyses/ca-1');
  });

  it('credit_analysis sem id -> lista', () => {
    expect(resolveNotificationHref('credit_analysis', null)).toBe('/credit-analyses');
  });

  it('simulation -> /simulator (não endereçável por id)', () => {
    expect(resolveNotificationHref('simulation', 'sim-1')).toBe('/simulator');
  });

  it('task -> /tarefas', () => {
    expect(resolveNotificationHref('task', 'task-1')).toBe('/tarefas');
  });

  it('contract -> /contratos (lista, doc 23 §14)', () => {
    expect(resolveNotificationHref('contract', 'c-1')).toBe('/contratos');
  });

  it('conversation com id -> /conversas?conversation=:id (F29-S02)', () => {
    expect(resolveNotificationHref('conversation', 'conv-1')).toBe(
      '/conversas?conversation=conv-1',
    );
  });

  it('conversation sem id -> /conversas (lista)', () => {
    expect(resolveNotificationHref('conversation', null)).toBe('/conversas');
  });

  it('kanban_card -> /crm?view=kanban', () => {
    expect(resolveNotificationHref('kanban_card', 'kc-1')).toBe('/crm?view=kanban');
  });

  it('payment_due -> /admin/billing/dues', () => {
    expect(resolveNotificationHref('payment_due', 'pd-1')).toBe('/admin/billing/dues');
  });

  it('billing -> /admin/billing/dues', () => {
    expect(resolveNotificationHref('billing', 'b-1')).toBe('/admin/billing/dues');
  });

  it('entity_type desconhecido -> null (sem link)', () => {
    expect(resolveNotificationHref('unknown_type', 'x-1')).toBeNull();
  });

  it('entity_type null -> null', () => {
    expect(resolveNotificationHref(null, null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getNotificationActionLabel
// ---------------------------------------------------------------------------

describe('getNotificationActionLabel', () => {
  it('customer -> "Abrir lead"', () => {
    expect(getNotificationActionLabel('customer')).toBe('Abrir lead');
  });

  it('credit_analysis -> "Abrir análise"', () => {
    expect(getNotificationActionLabel('credit_analysis')).toBe('Abrir análise');
  });

  it('simulation -> "Ver simulação"', () => {
    expect(getNotificationActionLabel('simulation')).toBe('Ver simulação');
  });

  it('task -> "Abrir tarefa"', () => {
    expect(getNotificationActionLabel('task')).toBe('Abrir tarefa');
  });

  it('contract -> "Abrir contrato"', () => {
    expect(getNotificationActionLabel('contract')).toBe('Abrir contrato');
  });

  it('conversation -> "Abrir conversa"', () => {
    expect(getNotificationActionLabel('conversation')).toBe('Abrir conversa');
  });

  it('kanban_card -> "Abrir no Kanban"', () => {
    expect(getNotificationActionLabel('kanban_card')).toBe('Abrir no Kanban');
  });

  it('payment_due -> "Ver cobrança"', () => {
    expect(getNotificationActionLabel('payment_due')).toBe('Ver cobrança');
  });

  it('billing -> "Ver cobrança"', () => {
    expect(getNotificationActionLabel('billing')).toBe('Ver cobrança');
  });

  it('desconhecido/null -> "Abrir" (fallback genérico)', () => {
    expect(getNotificationActionLabel('unknown_type')).toBe('Abrir');
    expect(getNotificationActionLabel(null)).toBe('Abrir');
  });
});

// ---------------------------------------------------------------------------
// resolveNotificationCategory / getNotificationCategoryLabel (F26-S04)
// ---------------------------------------------------------------------------

describe('resolveNotificationCategory', () => {
  it('payment_due -> billing (única categoria no catálogo p/ este entity_type)', () => {
    expect(resolveNotificationCategory('payment_due')).toBe('billing');
  });

  it('billing -> billing', () => {
    expect(resolveNotificationCategory('billing')).toBe('billing');
  });

  it('kanban_card -> lifecycle_stalled', () => {
    expect(resolveNotificationCategory('kanban_card')).toBe('lifecycle_stalled');
  });

  it('task -> system', () => {
    expect(resolveNotificationCategory('task')).toBe('system');
  });

  it('conversation -> handoff (primeira ocorrência no catálogo, ver nota de cabeçalho)', () => {
    expect(resolveNotificationCategory('conversation')).toBe('handoff');
  });

  it('entity_type desconhecido -> null', () => {
    expect(resolveNotificationCategory('unknown_type')).toBeNull();
  });

  it('entity_type null -> null', () => {
    expect(resolveNotificationCategory(null)).toBeNull();
  });
});

describe('getNotificationCategoryLabel', () => {
  it('mapeia as 6 categorias do DS para rótulos PT-BR não vazios', () => {
    for (const cat of NOTIFICATION_CATEGORIES) {
      expect(getNotificationCategoryLabel(cat).length).toBeGreaterThan(0);
    }
  });

  it('billing -> "Cobrança"', () => {
    expect(getNotificationCategoryLabel('billing')).toBe('Cobrança');
  });

  it('null -> "Geral" (fallback)', () => {
    expect(getNotificationCategoryLabel(null)).toBe('Geral');
  });
});
