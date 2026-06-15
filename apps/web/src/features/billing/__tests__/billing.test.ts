// =============================================================================
// billing.test.ts — Testes de lógica pura do módulo de cobrança (F5-S08, F5-S16).
//
// Estratégia: pure logic sem render React (espelha followup.test.ts).
//
// Coverage:
//   1. DUE_STATUS_META — mapeamento status → label + variante de badge
//   2. JOB_STATUS_META — mapeamento status → label + variante de badge
//   3. TRIGGER_TYPE_LABEL — mapeamento trigger → label UI
//   4. CANCELLABLE_JOB_STATUSES — somente 'scheduled' é cancelável
//   5. MARKABLE_DUE_STATUSES — somente 'pending' e 'overdue' são marcáveis
//   6. PaymentDueStatusSchema — validação Zod
//   7. CollectionJobStatusSchema — validação Zod
//   8. CollectionRuleFormSchema — validação Zod completa
//   9. BILLING_KEYS — query keys canônicas
//  10. BoletoReferenceFormSchema — validação Zod do form de referência (F5-S16)
//  11. BOLETO_MAX_FILE_SIZE_BYTES — constante de limite de upload
//  12. BOLETO_ACCEPTED_MIME_TYPES — tipos aceitos
// =============================================================================

import { describe, expect, it } from 'vitest';

import { BILLING_KEYS } from '../hooks/useBilling';
import {
  BOLETO_ACCEPTED_MIME_TYPES,
  BOLETO_MAX_FILE_SIZE_BYTES,
  BoletoReferenceFormSchema,
  CANCELLABLE_JOB_STATUSES,
  CollectionJobStatusSchema,
  CollectionRuleFormSchema,
  DUE_STATUS_META,
  JOB_STATUS_META,
  MARKABLE_DUE_STATUSES,
  PaymentDueStatusSchema,
  TRIGGER_TYPE_LABEL,
} from '../schemas';

// ─── DUE_STATUS_META ─────────────────────────────────────────────────────────

describe('DUE_STATUS_META', () => {
  it('cobre todos os 5 status do enum PaymentDue', () => {
    const allStatuses = PaymentDueStatusSchema.options;
    for (const status of allStatuses) {
      expect(DUE_STATUS_META).toHaveProperty(status);
    }
  });

  it('pending → info', () => {
    expect(DUE_STATUS_META.pending.variant).toBe('info');
    expect(DUE_STATUS_META.pending.label).toBeTruthy();
  });

  it('overdue → danger', () => {
    expect(DUE_STATUS_META.overdue.variant).toBe('danger');
  });

  it('paid → success', () => {
    expect(DUE_STATUS_META.paid.variant).toBe('success');
  });

  it('renegotiated → warning', () => {
    expect(DUE_STATUS_META.renegotiated.variant).toBe('warning');
  });

  it('cancelled → neutral', () => {
    expect(DUE_STATUS_META.cancelled.variant).toBe('neutral');
  });
});

// ─── JOB_STATUS_META ─────────────────────────────────────────────────────────

describe('JOB_STATUS_META', () => {
  it('cobre todos os 6 status do enum CollectionJob', () => {
    const allStatuses = CollectionJobStatusSchema.options;
    for (const status of allStatuses) {
      expect(JOB_STATUS_META).toHaveProperty(status);
    }
  });

  it('scheduled → info', () => {
    expect(JOB_STATUS_META.scheduled.variant).toBe('info');
    expect(JOB_STATUS_META.scheduled.label).toBeTruthy();
  });

  it('triggered → warning', () => {
    expect(JOB_STATUS_META.triggered.variant).toBe('warning');
  });

  it('sent → success', () => {
    expect(JOB_STATUS_META.sent.variant).toBe('success');
  });

  it('failed → danger', () => {
    expect(JOB_STATUS_META.failed.variant).toBe('danger');
  });

  it('cancelled → neutral', () => {
    expect(JOB_STATUS_META.cancelled.variant).toBe('neutral');
  });

  it('paid_before_send → success', () => {
    expect(JOB_STATUS_META.paid_before_send.variant).toBe('success');
  });
});

// ─── TRIGGER_TYPE_LABEL ───────────────────────────────────────────────────────

describe('TRIGGER_TYPE_LABEL', () => {
  it('cobre days_after_due', () => {
    expect(TRIGGER_TYPE_LABEL.days_after_due).toBeTruthy();
  });

  it('cobre days_before_due', () => {
    expect(TRIGGER_TYPE_LABEL.days_before_due).toBeTruthy();
  });
});

// ─── CANCELLABLE_JOB_STATUSES ────────────────────────────────────────────────

describe('CANCELLABLE_JOB_STATUSES', () => {
  it('somente scheduled é cancelável manualmente', () => {
    expect(CANCELLABLE_JOB_STATUSES).toContain('scheduled');
    expect(CANCELLABLE_JOB_STATUSES).toHaveLength(1);
  });

  it('não inclui sent, failed, cancelled, triggered, paid_before_send', () => {
    expect(CANCELLABLE_JOB_STATUSES).not.toContain('sent');
    expect(CANCELLABLE_JOB_STATUSES).not.toContain('failed');
    expect(CANCELLABLE_JOB_STATUSES).not.toContain('cancelled');
    expect(CANCELLABLE_JOB_STATUSES).not.toContain('triggered');
    expect(CANCELLABLE_JOB_STATUSES).not.toContain('paid_before_send');
  });
});

// ─── MARKABLE_DUE_STATUSES ───────────────────────────────────────────────────

describe('MARKABLE_DUE_STATUSES', () => {
  it('somente pending e overdue são marcáveis', () => {
    expect(MARKABLE_DUE_STATUSES).toContain('pending');
    expect(MARKABLE_DUE_STATUSES).toContain('overdue');
    expect(MARKABLE_DUE_STATUSES).toHaveLength(2);
  });

  it('não inclui paid, renegotiated, cancelled', () => {
    expect(MARKABLE_DUE_STATUSES).not.toContain('paid');
    expect(MARKABLE_DUE_STATUSES).not.toContain('renegotiated');
    expect(MARKABLE_DUE_STATUSES).not.toContain('cancelled');
  });
});

// ─── PaymentDueStatusSchema ───────────────────────────────────────────────────

describe('PaymentDueStatusSchema', () => {
  it('aceita todos os status válidos', () => {
    const valid = ['pending', 'overdue', 'paid', 'renegotiated', 'cancelled'];
    for (const status of valid) {
      expect(PaymentDueStatusSchema.safeParse(status).success).toBe(true);
    }
  });

  it('rejeita status inválido', () => {
    expect(PaymentDueStatusSchema.safeParse('unknown').success).toBe(false);
    expect(PaymentDueStatusSchema.safeParse('').success).toBe(false);
    expect(PaymentDueStatusSchema.safeParse('PAID').success).toBe(false);
  });
});

// ─── CollectionJobStatusSchema ────────────────────────────────────────────────

describe('CollectionJobStatusSchema', () => {
  it('aceita todos os status válidos', () => {
    const valid = ['scheduled', 'triggered', 'sent', 'failed', 'cancelled', 'paid_before_send'];
    for (const status of valid) {
      expect(CollectionJobStatusSchema.safeParse(status).success).toBe(true);
    }
  });

  it('rejeita status inválido', () => {
    expect(CollectionJobStatusSchema.safeParse('pending').success).toBe(false);
    expect(CollectionJobStatusSchema.safeParse('').success).toBe(false);
  });
});

// ─── CollectionRuleFormSchema ────────────────────────────────────────────────

const VALID_RULE_FORM = {
  key: 'd3_after',
  name: 'Cobrança D+3',
  trigger_type: 'days_after_due' as const,
  wait_hours: 72,
  template_id: '11111111-1111-1111-1111-111111111111',
};

describe('CollectionRuleFormSchema', () => {
  it('valida form completo correto', () => {
    const result = CollectionRuleFormSchema.safeParse(VALID_RULE_FORM);
    expect(result.success).toBe(true);
  });

  it('rejeita key com caracteres inválidos (maiúsculas e espaços)', () => {
    const result = CollectionRuleFormSchema.safeParse({
      ...VALID_RULE_FORM,
      key: 'D 3 UPPER',
    });
    expect(result.success).toBe(false);
  });

  it('aceita wait_hours negativo (dias antes do vencimento)', () => {
    const result = CollectionRuleFormSchema.safeParse({
      ...VALID_RULE_FORM,
      trigger_type: 'days_before_due',
      wait_hours: -72,
    });
    expect(result.success).toBe(true);
  });

  it('rejeita template_id não-UUID', () => {
    const result = CollectionRuleFormSchema.safeParse({
      ...VALID_RULE_FORM,
      template_id: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('aplica default is_active=false', () => {
    const result = CollectionRuleFormSchema.safeParse(VALID_RULE_FORM);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.is_active).toBe(false);
    }
  });

  it('aplica default max_attempts=3', () => {
    const result = CollectionRuleFormSchema.safeParse(VALID_RULE_FORM);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.max_attempts).toBe(3);
    }
  });

  it('aceita is_active=true explícito', () => {
    const result = CollectionRuleFormSchema.safeParse({
      ...VALID_RULE_FORM,
      is_active: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.is_active).toBe(true);
    }
  });

  it('aceita applies_to_status null', () => {
    const result = CollectionRuleFormSchema.safeParse({
      ...VALID_RULE_FORM,
      applies_to_status: null,
    });
    expect(result.success).toBe(true);
  });

  it('aceita applies_to_status overdue', () => {
    const result = CollectionRuleFormSchema.safeParse({
      ...VALID_RULE_FORM,
      applies_to_status: 'overdue',
    });
    expect(result.success).toBe(true);
  });

  it('rejeita wait_hours fora do range ±1 ano', () => {
    const tooLarge = CollectionRuleFormSchema.safeParse({ ...VALID_RULE_FORM, wait_hours: 9999 });
    expect(tooLarge.success).toBe(false);
    const tooSmall = CollectionRuleFormSchema.safeParse({ ...VALID_RULE_FORM, wait_hours: -9999 });
    expect(tooSmall.success).toBe(false);
  });
});

// ─── BILLING_KEYS ────────────────────────────────────────────────────────────

describe('BILLING_KEYS', () => {
  it('all contém "billing"', () => {
    expect(BILLING_KEYS.all).toContain('billing');
  });

  it('dues() é derivado de all', () => {
    expect(BILLING_KEYS.dues()).toContain('billing');
    expect(BILLING_KEYS.dues()).toContain('dues');
  });

  it('rules() é derivado de all', () => {
    expect(BILLING_KEYS.rules()).toContain('billing');
    expect(BILLING_KEYS.rules()).toContain('rules');
  });

  it('jobs() é derivado de all', () => {
    expect(BILLING_KEYS.jobs()).toContain('billing');
    expect(BILLING_KEYS.jobs()).toContain('jobs');
  });

  it('duesList() inclui os filtros', () => {
    const filters = { status: 'overdue' as const };
    const key = BILLING_KEYS.duesList(filters);
    expect(key).toContain('billing');
    expect(key).toContain('dues');
    expect(key).toContain(filters);
  });

  it('jobsList() com filtros diferentes gera keys diferentes', () => {
    const k1 = BILLING_KEYS.jobsList({ status: 'scheduled' });
    const k2 = BILLING_KEYS.jobsList({ status: 'sent' });
    expect(JSON.stringify(k1)).not.toBe(JSON.stringify(k2));
  });
});

// ─── BoletoReferenceFormSchema (F5-S16) ──────────────────────────────────────

describe('BoletoReferenceFormSchema', () => {
  it('aceita apenas URL válida', () => {
    const result = BoletoReferenceFormSchema.safeParse({
      boletoUrl: 'https://banco.exemplo.com.br/boleto/123',
      digitableLine: '',
      pixCopiaCola: '',
      filename: '',
    });
    expect(result.success).toBe(true);
  });

  it('aceita apenas linha digitável', () => {
    const result = BoletoReferenceFormSchema.safeParse({
      boletoUrl: '',
      digitableLine: '00190.000090 01234.567891',
      pixCopiaCola: '',
      filename: '',
    });
    expect(result.success).toBe(true);
  });

  it('aceita apenas PIX copia-e-cola', () => {
    const result = BoletoReferenceFormSchema.safeParse({
      boletoUrl: '',
      digitableLine: '',
      pixCopiaCola: '00020126580014BR.GOV.BCB.PIX',
      filename: '',
    });
    expect(result.success).toBe(true);
  });

  it('rejeita quando todos os campos são vazios', () => {
    const result = BoletoReferenceFormSchema.safeParse({
      boletoUrl: '',
      digitableLine: '',
      pixCopiaCola: '',
      filename: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejeita URL com http:// (requer https)', () => {
    const result = BoletoReferenceFormSchema.safeParse({
      boletoUrl: 'http://banco.exemplo.com.br/boleto/123',
      digitableLine: '',
      pixCopiaCola: '',
      filename: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejeita URL inválida', () => {
    const result = BoletoReferenceFormSchema.safeParse({
      boletoUrl: 'nao-e-url',
      digitableLine: '',
      pixCopiaCola: '',
      filename: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejeita filename com caracteres inválidos', () => {
    const result = BoletoReferenceFormSchema.safeParse({
      boletoUrl: '',
      digitableLine: '00190.000090',
      pixCopiaCola: '',
      filename: '../../../etc/passwd',
    });
    expect(result.success).toBe(false);
  });

  it('aceita filename válido', () => {
    const result = BoletoReferenceFormSchema.safeParse({
      boletoUrl: '',
      digitableLine: '00190.000090',
      pixCopiaCola: '',
      filename: 'boleto-parcela-3.pdf',
    });
    expect(result.success).toBe(true);
  });

  it('rejeita digitableLine acima de 200 chars', () => {
    const result = BoletoReferenceFormSchema.safeParse({
      boletoUrl: '',
      digitableLine: 'x'.repeat(201),
      pixCopiaCola: '',
      filename: '',
    });
    expect(result.success).toBe(false);
  });
});

// ─── BOLETO_MAX_FILE_SIZE_BYTES ───────────────────────────────────────────────

describe('BOLETO_MAX_FILE_SIZE_BYTES', () => {
  it('deve ser exatamente 10 MB', () => {
    expect(BOLETO_MAX_FILE_SIZE_BYTES).toBe(10 * 1024 * 1024);
  });
});

// ─── BOLETO_ACCEPTED_MIME_TYPES ───────────────────────────────────────────────

describe('BOLETO_ACCEPTED_MIME_TYPES', () => {
  it('inclui application/pdf', () => {
    expect(BOLETO_ACCEPTED_MIME_TYPES).toContain('application/pdf');
  });

  it('inclui image/jpeg', () => {
    expect(BOLETO_ACCEPTED_MIME_TYPES).toContain('image/jpeg');
  });

  it('inclui image/png', () => {
    expect(BOLETO_ACCEPTED_MIME_TYPES).toContain('image/png');
  });

  it('não aceita outros tipos', () => {
    expect(BOLETO_ACCEPTED_MIME_TYPES).not.toContain('application/zip');
    expect(BOLETO_ACCEPTED_MIME_TYPES).not.toContain('text/plain');
  });
});
