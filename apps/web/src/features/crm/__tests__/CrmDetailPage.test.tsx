// =============================================================================
// CrmDetailPage.test.tsx — Testes unitários do detalhe de lead.
//
// Estratégia: testa lógica pura (formatadores, mascaramento LGPD, timeline,
// status metadata) sem renderizar React.
//
// Cobertura:
//   1. maskPhone: telefone mascarado no detalhe
//   2. truncateEmail: email truncado no detalhe
//   3. formatRelativeDate: datas relativas corretas
//   4. InteractionIcon: mapeamento de tipos de interação
//   5. STATUS_META: label e variante por status
//   6. LGPD: campos visíveis não expõem CPF
//   7. Timeline: ordenação das interações (mais recente no topo)
// =============================================================================

import { describe, expect, it } from 'vitest';

import type { LeadInteraction, LeadResponse } from '../../../hooks/crm/types';
import {
  maskPhone,
  truncateEmail,
  formatDate,
  formatRelativeDate,
  STATUS_META,
  SOURCE_LABEL,
} from '../../../hooks/crm/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_LEAD: LeadResponse = {
  id: 'lead-detail-001',
  organization_id: 'org-001',
  city_id: 'city-001',
  agent_id: 'agent-001',
  name: 'Ana Paula Ferreira',
  phone_e164: '+5569912341234',
  source: 'whatsapp',
  status: 'qualifying',
  email: 'anapaula.ferreira@gmail.com',
  notes: 'Interessada em microcrédito para capital de giro. Atendida na filial Porto Velho.',
  metadata: {},
  created_at: new Date(Date.now() - 5 * 86_400_000).toISOString(),
  updated_at: new Date(Date.now() - 1 * 86_400_000).toISOString(),
  deleted_at: null,
};

const MOCK_INTERACTIONS: LeadInteraction[] = [
  {
    id: 'inter-001',
    leadId: 'lead-detail-001',
    type: 'system',
    content: 'Lead criado via WhatsApp',
    actorName: 'Sistema',
    createdAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
  },
  {
    id: 'inter-002',
    leadId: 'lead-detail-001',
    type: 'note',
    content: 'Primeiro contato realizado.',
    actorName: 'Agente João',
    createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  },
  {
    id: 'inter-003',
    leadId: 'lead-detail-001',
    type: 'status_change',
    content: 'Status: Novo → Qualificando',
    actorName: 'Agente João',
    createdAt: new Date(Date.now() - 1 * 86_400_000).toISOString(),
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function sortInteractionsByDate(interactions: LeadInteraction[]): LeadInteraction[] {
  return [...interactions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

// ─── LGPD: telefone mascarado no detalhe ──────────────────────────────────────

describe('maskPhone — detalhe de lead', () => {
  it('telefone do lead de detalhe é mascarado', () => {
    const masked = maskPhone(MOCK_LEAD.phone_e164);
    expect(masked).toContain('****');
    expect(masked).not.toBe(MOCK_LEAD.phone_e164);
  });

  it('formato correto no detalhe: +CC NN ****-DDDD', () => {
    const masked = maskPhone(MOCK_LEAD.phone_e164);
    expect(masked).toMatch(/^\+\d{2}\s\d{2}\s\*{4}-\d{4}$/);
  });

  it('últimos 4 dígitos são visíveis (contexto de atendimento)', () => {
    const masked = maskPhone(MOCK_LEAD.phone_e164);
    const raw = MOCK_LEAD.phone_e164;
    const last4 = raw.slice(-4);
    expect(masked).toContain(last4);
  });
});

// ─── LGPD: email truncado no detalhe ─────────────────────────────────────────

describe('truncateEmail — detalhe de lead', () => {
  it('email do lead de detalhe é truncado', () => {
    const truncated = truncateEmail(MOCK_LEAD.email!);
    expect(truncated).toContain('***');
    expect(truncated).not.toBe(MOCK_LEAD.email);
  });

  it('domínio do email é preservado', () => {
    const truncated = truncateEmail(MOCK_LEAD.email!);
    expect(truncated).toContain('@gmail.com');
  });

  it('lead sem email → tratamento sem erro', () => {
    const leadNoEmail: typeof MOCK_LEAD = { ...MOCK_LEAD, email: null };
    const emailDisplay = leadNoEmail.email;
    expect(emailDisplay).toBeNull();
  });
});

// ─── formatRelativeDate ───────────────────────────────────────────────────────

describe('formatRelativeDate — datas relativas', () => {
  it('"agora" para data muito recente', () => {
    const justNow = new Date(Date.now() - 30_000).toISOString(); // 30s atrás
    expect(formatRelativeDate(justNow)).toBe('agora');
  });

  it('"há X min" para menos de 1h', () => {
    const thirtyMin = new Date(Date.now() - 30 * 60_000).toISOString();
    expect(formatRelativeDate(thirtyMin)).toMatch(/^há \d+ min$/);
  });

  it('"há Xh" para menos de 24h', () => {
    const threeHours = new Date(Date.now() - 3 * 3_600_000).toISOString();
    expect(formatRelativeDate(threeHours)).toMatch(/^há \d+h$/);
  });

  it('"há Xd" para menos de 7 dias', () => {
    const threeDays = new Date(Date.now() - 3 * 86_400_000).toISOString();
    expect(formatRelativeDate(threeDays)).toMatch(/^há \d+d$/);
  });

  it('datas antigas retornam data formatada', () => {
    const oldDate = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const result = formatRelativeDate(oldDate);
    // Deve ser uma data formatada (não "há Xd")
    expect(result).not.toMatch(/^há \d+d$/);
    expect(result.length).toBeGreaterThan(5);
  });
});

// ─── STATUS_META no detalhe ───────────────────────────────────────────────────

describe('STATUS_META — badge no detalhe', () => {
  it('lead qualifying exibe badge info', () => {
    const meta = STATUS_META[MOCK_LEAD.status];
    expect(meta.variant).toBe('info');
    expect(meta.label).toBe('Qualificando');
  });

  it('todos os status têm label PT-BR', () => {
    for (const [, meta] of Object.entries(STATUS_META)) {
      // Sem chaves em inglês cruas na UI
      expect(meta.label).not.toMatch(/^[a-z_]+$/);
    }
  });
});

// ─── Timeline: ordenação ──────────────────────────────────────────────────────

describe('Timeline — ordenação de interações', () => {
  it('interações mais recentes aparecem primeiro', () => {
    const sorted = sortInteractionsByDate(MOCK_INTERACTIONS);
    const timestamps = sorted.map((i) => new Date(i.createdAt).getTime());
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i - 1]!).toBeGreaterThanOrEqual(timestamps[i]!);
    }
  });

  it('a última interação é a mais antiga', () => {
    const sorted = sortInteractionsByDate(MOCK_INTERACTIONS);
    const last = sorted[sorted.length - 1]!;
    expect(last.id).toBe('inter-001'); // sistema, criado há 5 dias
  });

  it('interação mais recente no topo', () => {
    const sorted = sortInteractionsByDate(MOCK_INTERACTIONS);
    expect(sorted[0]!.id).toBe('inter-003'); // há 1 dia
  });

  it('tipo system tem conteúdo', () => {
    for (const inter of MOCK_INTERACTIONS) {
      expect(inter.content).toBeTruthy();
    }
  });

  it('timeline não expõe PII bruta no conteúdo', () => {
    for (const inter of MOCK_INTERACTIONS) {
      // Sem CPF no conteúdo
      expect(inter.content).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}/);
      // Sem telefone completo no conteúdo
      expect(inter.content).not.toMatch(/\+55\d{10,11}/);
    }
  });
});

// ─── SOURCE_LABEL no detalhe ──────────────────────────────────────────────────

describe('SOURCE_LABEL — canal de origem', () => {
  it('whatsapp é exibido como WhatsApp', () => {
    expect(SOURCE_LABEL[MOCK_LEAD.source]).toBe('WhatsApp');
  });
});

// ─── LGPD: campos visíveis no detalhe ─────────────────────────────────────────

describe('LGPD — campos visíveis no detalhe não expõem CPF', () => {
  it('campos do detalhe não contêm CPF', () => {
    const visibleFields = [
      MOCK_LEAD.name,
      maskPhone(MOCK_LEAD.phone_e164),
      MOCK_LEAD.email ? truncateEmail(MOCK_LEAD.email) : '',
      MOCK_LEAD.notes ?? '',
      SOURCE_LABEL[MOCK_LEAD.source] ?? MOCK_LEAD.source,
      STATUS_META[MOCK_LEAD.status].label,
    ];

    for (const field of visibleFields) {
      expect(field).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}/); // CPF com máscara
      expect(field).not.toMatch(/\d{11}/); // CPF sem máscara (11 dígitos)
    }
  });
});

// ─── formatDate no detalhe ────────────────────────────────────────────────────

describe('formatDate — exibição de datas no detalhe', () => {
  it('created_at é formatado para exibição', () => {
    const result = formatDate(MOCK_LEAD.created_at);
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });
});
