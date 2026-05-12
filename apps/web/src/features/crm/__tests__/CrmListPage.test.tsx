// =============================================================================
// CrmListPage.test.tsx — Testes unitários do módulo CRM (lista).
//
// Estratégia: testa lógica pura isolada (formatadores, derivações, filtros)
// sem renderizar React (JSDOM não configurado no vitest deste projeto).
//
// Cobertura:
//   1. maskPhone: LGPD — formato correto, nunca expõe dígitos completos
//   2. truncateEmail: LGPD — truncamento em listagens
//   3. STATUS_META: mapeamento status→variante completo
//   4. Filtros: query string derivada dos filtros
//   5. Paginação: cálculo de range de itens exibidos
//   6. avatarVariantForName: determinístico
//   7. Stats: cálculo de conversão
// =============================================================================

import { describe, expect, it } from 'vitest';

import type { LeadFilters, LeadResponse } from '../../../hooks/crm/types';
import {
  maskPhone,
  truncateEmail,
  formatDate,
  STATUS_META,
  SOURCE_LABEL,
} from '../../../hooks/crm/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_LEADS: LeadResponse[] = [
  {
    id: 'lead-001',
    organization_id: 'org-001',
    city_id: 'city-001',
    agent_id: 'agent-001',
    name: 'Ana Paula Ferreira',
    phone_e164: '+5569912341234',
    source: 'whatsapp',
    status: 'qualifying',
    email: 'anapaula.ferreira@gmail.com',
    notes: 'Notas do lead',
    metadata: {},
    created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    updated_at: new Date(Date.now() - 1 * 86_400_000).toISOString(),
    deleted_at: null,
  },
  {
    id: 'lead-002',
    organization_id: 'org-001',
    city_id: 'city-001',
    agent_id: null,
    name: 'Carlos Eduardo Mendes',
    phone_e164: '+5511987654321',
    source: 'manual',
    status: 'closed_won',
    email: null,
    notes: null,
    metadata: {},
    created_at: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    updated_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    deleted_at: null,
  },
  {
    id: 'lead-003',
    organization_id: 'org-001',
    city_id: 'city-002',
    agent_id: 'agent-002',
    name: 'Fernanda Lima',
    phone_e164: '+5592999991111',
    source: 'import',
    status: 'new',
    email: 'fernanda.lima@hotmail.com',
    notes: null,
    metadata: {},
    created_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    updated_at: new Date(Date.now() - 10 * 86_400_000).toISOString(),
    deleted_at: null,
  },
];

// ── Helpers puros (espelham lógica da CrmListPage) ────────────────────────────

function buildFiltersQueryString(filters: LeadFilters): string {
  const params = new URLSearchParams();
  if (filters.page !== undefined) params.set('page', String(filters.page));
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.search) params.set('search', filters.search);
  if (filters.status) params.set('status', filters.status);
  if (filters.city_id) params.set('city_id', filters.city_id);
  if (filters.agent_id) params.set('agent_id', filters.agent_id);
  return params.toString();
}

function computePaginationRange(page: number, limit: number, total: number): string {
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  return `${from}–${to} de ${total}`;
}

function computeStats(leads: LeadResponse[], total: number) {
  const now = new Date();
  const newThisMonth = leads.filter((l) => {
    const created = new Date(l.created_at);
    return created.getMonth() === now.getMonth() && created.getFullYear() === now.getFullYear();
  }).length;
  const qualifying = leads.filter((l) => l.status === 'qualifying').length;
  const closedWon = leads.filter((l) => l.status === 'closed_won').length;
  const conversionRate = total > 0 ? Math.round((closedWon / total) * 100) : 0;
  return { total, newThisMonth, qualifying, conversionRate };
}

// ─── LGPD: maskPhone ──────────────────────────────────────────────────────────

describe('maskPhone — LGPD mascaramento de telefone', () => {
  it('formata +5511999991234 → +55 11 ****-1234', () => {
    expect(maskPhone('+5511999991234')).toBe('+55 11 ****-1234');
  });

  it('formata +5569987654321 → +55 69 ****-4321', () => {
    expect(maskPhone('+5569987654321')).toBe('+55 69 ****-4321');
  });

  it('nunca expõe todos os dígitos do telefone', () => {
    for (const lead of MOCK_LEADS) {
      const masked = maskPhone(lead.phone_e164);
      // Deve conter ****
      expect(masked).toContain('****');
      // Não deve expor os dígitos centrais (posições 4-9)
      const rawDigits = lead.phone_e164.replace(/\D/g, '');
      const middleDigits = rawDigits.slice(4, -4);
      expect(masked).not.toContain(middleDigits);
    }
  });

  it('retorna **** para telefone inválido/curto', () => {
    expect(maskPhone('+55')).toBe('****');
  });

  it('sempre segue o padrão +CC NN ****-DDDD', () => {
    for (const lead of MOCK_LEADS) {
      const masked = maskPhone(lead.phone_e164);
      expect(masked).toMatch(/^\+\d{2}\s\d{2}\s\*{4}-\d{4}$/);
    }
  });
});

// ─── LGPD: truncateEmail ──────────────────────────────────────────────────────

describe('truncateEmail — LGPD truncamento em listagens', () => {
  it('trunca anapaula.ferreira@gmail.com → anap***@gmail.com', () => {
    expect(truncateEmail('anapaula.ferreira@gmail.com')).toBe('anap***@gmail.com');
  });

  it('trunca a@b.com → a***@b.com', () => {
    expect(truncateEmail('a@b.com')).toBe('a***@b.com');
  });

  it('sempre mantém o domínio visível', () => {
    const result = truncateEmail('fernanda.lima@hotmail.com');
    expect(result).toContain('@hotmail.com');
  });

  it('nunca expõe o local completo quando > 4 chars', () => {
    const email = 'superlong.email@domain.com';
    const result = truncateEmail(email);
    // Máximo 4 chars do local aparecem
    const local = result.split('@')[0]!.replace('***', '');
    expect(local.length).toBeLessThanOrEqual(4);
  });

  it('email inválido (sem @) retorna ***@***', () => {
    expect(truncateEmail('invalidemail')).toBe('***@***');
  });
});

// ─── STATUS_META ──────────────────────────────────────────────────────────────

describe('STATUS_META — mapeamento completo de status', () => {
  const expectedStatuses = [
    'new',
    'qualifying',
    'simulation',
    'closed_won',
    'closed_lost',
    'archived',
  ] as const;

  it('todos os status têm label e variante', () => {
    for (const status of expectedStatuses) {
      expect(STATUS_META[status]).toBeDefined();
      expect(STATUS_META[status].label).toBeTruthy();
      expect(STATUS_META[status].variant).toBeTruthy();
    }
  });

  it('closed_won → variante success', () => {
    expect(STATUS_META['closed_won'].variant).toBe('success');
  });

  it('closed_lost → variante danger', () => {
    expect(STATUS_META['closed_lost'].variant).toBe('danger');
  });

  it('qualifying → variante info', () => {
    expect(STATUS_META['qualifying'].variant).toBe('info');
  });

  it('simulation → variante warning', () => {
    expect(STATUS_META['simulation'].variant).toBe('warning');
  });

  it('new → variante neutral', () => {
    expect(STATUS_META['new'].variant).toBe('neutral');
  });
});

// ─── SOURCE_LABEL ─────────────────────────────────────────────────────────────

describe('SOURCE_LABEL — labels de canal', () => {
  it('whatsapp → WhatsApp', () => {
    expect(SOURCE_LABEL['whatsapp']).toBe('WhatsApp');
  });

  it('manual → Manual', () => {
    expect(SOURCE_LABEL['manual']).toBe('Manual');
  });

  it('import → Importação', () => {
    expect(SOURCE_LABEL['import']).toBe('Importação');
  });
});

// ─── Filtros ──────────────────────────────────────────────────────────────────

describe('buildFiltersQueryString — derivação de query params', () => {
  it('filtros vazios → string vazia', () => {
    expect(buildFiltersQueryString({})).toBe('');
  });

  it('página e limite', () => {
    const qs = buildFiltersQueryString({ page: 2, limit: 10 });
    expect(qs).toContain('page=2');
    expect(qs).toContain('limit=10');
  });

  it('filtro por status', () => {
    const qs = buildFiltersQueryString({ status: 'qualifying' });
    expect(qs).toContain('status=qualifying');
  });

  it('filtro por busca', () => {
    const qs = buildFiltersQueryString({ search: 'Ana' });
    expect(qs).toContain('search=Ana');
  });

  it('filtro por cidade', () => {
    const qs = buildFiltersQueryString({ city_id: 'city-001' });
    expect(qs).toContain('city_id=city-001');
  });

  it('múltiplos filtros combinados', () => {
    const qs = buildFiltersQueryString({
      page: 1,
      status: 'new',
      search: 'Carlos',
    });
    expect(qs).toContain('page=1');
    expect(qs).toContain('status=new');
    expect(qs).toContain('search=Carlos');
  });
});

// ─── Paginação ────────────────────────────────────────────────────────────────

describe('computePaginationRange — range de itens', () => {
  it('página 1 de 20, total 100 → 1–20 de 100', () => {
    expect(computePaginationRange(1, 20, 100)).toBe('1–20 de 100');
  });

  it('página 2 de 20, total 35 → 21–35 de 35 (última página parcial)', () => {
    expect(computePaginationRange(2, 20, 35)).toBe('21–35 de 35');
  });

  it('página 1 de 5, total 3 → 1–3 de 3', () => {
    expect(computePaginationRange(1, 5, 3)).toBe('1–3 de 3');
  });
});

// ─── Stats ────────────────────────────────────────────────────────────────────

describe('computeStats — cálculo de KPIs', () => {
  it('total correto', () => {
    const stats = computeStats(MOCK_LEADS, MOCK_LEADS.length);
    expect(stats.total).toBe(3);
  });

  it('qualifying count', () => {
    const stats = computeStats(MOCK_LEADS, MOCK_LEADS.length);
    expect(stats.qualifying).toBe(1);
  });

  it('taxa de conversão: 1 closed_won de 3 → 33%', () => {
    const stats = computeStats(MOCK_LEADS, MOCK_LEADS.length);
    expect(stats.conversionRate).toBe(33);
  });

  it('sem leads → conversionRate 0', () => {
    const stats = computeStats([], 0);
    expect(stats.conversionRate).toBe(0);
  });
});

// ─── LGPD: sem CPF na UI ──────────────────────────────────────────────────────

describe('LGPD — CPF nunca exposto em campos visíveis', () => {
  it('nenhum campo visível de lead contém CPF', () => {
    for (const lead of MOCK_LEADS) {
      const visibleFields = [
        lead.name,
        maskPhone(lead.phone_e164),
        lead.email ? truncateEmail(lead.email) : '',
        lead.notes ?? '',
        SOURCE_LABEL[lead.source] ?? lead.source,
      ];
      for (const field of visibleFields) {
        // CPF formato NNN.NNN.NNN-NN ou 11 dígitos consecutivos
        expect(field).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}/);
        expect(field).not.toMatch(/\d{11}/);
      }
    }
  });
});

// ─── formatDate ───────────────────────────────────────────────────────────────

describe('formatDate — formatação de datas', () => {
  it('retorna string não-vazia para ISO válido', () => {
    const result = formatDate('2026-05-12T00:00:00.000Z');
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });

  it('contém o ano', () => {
    const result = formatDate('2026-05-12T00:00:00.000Z');
    expect(result).toContain('2026');
  });
});
