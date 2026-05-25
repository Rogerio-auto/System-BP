// =============================================================================
// credit-analyses.test.ts — Testes do módulo de análise de crédito (F4-S03).
//
// Estratégia: pure logic sem render React (mesmo padrão do projeto).
//
// Coverage:
//   1. ANALYSIS_STATUS_META — mapeamento status → label + variante de badge
//   2. DECIDABLE_STATUSES — status que permitem decisão
//   3. CreditAnalysisCreateFormSchema — validação Zod (DLP incluso)
//   4. CreditAnalysisVersionFormSchema — validação status + parecer
//   5. CreditAnalysisDecideFormSchema — validação decisão
//   6. CREDIT_ANALYSES_KEYS — query keys canônicas
//   7. buildQueryString (via api.ts) — construção de query params
// =============================================================================

import { describe, expect, it } from 'vitest';

import { CREDIT_ANALYSES_KEYS } from '../hooks/useCreditAnalyses';
import {
  ANALYSIS_STATUS_META,
  CreditAnalysisCreateFormSchema,
  CreditAnalysisDecideFormSchema,
  CreditAnalysisRequestReviewFormSchema,
  CreditAnalysisStatusSchema,
  CreditAnalysisVersionFormSchema,
  DECIDABLE_STATUSES,
} from '../schemas';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const VALID_PARECER =
  'Análise realizada. Cliente demonstrou capacidade de pagamento adequada para o valor solicitado.';
const CPF_PARECER = 'Cliente com CPF 123.456.789-09 aprovado.';
const RG_PARECER = 'Documento RG 1.234.567-8 verificado.';

// ─── ANALYSIS_STATUS_META ────────────────────────────────────────────────────

describe('ANALYSIS_STATUS_META', () => {
  it('covers all 5 status values', () => {
    const allStatuses = CreditAnalysisStatusSchema.options;
    for (const status of allStatuses) {
      expect(ANALYSIS_STATUS_META).toHaveProperty(status);
    }
  });

  it('maps em_analise → info', () => {
    expect(ANALYSIS_STATUS_META.em_analise.variant).toBe('info');
    expect(ANALYSIS_STATUS_META.em_analise.label).toBeTruthy();
  });

  it('maps pendente → warning', () => {
    expect(ANALYSIS_STATUS_META.pendente.variant).toBe('warning');
  });

  it('maps aprovado → success', () => {
    expect(ANALYSIS_STATUS_META.aprovado.variant).toBe('success');
  });

  it('maps recusado → danger', () => {
    expect(ANALYSIS_STATUS_META.recusado.variant).toBe('danger');
  });

  it('maps cancelado → neutral', () => {
    expect(ANALYSIS_STATUS_META.cancelado.variant).toBe('neutral');
  });
});

// ─── DECIDABLE_STATUSES ───────────────────────────────────────────────────────

describe('DECIDABLE_STATUSES', () => {
  it('includes em_analise and pendente', () => {
    expect(DECIDABLE_STATUSES).toContain('em_analise');
    expect(DECIDABLE_STATUSES).toContain('pendente');
  });

  it('excludes aprovado, recusado and cancelado', () => {
    expect(DECIDABLE_STATUSES).not.toContain('aprovado');
    expect(DECIDABLE_STATUSES).not.toContain('recusado');
    expect(DECIDABLE_STATUSES).not.toContain('cancelado');
  });
});

// ─── CreditAnalysisCreateFormSchema ──────────────────────────────────────────

describe('CreditAnalysisCreateFormSchema', () => {
  const BASE = {
    lead_id: 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa',
    parecer_text: VALID_PARECER,
    status: 'em_analise' as const,
    pendencias: [],
  };

  it('accepts valid creation payload', () => {
    const result = CreditAnalysisCreateFormSchema.safeParse(BASE);
    expect(result.success).toBe(true);
  });

  it('rejects invalid lead_id (not UUID)', () => {
    const result = CreditAnalysisCreateFormSchema.safeParse({
      ...BASE,
      lead_id: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects parecer_text shorter than 10 chars', () => {
    const result = CreditAnalysisCreateFormSchema.safeParse({
      ...BASE,
      parecer_text: 'curto',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      expect(fieldErrors.parecer_text).toBeDefined();
    }
  });

  it('rejects parecer_text with CPF bruto (DLP LGPD)', () => {
    const result = CreditAnalysisCreateFormSchema.safeParse({
      ...BASE,
      parecer_text: CPF_PARECER,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = result.error.issues[0]?.message ?? '';
      expect(message).toMatch(/CPF/i);
    }
  });

  it('rejects parecer_text with RG bruto (DLP LGPD)', () => {
    const result = CreditAnalysisCreateFormSchema.safeParse({
      ...BASE,
      parecer_text: RG_PARECER,
    });
    expect(result.success).toBe(false);
  });

  it('accepts status pendente', () => {
    const result = CreditAnalysisCreateFormSchema.safeParse({
      ...BASE,
      status: 'pendente',
    });
    expect(result.success).toBe(true);
  });

  it('accepts payload with pendencias', () => {
    const result = CreditAnalysisCreateFormSchema.safeParse({
      ...BASE,
      pendencias: [{ tipo: 'Renda', descricao: 'Holerite dos últimos 3 meses' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects pendencia with empty tipo', () => {
    const result = CreditAnalysisCreateFormSchema.safeParse({
      ...BASE,
      pendencias: [{ tipo: '', descricao: 'Descrição válida' }],
    });
    expect(result.success).toBe(false);
  });
});

// ─── CreditAnalysisVersionFormSchema ─────────────────────────────────────────

describe('CreditAnalysisVersionFormSchema', () => {
  const BASE = {
    parecer_text: VALID_PARECER,
    status: 'em_analise' as const,
    pendencias: [],
  };

  it('accepts valid version payload', () => {
    const result = CreditAnalysisVersionFormSchema.safeParse(BASE);
    expect(result.success).toBe(true);
  });

  it('accepts all 5 status values', () => {
    const statuses = CreditAnalysisStatusSchema.options;
    for (const status of statuses) {
      const result = CreditAnalysisVersionFormSchema.safeParse({ ...BASE, status });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid status', () => {
    const result = CreditAnalysisVersionFormSchema.safeParse({
      ...BASE,
      status: 'invalido',
    });
    expect(result.success).toBe(false);
  });

  it('accepts optional approved_amount when status=aprovado', () => {
    const result = CreditAnalysisVersionFormSchema.safeParse({
      ...BASE,
      status: 'aprovado',
      approved_amount: 10000,
      approved_term_months: 24,
      approved_rate_monthly: 0.02,
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative approved_amount', () => {
    const result = CreditAnalysisVersionFormSchema.safeParse({
      ...BASE,
      status: 'aprovado',
      approved_amount: -100,
    });
    expect(result.success).toBe(false);
  });
});

// ─── CreditAnalysisDecideFormSchema ──────────────────────────────────────────

describe('CreditAnalysisDecideFormSchema', () => {
  const BASE = {
    decision: 'aprovado' as const,
    parecer_text: VALID_PARECER,
  };

  it('accepts aprovado decision', () => {
    const result = CreditAnalysisDecideFormSchema.safeParse(BASE);
    expect(result.success).toBe(true);
  });

  it('accepts recusado decision', () => {
    const result = CreditAnalysisDecideFormSchema.safeParse({
      ...BASE,
      decision: 'recusado',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid decision value', () => {
    const result = CreditAnalysisDecideFormSchema.safeParse({
      ...BASE,
      decision: 'pendente',
    });
    expect(result.success).toBe(false);
  });

  it('rejects parecer with CPF (DLP)', () => {
    const result = CreditAnalysisDecideFormSchema.safeParse({
      ...BASE,
      parecer_text: CPF_PARECER,
    });
    expect(result.success).toBe(false);
  });

  it('accepts aprovado with financial fields', () => {
    const result = CreditAnalysisDecideFormSchema.safeParse({
      ...BASE,
      decision: 'aprovado',
      approved_amount: 15000,
      approved_term_months: 36,
      approved_rate_monthly: 0.015,
    });
    expect(result.success).toBe(true);
  });

  it('rejects approved_rate_monthly > 1', () => {
    const result = CreditAnalysisDecideFormSchema.safeParse({
      ...BASE,
      approved_rate_monthly: 1.5,
    });
    expect(result.success).toBe(false);
  });
});

// ─── CreditAnalysisRequestReviewFormSchema ────────────────────────────────────

describe('CreditAnalysisRequestReviewFormSchema', () => {
  it('accepts empty reason', () => {
    const result = CreditAnalysisRequestReviewFormSchema.safeParse({ reason: null });
    expect(result.success).toBe(true);
  });

  it('accepts valid reason text', () => {
    const result = CreditAnalysisRequestReviewFormSchema.safeParse({
      reason: 'Discordo da decisão automática por falta de análise do histórico.',
    });
    expect(result.success).toBe(true);
  });

  it('rejects reason with CPF bruto (DLP)', () => {
    const result = CreditAnalysisRequestReviewFormSchema.safeParse({
      reason: `Meu CPF 123.456.789-09 foi avaliado incorretamente.`,
    });
    expect(result.success).toBe(false);
  });

  it('rejects reason exceeding 2000 chars', () => {
    const result = CreditAnalysisRequestReviewFormSchema.safeParse({
      reason: 'x'.repeat(2001),
    });
    expect(result.success).toBe(false);
  });
});

// ─── CREDIT_ANALYSES_KEYS ────────────────────────────────────────────────────

describe('CREDIT_ANALYSES_KEYS', () => {
  it('list key includes filters', () => {
    const filters = { status: 'em_analise' as const, page: 1 };
    const key = CREDIT_ANALYSES_KEYS.list(filters);
    expect(key).toContain('credit-analyses');
    expect(key).toContain('list');
    expect(key[key.length - 1]).toEqual(filters);
  });

  it('detail key includes id', () => {
    const id = 'test-uuid-001';
    const key = CREDIT_ANALYSES_KEYS.detail(id);
    expect(key).toContain(id);
    expect(key).toContain('detail');
  });

  it('leadAnalyses key includes leadId', () => {
    const leadId = 'lead-uuid-001';
    const key = CREDIT_ANALYSES_KEYS.leadAnalyses(leadId, {});
    expect(key).toContain(leadId);
    expect(key).toContain('lead');
  });

  it('different filters produce different list keys', () => {
    const key1 = CREDIT_ANALYSES_KEYS.list({ status: 'aprovado' });
    const key2 = CREDIT_ANALYSES_KEYS.list({ status: 'recusado' });
    expect(JSON.stringify(key1)).not.toBe(JSON.stringify(key2));
  });

  it('different ids produce different detail keys', () => {
    const key1 = CREDIT_ANALYSES_KEYS.detail('id-001');
    const key2 = CREDIT_ANALYSES_KEYS.detail('id-002');
    expect(JSON.stringify(key1)).not.toBe(JSON.stringify(key2));
  });
});

// ─── CreditAnalysisDiff: diffWords integration ────────────────────────────────

describe('CreditAnalysisDiff logic', () => {
  // Testa a lógica do diff sem renderizar o componente React
  it('diffWords detects additions', async () => {
    const { diffWords } = await import('diff');
    const parts = diffWords('texto antigo', 'texto novo e melhorado');
    const added = parts.filter((p) => p.added);
    expect(added.length).toBeGreaterThan(0);
  });

  it('diffWords detects removals', async () => {
    const { diffWords } = await import('diff');
    const parts = diffWords('texto antigo', 'texto');
    const removed = parts.filter((p) => p.removed);
    expect(removed.length).toBeGreaterThan(0);
  });

  it('diffWords returns no changes for identical texts', async () => {
    const { diffWords } = await import('diff');
    const text = 'análise sem alteração';
    const parts = diffWords(text, text);
    const changed = parts.filter((p) => p.added || p.removed);
    expect(changed).toHaveLength(0);
  });
});
