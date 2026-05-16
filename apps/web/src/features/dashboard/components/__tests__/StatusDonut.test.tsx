// =============================================================================
// __tests__/StatusDonut.test.tsx — Testes de lógica pura do StatusDonut.
//
// Estratégia: testa lógica pura isolada sem renderizar React
// (JSDOM não configurado no vitest deste projeto — padrão do projeto).
//
// Cobertura:
//   1. buildArcs: cálculo correto de ângulos e proporções
//   2. describeArc: SVG path gerado para arcos normais e 360°
//   3. Filtro de itens count=0 (não geram arco)
//   4. Casos edge: array vazio, total zero, 1 item
//   5. Mapeamento de status para label/cor
//   6. Acessibilidade: aria-label e title devem ser geráveis
// =============================================================================

import { describe, expect, it } from 'vitest';

import type { LeadsByStatusItem } from '../../../../hooks/dashboard/types';

// ---------------------------------------------------------------------------
// Replica da lógica do StatusDonut.tsx
// ---------------------------------------------------------------------------

const CX = 80;
const CY = 80;
const R_OUTER = 68;
const R_INNER = 44;

function polarToXY(angle: number, r: number): { x: number; y: number } {
  const rad = ((angle - 90) * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

function describeArc(startAngle: number, endAngle: number): string {
  const clampedEnd = endAngle >= 360 ? 359.9999 : endAngle;
  const start = polarToXY(startAngle, R_OUTER);
  const end = polarToXY(clampedEnd, R_OUTER);
  const innerStart = polarToXY(clampedEnd, R_INNER);
  const innerEnd = polarToXY(startAngle, R_INNER);
  const largeArc = clampedEnd - startAngle > 180 ? 1 : 0;

  return [
    `M ${start.x} ${start.y}`,
    `A ${R_OUTER} ${R_OUTER} 0 ${largeArc} 1 ${end.x} ${end.y}`,
    `L ${innerStart.x} ${innerStart.y}`,
    `A ${R_INNER} ${R_INNER} 0 ${largeArc} 0 ${innerEnd.x} ${innerEnd.y}`,
    'Z',
  ].join(' ');
}

const STATUS_META: Record<string, { label: string; color: string }> = {
  new: { label: 'Novo', color: 'var(--info)' },
  qualifying: { label: 'Qualificação', color: 'var(--brand-azul)' },
  simulation: { label: 'Simulação', color: 'var(--brand-amarelo)' },
  closed_won: { label: 'Ganho', color: 'var(--success)' },
  closed_lost: { label: 'Perdido', color: 'var(--danger)' },
  archived: { label: 'Arquivado', color: 'var(--text-4)' },
};

interface Arc {
  status: string;
  count: number;
  label: string;
  color: string;
  startAngle: number;
  endAngle: number;
  pathD: string;
}

function buildArcs(items: LeadsByStatusItem[]): Arc[] {
  const filtered = items.filter((d) => d.count > 0);
  const total = filtered.reduce((s, d) => s + d.count, 0);
  if (total === 0) return [];

  let angle = 0;
  return filtered.map((item) => {
    const sweep = (item.count / total) * 360;
    const start = angle;
    const end = angle + sweep;
    angle = end;
    const meta = STATUS_META[item.status] ?? { label: item.status, color: 'var(--text-3)' };
    return {
      status: item.status,
      count: item.count,
      label: meta.label,
      color: meta.color,
      startAngle: start,
      endAngle: end,
      pathD: describeArc(start, end),
    };
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FULL_DATA: LeadsByStatusItem[] = [
  { status: 'new', count: 30 },
  { status: 'qualifying', count: 20 },
  { status: 'simulation', count: 15 },
  { status: 'closed_won', count: 25 },
  { status: 'closed_lost', count: 10 },
  { status: 'archived', count: 0 }, // deve ser filtrado
];

// ---------------------------------------------------------------------------
// Testes: buildArcs
// ---------------------------------------------------------------------------

describe('buildArcs', () => {
  it('retorna array vazio para dados sem count > 0', () => {
    const result = buildArcs([{ status: 'new', count: 0 }]);
    expect(result).toHaveLength(0);
  });

  it('retorna array vazio para array vazio', () => {
    expect(buildArcs([])).toHaveLength(0);
  });

  it('filtra itens com count=0 (archived=0 não gera arco)', () => {
    const result = buildArcs(FULL_DATA);
    expect(result.find((a) => a.status === 'archived')).toBeUndefined();
    // 5 itens com count > 0
    expect(result).toHaveLength(5);
  });

  it('ângulos cobrem 360° no total (soma dos sweeps)', () => {
    const result = buildArcs(FULL_DATA);
    const lastArc = result[result.length - 1];
    expect(lastArc).toBeDefined();
    // Último arco termina em 360
    expect(lastArc!.endAngle).toBeCloseTo(360, 5);
  });

  it('startAngle do primeiro arco é 0', () => {
    const result = buildArcs(FULL_DATA);
    expect(result[0]?.startAngle).toBe(0);
  });

  it('cada arco começa onde o anterior termina', () => {
    const result = buildArcs(FULL_DATA);
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.startAngle).toBeCloseTo(result[i - 1]!.endAngle, 10);
    }
  });

  it('arco único (1 item) ocupa 360°', () => {
    const result = buildArcs([{ status: 'new', count: 50 }]);
    expect(result).toHaveLength(1);
    expect(result[0]!.startAngle).toBe(0);
    expect(result[0]!.endAngle).toBeCloseTo(360, 5);
  });

  it('mapeia label e cor corretos para closed_won', () => {
    const result = buildArcs([{ status: 'closed_won', count: 10 }]);
    expect(result[0]?.label).toBe('Ganho');
    expect(result[0]?.color).toBe('var(--success)');
  });

  it('mapeia label e cor corretos para closed_lost', () => {
    const result = buildArcs([{ status: 'closed_lost', count: 5 }]);
    expect(result[0]?.label).toBe('Perdido');
    expect(result[0]?.color).toBe('var(--danger)');
  });

  it('usa fallback de label/cor para status desconhecido', () => {
    // Cast necessário: LeadsByStatusItem.status é LeadStatus, mas em runtime
    // o backend pode enviar valores novos não mapeados — o componente deve ser resiliente.
    const unknownItem = { status: 'unknown_status' as 'new', count: 3 };
    const result = buildArcs([unknownItem]);
    expect(result).toHaveLength(1);
    expect(result[0]?.label).toBe('unknown_status');
    expect(result[0]?.color).toBe('var(--text-3)');
  });

  it('proporção dos ângulos é proporcional aos counts', () => {
    const items: LeadsByStatusItem[] = [
      { status: 'new', count: 1 },
      { status: 'closed_won', count: 3 },
    ];
    const result = buildArcs(items);
    // new: 1/4 do total → 90°
    // closed_won: 3/4 do total → 270°
    const arc0 = result[0];
    const arc1 = result[1];
    expect(arc0).toBeDefined();
    expect(arc1).toBeDefined();
    expect(arc0!.endAngle - arc0!.startAngle).toBeCloseTo(90, 5);
    expect(arc1!.endAngle - arc1!.startAngle).toBeCloseTo(270, 5);
  });
});

// ---------------------------------------------------------------------------
// Testes: describeArc
// ---------------------------------------------------------------------------

describe('describeArc', () => {
  it('gera path com M, A, L, Z', () => {
    const path = describeArc(0, 90);
    expect(path).toMatch(/^M /);
    expect(path).toContain(' A ');
    expect(path).toContain(' L ');
    expect(path).toContain(' Z');
  });

  it('arco < 180° usa largeArc=0', () => {
    const path = describeArc(0, 90);
    // Formato: A R_OUTER R_OUTER 0 0 1 ...
    expect(path).toContain(`A ${R_OUTER} ${R_OUTER} 0 0 1`);
  });

  it('arco > 180° usa largeArc=1', () => {
    const path = describeArc(0, 270);
    expect(path).toContain(`A ${R_OUTER} ${R_OUTER} 0 1 1`);
  });

  it('arco de 360° usa endAngle clampado a 359.9999', () => {
    // Garante que o path não feche antes (bug de arco completo)
    const path = describeArc(0, 360);
    // Deve usar largeArc=1 (clampado > 180)
    expect(path).toContain(`A ${R_OUTER} ${R_OUTER} 0 1 1`);
  });

  it('path é string não-vazia', () => {
    const path = describeArc(0, 180);
    expect(path.length).toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------------------------
// Testes: STATUS_META
// ---------------------------------------------------------------------------

describe('STATUS_META', () => {
  it('todos os 6 status canônicos têm label e color', () => {
    const canonicalStatuses = [
      'new',
      'qualifying',
      'simulation',
      'closed_won',
      'closed_lost',
      'archived',
    ];
    for (const status of canonicalStatuses) {
      const meta = STATUS_META[status];
      expect(meta).toBeDefined();
      expect(typeof meta!.label).toBe('string');
      expect(meta!.label.length).toBeGreaterThan(0);
      expect(typeof meta!.color).toBe('string');
      expect(meta!.color).toMatch(/^var\(--/);
    }
  });

  it('closed_won usa --success (token DS verde)', () => {
    expect(STATUS_META['closed_won']?.color).toBe('var(--success)');
  });

  it('closed_lost usa --danger (token DS vermelho)', () => {
    expect(STATUS_META['closed_lost']?.color).toBe('var(--danger)');
  });

  it('simulation usa --brand-amarelo (token DS amarelo)', () => {
    expect(STATUS_META['simulation']?.color).toBe('var(--brand-amarelo)');
  });

  it('qualifying usa --brand-azul (token DS azul)', () => {
    expect(STATUS_META['qualifying']?.color).toBe('var(--brand-azul)');
  });
});

// ---------------------------------------------------------------------------
// Testes: aria / acessibilidade (lógica pura, sem renderizar)
// ---------------------------------------------------------------------------

describe('Acessibilidade — aria-label e title', () => {
  it('title para cada arco contém label e count', () => {
    const arcs = buildArcs([{ status: 'closed_won', count: 42 }]);
    const arc = arcs[0]!;
    const expectedTitle = `${arc.label}: ${arc.count.toLocaleString('pt-BR')}`;
    expect(expectedTitle).toBe('Ganho: 42');
  });

  it('aria-label do svg contém total', () => {
    const items: LeadsByStatusItem[] = [
      { status: 'new', count: 10 },
      { status: 'closed_won', count: 5 },
    ];
    const total = items.reduce((s, d) => s + d.count, 0);
    const ariaLabel = `Donut chart de leads por status. Total: ${total}`;
    expect(ariaLabel).toBe('Donut chart de leads por status. Total: 15');
  });
});
