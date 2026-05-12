// =============================================================================
// NewLeadModal.test.tsx — Testes unitários do modal de criação de lead.
//
// Estratégia: testa lógica pura do schema Zod e validações de formulário
// sem renderizar React.
//
// Cobertura:
//   1. LeadCreateSchema: validação de campos obrigatórios
//   2. phone_e164: validação E.164 (mesma do backend)
//   3. email: validação de formato
//   4. CPF: validação de formato
//   5. Comportamento de sucesso: objeto de saída correto
//   6. Lógica de erro 409 DUPLICATE: tratamento tipado
//   7. normalizePhone: strip do '+'
// =============================================================================

import {
  LeadCreateSchema,
  LeadStatusSchema,
  LeadSourceSchema,
  normalizePhone,
} from '@elemento/shared-schemas';
import { describe, expect, it } from 'vitest';

// ── Fixture de payload válido ─────────────────────────────────────────────────

const VALID_PAYLOAD = {
  name: 'Ana Paula Ferreira',
  phone_e164: '+5569912341234',
  city_id: 'a1b2c3d4-0000-0000-0000-000000000001',
  source: 'manual' as const,
  status: 'new' as const,
  email: null,
  cpf: null,
  notes: null,
  metadata: {},
  agent_id: null,
};

// ─── LeadCreateSchema — campos obrigatórios ───────────────────────────────────

describe('LeadCreateSchema — validação de criação de lead', () => {
  it('payload válido é aceito', () => {
    const result = LeadCreateSchema.safeParse(VALID_PAYLOAD);
    expect(result.success).toBe(true);
  });

  it('name obrigatório — vazio falha', () => {
    const result = LeadCreateSchema.safeParse({ ...VALID_PAYLOAD, name: '' });
    expect(result.success).toBe(false);
  });

  it('name obrigatório — ausente falha', () => {
    const { name: _n, ...rest } = VALID_PAYLOAD;
    const result = LeadCreateSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('city_id obrigatório — ausente falha', () => {
    const { city_id: _c, ...rest } = VALID_PAYLOAD;
    const result = LeadCreateSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('city_id deve ser UUID — string inválida falha', () => {
    const result = LeadCreateSchema.safeParse({ ...VALID_PAYLOAD, city_id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('source com valor inválido falha', () => {
    const result = LeadCreateSchema.safeParse({ ...VALID_PAYLOAD, source: 'fax' });
    expect(result.success).toBe(false);
  });

  it('status com valor inválido falha', () => {
    const result = LeadCreateSchema.safeParse({ ...VALID_PAYLOAD, status: 'invalid_status' });
    expect(result.success).toBe(false);
  });
});

// ─── phone_e164 — validação E.164 ────────────────────────────────────────────

describe('LeadCreateSchema — phone_e164 E.164', () => {
  it('+5511999991234 é válido', () => {
    const result = LeadCreateSchema.safeParse({ ...VALID_PAYLOAD, phone_e164: '+5511999991234' });
    expect(result.success).toBe(true);
  });

  it('+5569912341234 é válido (código Rondônia)', () => {
    const result = LeadCreateSchema.safeParse({ ...VALID_PAYLOAD, phone_e164: '+5569912341234' });
    expect(result.success).toBe(true);
  });

  it('sem "+" falha', () => {
    const result = LeadCreateSchema.safeParse({ ...VALID_PAYLOAD, phone_e164: '5511999991234' });
    expect(result.success).toBe(false);
  });

  it('muito curto (< 10 dígitos) falha', () => {
    const result = LeadCreateSchema.safeParse({ ...VALID_PAYLOAD, phone_e164: '+55' });
    expect(result.success).toBe(false);
  });

  it('com letras falha', () => {
    const result = LeadCreateSchema.safeParse({ ...VALID_PAYLOAD, phone_e164: '+55abc1234567' });
    expect(result.success).toBe(false);
  });

  it('ausente falha', () => {
    const { phone_e164: _p, ...rest } = VALID_PAYLOAD;
    const result = LeadCreateSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

// ─── email — opcional com validação ──────────────────────────────────────────

describe('LeadCreateSchema — email (opcional)', () => {
  it('email válido é aceito', () => {
    const result = LeadCreateSchema.safeParse({ ...VALID_PAYLOAD, email: 'test@exemplo.com.br' });
    expect(result.success).toBe(true);
  });

  it('email inválido falha', () => {
    const result = LeadCreateSchema.safeParse({ ...VALID_PAYLOAD, email: 'not-an-email' });
    expect(result.success).toBe(false);
  });

  it('email null é aceito', () => {
    const result = LeadCreateSchema.safeParse({ ...VALID_PAYLOAD, email: null });
    expect(result.success).toBe(true);
  });

  it('email undefined é aceito (opcional)', () => {
    const { email: _e, ...rest } = VALID_PAYLOAD;
    const result = LeadCreateSchema.safeParse(rest);
    expect(result.success).toBe(true);
  });
});

// ─── CPF — opcional com validação de formato ─────────────────────────────────

describe('LeadCreateSchema — cpf (opcional, LGPD: nunca armazenado bruto)', () => {
  it('CPF com máscara é aceito: 123.456.789-00', () => {
    const result = LeadCreateSchema.safeParse({ ...VALID_PAYLOAD, cpf: '123.456.789-00' });
    expect(result.success).toBe(true);
  });

  it('CPF sem máscara é aceito: 12345678900', () => {
    const result = LeadCreateSchema.safeParse({ ...VALID_PAYLOAD, cpf: '12345678900' });
    expect(result.success).toBe(true);
  });

  it('CPF inválido falha: 123-456', () => {
    const result = LeadCreateSchema.safeParse({ ...VALID_PAYLOAD, cpf: '123-456' });
    expect(result.success).toBe(false);
  });

  it('CPF null é aceito', () => {
    const result = LeadCreateSchema.safeParse({ ...VALID_PAYLOAD, cpf: null });
    expect(result.success).toBe(true);
  });
});

// ─── normalizePhone ───────────────────────────────────────────────────────────

describe('normalizePhone — strip do "+" (mesmo que backend)', () => {
  it('+5511999991234 → 5511999991234', () => {
    expect(normalizePhone('+5511999991234')).toBe('5511999991234');
  });

  it('+5569912341234 → 5569912341234', () => {
    expect(normalizePhone('+5569912341234')).toBe('5569912341234');
  });

  it('sem "+" → retorna como está', () => {
    expect(normalizePhone('5511999991234')).toBe('5511999991234');
  });
});

// ─── Enums ────────────────────────────────────────────────────────────────────

describe('LeadStatusSchema — valores válidos', () => {
  const validStatuses = [
    'new',
    'qualifying',
    'simulation',
    'closed_won',
    'closed_lost',
    'archived',
  ];

  it('todos os status válidos são aceitos', () => {
    for (const status of validStatuses) {
      const result = LeadStatusSchema.safeParse(status);
      expect(result.success).toBe(true);
    }
  });

  it('status inválido é rejeitado', () => {
    expect(LeadStatusSchema.safeParse('rejected').success).toBe(false);
  });
});

describe('LeadSourceSchema — valores válidos', () => {
  const validSources = ['whatsapp', 'manual', 'import', 'chatwoot', 'api'];

  it('todos os canais válidos são aceitos', () => {
    for (const source of validSources) {
      const result = LeadSourceSchema.safeParse(source);
      expect(result.success).toBe(true);
    }
  });

  it('canal inválido é rejeitado', () => {
    expect(LeadSourceSchema.safeParse('fax').success).toBe(false);
  });
});

// ─── Erro 409 — lógica de tratamento ─────────────────────────────────────────

describe('Lógica de erro 409 LEAD_PHONE_DUPLICATE', () => {
  // Simula a lógica de useCreateLead.onError
  function handleCreateError(
    status: number,
    code: string,
  ): { type: 'duplicate_phone' | 'generic'; message: string } {
    if (status === 409 && code === 'LEAD_PHONE_DUPLICATE') {
      return {
        type: 'duplicate_phone',
        message: 'Este telefone já está cadastrado para outro lead.',
      };
    }
    return { type: 'generic', message: 'Erro ao criar lead. Tente novamente.' };
  }

  it('409 LEAD_PHONE_DUPLICATE → tipo duplicate_phone', () => {
    const err = handleCreateError(409, 'LEAD_PHONE_DUPLICATE');
    expect(err.type).toBe('duplicate_phone');
  });

  it('409 outro código → tipo generic', () => {
    const err = handleCreateError(409, 'OTHER_CONFLICT');
    expect(err.type).toBe('generic');
  });

  it('500 → tipo generic', () => {
    const err = handleCreateError(500, 'INTERNAL_ERROR');
    expect(err.type).toBe('generic');
  });

  it('mensagem de duplicate_phone não expõe dados do outro lead', () => {
    const err = handleCreateError(409, 'LEAD_PHONE_DUPLICATE');
    // A mensagem não deve conter telefone ou nome de outro lead
    expect(err.message).not.toMatch(/\+\d{10,15}/);
  });
});
