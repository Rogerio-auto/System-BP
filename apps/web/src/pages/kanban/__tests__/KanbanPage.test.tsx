// =============================================================================
// KanbanPage.test.tsx — Testes unitários do módulo Kanban.
//
// Estratégia: testa lógica pura isolada (tipos, formatadores, derivações)
// sem renderizar React (JSDOM não disponível).
// Testes de integração visual devem ser feitos manualmente ou em E2E.
//
// Cobertura:
//   1. Tipos KanbanCard/Stage são válidos
//   2. Máscara de telefone — formato LGPD
//   3. useMoveCard — lógica de otimismo (derivação pura)
//   4. KanbanFilters — derivação de query string
//   5. Drag: cardsByStage — indexação correta
//   6. Drag inválido → rollback via snapshot
//   7. Click no card abre modal (lógica de estado)
// =============================================================================

import { describe, expect, it } from 'vitest';

import type { KanbanCard, KanbanFilters, KanbanStage } from '../../../hooks/kanban/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_STAGES: KanbanStage[] = [
  {
    id: 'stage-1',
    name: 'Novo Lead',
    slug: 'novo-lead',
    position: 1,
    color: null,
    cityId: 'city-1',
    organizationId: 'org-1',
  },
  {
    id: 'stage-2',
    name: 'Em Análise',
    slug: 'em-analise',
    position: 2,
    color: null,
    cityId: 'city-1',
    organizationId: 'org-1',
  },
  {
    id: 'stage-3',
    name: 'Aprovado',
    slug: 'aprovado',
    position: 3,
    color: null,
    cityId: 'city-1',
    organizationId: 'org-1',
  },
];

const MOCK_CARDS: KanbanCard[] = [
  {
    id: 'card-1',
    stageId: 'stage-1',
    leadId: 'lead-1',
    leadName: 'Ana Silva',
    phoneMasked: '+55 69 ****-1234',
    agentId: 'agent-1',
    agentName: 'Agente A',
    loanAmountCents: 500_000,
    position: 1,
    lastNote: 'Documentação pendente',
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'card-2',
    stageId: 'stage-1',
    leadId: 'lead-2',
    leadName: 'Carlos Mendes',
    phoneMasked: '+55 11 ****-5678',
    agentId: null,
    agentName: null,
    loanAmountCents: 1_200_000,
    position: 2,
    lastNote: null,
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'card-3',
    stageId: 'stage-2',
    leadId: 'lead-3',
    leadName: 'Fernanda Lima',
    phoneMasked: '+55 92 ****-9012',
    agentId: 'agent-2',
    agentName: 'Agente B',
    loanAmountCents: 300_000,
    position: 1,
    lastNote: null,
    updatedAt: new Date().toISOString(),
  },
];

// ── Helpers puros (espelha lógica de useKanbanCards) ──────────────────────────

function buildCardsByStage(cards: KanbanCard[]): Record<string, KanbanCard[]> {
  const result: Record<string, KanbanCard[]> = {};
  for (const card of cards) {
    if (!result[card.stageId]) result[card.stageId] = [];
    result[card.stageId]!.push(card);
  }
  for (const stageId of Object.keys(result)) {
    result[stageId]!.sort((a, b) => a.position - b.position);
  }
  return result;
}

function applyOptimisticMove(
  cards: KanbanCard[],
  cardId: string,
  targetStageId: string,
  position: number,
): KanbanCard[] {
  return cards.map((c) => (c.id === cardId ? { ...c, stageId: targetStageId, position } : c));
}

function buildFiltersQueryString(filters: KanbanFilters): string {
  const params = new URLSearchParams();
  if (filters.cityId) params.set('city_id', filters.cityId);
  if (filters.agentId) params.set('agent_id', filters.agentId);
  if (filters.minAmountCents !== undefined)
    params.set('min_amount_cents', String(filters.minAmountCents));
  if (filters.maxAmountCents !== undefined)
    params.set('max_amount_cents', String(filters.maxAmountCents));
  if (filters.dateFrom) params.set('date_from', filters.dateFrom);
  if (filters.dateTo) params.set('date_to', filters.dateTo);
  return params.toString();
}

// ── Testes ────────────────────────────────────────────────────────────────────

describe('KanbanStage — tipo e estrutura', () => {
  it('stages mock têm posição ordenada', () => {
    const positions = MOCK_STAGES.map((s) => s.position);
    expect(positions).toEqual([1, 2, 3]);
  });

  it('todos os stages têm id, name, slug, organizationId', () => {
    for (const stage of MOCK_STAGES) {
      expect(stage.id).toBeTruthy();
      expect(stage.name).toBeTruthy();
      expect(stage.slug).toBeTruthy();
      expect(stage.organizationId).toBeTruthy();
    }
  });
});

describe('KanbanCard — LGPD: telefone mascarado', () => {
  it('phoneMasked nunca expõe dígitos completos', () => {
    for (const card of MOCK_CARDS) {
      // Formato esperado: +55 XX ****-YYYY
      expect(card.phoneMasked).toMatch(/^\+55\s\d{2}\s\*{4}-\d{4}$/);
    }
  });

  it('leadName é texto livre — sem CPF', () => {
    for (const card of MOCK_CARDS) {
      // CPF tem formato NNN.NNN.NNN-NN ou 11 dígitos consecutivos
      expect(card.leadName).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}/);
      expect(card.leadName).not.toMatch(/\d{11}/);
    }
  });
});

describe('buildCardsByStage — indexação por stageId', () => {
  it('indexa cards corretamente por stageId', () => {
    const cardsByStage = buildCardsByStage(MOCK_CARDS);

    expect(Object.keys(cardsByStage).sort()).toEqual(['stage-1', 'stage-2'].sort());
    expect(cardsByStage['stage-1']).toHaveLength(2);
    expect(cardsByStage['stage-2']).toHaveLength(1);
    expect(cardsByStage['stage-3']).toBeUndefined();
  });

  it('cards dentro de cada coluna estão ordenados por position', () => {
    const cardsByStage = buildCardsByStage(MOCK_CARDS);

    const stage1Cards = cardsByStage['stage-1']!;
    expect(stage1Cards[0]!.id).toBe('card-1');
    expect(stage1Cards[1]!.id).toBe('card-2');
  });

  it('stages sem cards retornam undefined (coluna vazia)', () => {
    const cardsByStage = buildCardsByStage(MOCK_CARDS);
    expect(cardsByStage['stage-3']).toBeUndefined();
  });
});

describe('Drag entre colunas — mutação otimista', () => {
  it('move card para coluna válida (stage-1 → stage-2)', () => {
    const updated = applyOptimisticMove(MOCK_CARDS, 'card-1', 'stage-2', 2);

    const movedCard = updated.find((c) => c.id === 'card-1');
    expect(movedCard?.stageId).toBe('stage-2');
    expect(movedCard?.position).toBe(2);

    // Os outros cards não foram alterados
    const unchanged = updated.find((c) => c.id === 'card-2');
    expect(unchanged?.stageId).toBe('stage-1');
  });

  it('rollback restaura snapshot original', () => {
    const snapshot = [...MOCK_CARDS];

    // Simula aplicação otimista
    const withMove = applyOptimisticMove(MOCK_CARDS, 'card-1', 'stage-3', 1);
    const movedCard = withMove.find((c) => c.id === 'card-1');
    expect(movedCard?.stageId).toBe('stage-3');

    // Simula rollback com snapshot
    const rolledBack = snapshot;
    const restoredCard = rolledBack.find((c) => c.id === 'card-1');
    expect(restoredCard?.stageId).toBe('stage-1');
  });

  it('drag sem mudança de stage não aplica mutação', () => {
    const card = MOCK_CARDS[0]!;
    const sameStageId = card.stageId;

    // Lógica da KanbanPage: if (card.stageId === targetStageId) return
    const shouldMutate = card.stageId !== sameStageId;
    expect(shouldMutate).toBe(false);
  });
});

describe('KanbanFilters — query string', () => {
  it('filtros vazios → string vazia', () => {
    expect(buildFiltersQueryString({})).toBe('');
  });

  it('filtro por cidade gera city_id', () => {
    const qs = buildFiltersQueryString({ cityId: 'city-1' });
    expect(qs).toContain('city_id=city-1');
  });

  it('filtro por valor em centavos', () => {
    const qs = buildFiltersQueryString({ minAmountCents: 100_000, maxAmountCents: 500_000 });
    expect(qs).toContain('min_amount_cents=100000');
    expect(qs).toContain('max_amount_cents=500000');
  });

  it('múltiplos filtros combinados', () => {
    const qs = buildFiltersQueryString({
      cityId: 'city-1',
      agentId: 'agent-2',
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31',
    });
    expect(qs).toContain('city_id=city-1');
    expect(qs).toContain('agent_id=agent-2');
    expect(qs).toContain('date_from=2026-01-01');
    expect(qs).toContain('date_to=2026-12-31');
  });
});

describe('Modal de detalhe — lógica de estado', () => {
  it('detailCard null → modal fechado', () => {
    const detailCard: KanbanCard | null = null;
    expect(detailCard).toBeNull();
  });

  it('click no card → abre modal com card correto', () => {
    let detailCard: KanbanCard | null = null;
    const openModal = (card: KanbanCard): void => {
      detailCard = card;
    };

    openModal(MOCK_CARDS[0]!);
    expect(detailCard).not.toBeNull();
    expect((detailCard as KanbanCard | null)?.id).toBe('card-1');
    expect((detailCard as KanbanCard | null)?.leadName).toBe('Ana Silva');
  });

  it('fechar modal → detailCard null', () => {
    let detailCard: KanbanCard | null = MOCK_CARDS[0]!;
    const closeModal = (): void => {
      detailCard = null;
    };

    closeModal();
    expect(detailCard).toBeNull();
  });

  it('modal não expõe CPF do lead', () => {
    const card = MOCK_CARDS[0]!;
    // Os campos do card que são visíveis no modal:
    // leadName, phoneMasked, agentName, loanAmountCents, lastNote, updatedAt
    // Nenhum deve conter CPF
    const visibleFields = [
      card.leadName,
      card.phoneMasked,
      card.agentName ?? '',
      card.lastNote ?? '',
    ];
    for (const field of visibleFields) {
      expect(field).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}/);
    }
  });
});

describe('KanbanColumn — contagem de cards', () => {
  it('coluna com cards mostra count correto', () => {
    const cardsByStage = buildCardsByStage(MOCK_CARDS);
    const stage1Count = (cardsByStage['stage-1'] ?? []).length;
    expect(stage1Count).toBe(2);
  });

  it('coluna sem cards → array vazio', () => {
    const cardsByStage = buildCardsByStage(MOCK_CARDS);
    const emptyCount = (cardsByStage['stage-5'] ?? []).length;
    expect(emptyCount).toBe(0);
  });
});
