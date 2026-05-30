// =============================================================================
// followup.test.ts — Testes de lógica pura do módulo de follow-up (F5-S05).
//
// Estratégia: pure logic sem render React.
//
// Coverage:
//   1. JOB_STATUS_META — mapeamento status → label + variante de badge
//   2. TRIGGER_TYPE_LABEL — mapeamento trigger → label UI
//   3. CANCELLABLE_STATUSES — somente 'scheduled' é cancelável
//   4. FollowupJobStatusSchema — validação Zod
//   5. FollowupRuleFormSchema — validação Zod completa
//   6. FOLLOWUP_KEYS — query keys canônicas
// =============================================================================

import { describe, expect, it } from 'vitest';

import { FOLLOWUP_KEYS } from '../hooks/useFollowup';
import {
  CANCELLABLE_STATUSES,
  FollowupJobStatusSchema,
  FollowupRuleFormSchema,
  JOB_STATUS_META,
  TRIGGER_TYPE_LABEL,
} from '../schemas';

// ─── JOB_STATUS_META ─────────────────────────────────────────────────────────

describe('JOB_STATUS_META', () => {
  it('cobre todos os 6 status do enum', () => {
    const allStatuses = FollowupJobStatusSchema.options;
    for (const status of allStatuses) {
      expect(JOB_STATUS_META).toHaveProperty(status);
    }
  });

  it('scheduled → info', () => {
    expect(JOB_STATUS_META.scheduled.variant).toBe('info');
    expect(JOB_STATUS_META.scheduled.label).toBeTruthy();
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

  it('triggered → warning', () => {
    expect(JOB_STATUS_META.triggered.variant).toBe('warning');
  });

  it('customer_replied → success', () => {
    expect(JOB_STATUS_META.customer_replied.variant).toBe('success');
  });
});

// ─── TRIGGER_TYPE_LABEL ───────────────────────────────────────────────────────

describe('TRIGGER_TYPE_LABEL', () => {
  it('cobre stage_inactivity', () => {
    expect(TRIGGER_TYPE_LABEL.stage_inactivity).toBeTruthy();
  });

  it('cobre event_based', () => {
    expect(TRIGGER_TYPE_LABEL.event_based).toBeTruthy();
  });
});

// ─── CANCELLABLE_STATUSES ─────────────────────────────────────────────────────

describe('CANCELLABLE_STATUSES', () => {
  it('somente scheduled é cancelável manualmente', () => {
    expect(CANCELLABLE_STATUSES).toContain('scheduled');
    expect(CANCELLABLE_STATUSES).toHaveLength(1);
  });

  it('não inclui sent, failed, cancelled, triggered, customer_replied', () => {
    expect(CANCELLABLE_STATUSES).not.toContain('sent');
    expect(CANCELLABLE_STATUSES).not.toContain('failed');
    expect(CANCELLABLE_STATUSES).not.toContain('cancelled');
    expect(CANCELLABLE_STATUSES).not.toContain('triggered');
    expect(CANCELLABLE_STATUSES).not.toContain('customer_replied');
  });
});

// ─── FollowupJobStatusSchema ──────────────────────────────────────────────────

describe('FollowupJobStatusSchema', () => {
  it('aceita todos os status válidos', () => {
    const valid = ['scheduled', 'triggered', 'sent', 'failed', 'cancelled', 'customer_replied'];
    for (const status of valid) {
      expect(FollowupJobStatusSchema.safeParse(status).success).toBe(true);
    }
  });

  it('rejeita status inválido', () => {
    expect(FollowupJobStatusSchema.safeParse('pending').success).toBe(false);
    expect(FollowupJobStatusSchema.safeParse('').success).toBe(false);
  });
});

// ─── FollowupRuleFormSchema ────────────────────────────────────────────────────

const VALID_RULE_FORM = {
  key: 'd1',
  name: 'Follow-up D+1',
  trigger_type: 'stage_inactivity' as const,
  wait_hours: 24,
  template_id: '11111111-1111-1111-1111-111111111111',
};

describe('FollowupRuleFormSchema', () => {
  it('valida form completo correto', () => {
    const result = FollowupRuleFormSchema.safeParse(VALID_RULE_FORM);
    expect(result.success).toBe(true);
  });

  it('rejeita key com caracteres inválidos', () => {
    const result = FollowupRuleFormSchema.safeParse({
      ...VALID_RULE_FORM,
      key: 'D 1 UPPER',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('minúsculas');
  });

  it('rejeita wait_hours <= 0', () => {
    const result = FollowupRuleFormSchema.safeParse({
      ...VALID_RULE_FORM,
      wait_hours: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejeita wait_hours negativo', () => {
    const result = FollowupRuleFormSchema.safeParse({
      ...VALID_RULE_FORM,
      wait_hours: -24,
    });
    expect(result.success).toBe(false);
  });

  it('rejeita template_id não-UUID', () => {
    const result = FollowupRuleFormSchema.safeParse({
      ...VALID_RULE_FORM,
      template_id: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('aplica default is_active=false', () => {
    const result = FollowupRuleFormSchema.safeParse(VALID_RULE_FORM);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.is_active).toBe(false);
    }
  });

  it('aplica default max_attempts=3', () => {
    const result = FollowupRuleFormSchema.safeParse(VALID_RULE_FORM);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.max_attempts).toBe(3);
    }
  });

  it('aceita is_active=true explícito', () => {
    const result = FollowupRuleFormSchema.safeParse({
      ...VALID_RULE_FORM,
      is_active: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.is_active).toBe(true);
    }
  });

  it('aceita applies_to_stage null', () => {
    const result = FollowupRuleFormSchema.safeParse({
      ...VALID_RULE_FORM,
      applies_to_stage: null,
    });
    expect(result.success).toBe(true);
  });
});

// ─── FOLLOWUP_KEYS ────────────────────────────────────────────────────────────

describe('FOLLOWUP_KEYS', () => {
  it('all contém "followup"', () => {
    expect(FOLLOWUP_KEYS.all).toContain('followup');
  });

  it('rules() é derivado de all', () => {
    expect(FOLLOWUP_KEYS.rules()).toContain('followup');
    expect(FOLLOWUP_KEYS.rules()).toContain('rules');
  });

  it('jobsList() inclui os filtros', () => {
    const filters = { status: 'scheduled' as const };
    const key = FOLLOWUP_KEYS.jobsList(filters);
    expect(key).toContain('followup');
    expect(key).toContain('jobs');
    expect(key).toContain(filters);
  });

  it('jobsList() com filtros diferentes gera keys diferentes', () => {
    const k1 = FOLLOWUP_KEYS.jobsList({ status: 'scheduled' });
    const k2 = FOLLOWUP_KEYS.jobsList({ status: 'sent' });
    // Chaves diferentes produzem arrays diferentes
    expect(JSON.stringify(k1)).not.toBe(JSON.stringify(k2));
  });
});
