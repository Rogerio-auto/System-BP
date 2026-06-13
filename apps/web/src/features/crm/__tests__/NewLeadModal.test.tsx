// =============================================================================
// NewLeadModal.test.tsx — Testes unitários do modal de criação de lead.
//
// Estratégia: testa lógica pura do schema Zod e validações de formulário
// sem renderizar React.
//
// Cobertura:
//   1. LeadCreateSchema: validação de campos obrigatórios
//   2. phone_e164: validação E.164 (mesma do backend)
//   3. email: obrigatório no manual, opcional em outras origens (F14-S03)
//   4. CPF: validação de formato
//   5. CNPJ: validação de formato (F14-S03)
//   6. legal_name: razão social opcional (F14-S03)
//   7. Comportamento de sucesso: objeto de saída correto
//   8. Lógica de erro 409 LEAD_PHONE_DUPLICATE: tratamento tipado
//   9. Lógica de erro 409 LEAD_EMAIL_DUPLICATE: tratamento tipado (F14-S03)
//   10. Lógica de erro 422 LEAD_EMAIL_INTERNAL: tratamento tipado (F14-S03)
//   11. normalizePhone: strip do '+'
//   12. maskCnpj: função auxiliar de máscara
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
  email: 'ana.paula@exemplo.com.br',
  cpf: null,
  notes: null,
  metadata: {},
  agent_id: null,
};

// ── Fixture de payload PJ válido ──────────────────────────────────────────────

const VALID_PJ_PAYLOAD = {
  ...VALID_PAYLOAD,
  cnpj: '12.345.678/0001-90',
  legal_name: 'Comercial Ferreira Ltda',
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

// ─── email — obrigatório no manual, opcional nas demais origens (F14-S03) ─────

describe('LeadCreateSchema — email (obrigatório no manual)', () => {
  it('email válido é aceito (manual)', () => {
    const result = LeadCreateSchema.safeParse({ ...VALID_PAYLOAD, email: 'test@exemplo.com.br' });
    expect(result.success).toBe(true);
  });

  it('email inválido falha', () => {
    const result = LeadCreateSchema.safeParse({ ...VALID_PAYLOAD, email: 'not-an-email' });
    expect(result.success).toBe(false);
  });

  it('email null falha quando source=manual', () => {
    const result = LeadCreateSchema.safeParse({ ...VALID_PAYLOAD, email: null });
    expect(result.success).toBe(false);
  });

  it('email ausente falha quando source=manual', () => {
    const { email: _e, ...rest } = VALID_PAYLOAD;
    const result = LeadCreateSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('email null é aceito quando source ≠ manual (ex: whatsapp)', () => {
    const result = LeadCreateSchema.safeParse({
      ...VALID_PAYLOAD,
      source: 'whatsapp' as const,
      email: null,
    });
    expect(result.success).toBe(true);
  });

  it('email ausente é aceito quando source ≠ manual (ex: whatsapp)', () => {
    const { email: _e, ...rest } = VALID_PAYLOAD;
    const result = LeadCreateSchema.safeParse({ ...rest, source: 'whatsapp' as const });
    expect(result.success).toBe(true);
  });

  it('email ausente é aceito quando source = import', () => {
    const { email: _e, ...rest } = VALID_PAYLOAD;
    const result = LeadCreateSchema.safeParse({ ...rest, source: 'import' as const });
    expect(result.success).toBe(true);
  });

  it('email ausente é aceito quando source = chatwoot', () => {
    const { email: _e, ...rest } = VALID_PAYLOAD;
    const result = LeadCreateSchema.safeParse({ ...rest, source: 'chatwoot' as const });
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

// ─── CNPJ — opcional, máscara 00.000.000/0000-00 (F14-S03) ───────────────────

describe('LeadCreateSchema — cnpj (opcional, Pessoa Jurídica)', () => {
  it('CNPJ com máscara completa é aceito: 12.345.678/0001-90', () => {
    const result = LeadCreateSchema.safeParse({ ...VALID_PAYLOAD, cnpj: '12.345.678/0001-90' });
    expect(result.success).toBe(true);
  });

  it('CNPJ somente dígitos (14) é aceito: 12345678000190', () => {
    const result = LeadCreateSchema.safeParse({ ...VALID_PAYLOAD, cnpj: '12345678000190' });
    expect(result.success).toBe(true);
  });

  it('CNPJ null é aceito (PF ou não informado)', () => {
    const result = LeadCreateSchema.safeParse({ ...VALID_PAYLOAD, cnpj: null });
    expect(result.success).toBe(true);
  });

  it('CNPJ ausente é aceito (campo opcional)', () => {
    const { cnpj: _c, ...rest } = VALID_PJ_PAYLOAD;
    const result = LeadCreateSchema.safeParse(rest);
    expect(result.success).toBe(true);
  });

  it('CNPJ inválido falha: 123-456', () => {
    const result = LeadCreateSchema.safeParse({ ...VALID_PAYLOAD, cnpj: '123-456' });
    expect(result.success).toBe(false);
  });

  it('CNPJ inválido falha: 12 dígitos (curto demais)', () => {
    const result = LeadCreateSchema.safeParse({ ...VALID_PAYLOAD, cnpj: '123456780001' });
    expect(result.success).toBe(false);
  });

  it('CNPJ inválido falha: máscara de CPF usada por engano (000.000.000-00)', () => {
    // Garante que o regex de CNPJ não aceita formato de CPF
    const result = LeadCreateSchema.safeParse({ ...VALID_PAYLOAD, cnpj: '123.456.789-00' });
    expect(result.success).toBe(false);
  });
});

// ─── legal_name — razão social opcional (F14-S03) ─────────────────────────────

describe('LeadCreateSchema — legal_name (razão social, opcional)', () => {
  it('payload PJ válido (cnpj + legal_name) é aceito', () => {
    const result = LeadCreateSchema.safeParse(VALID_PJ_PAYLOAD);
    expect(result.success).toBe(true);
  });

  it('legal_name null é aceito', () => {
    const result = LeadCreateSchema.safeParse({ ...VALID_PAYLOAD, legal_name: null });
    expect(result.success).toBe(true);
  });

  it('legal_name ausente é aceito (campo opcional)', () => {
    const result = LeadCreateSchema.safeParse(VALID_PAYLOAD);
    expect(result.success).toBe(true);
  });

  it('legal_name string vazia falha (min 1)', () => {
    const result = LeadCreateSchema.safeParse({ ...VALID_PAYLOAD, legal_name: '' });
    expect(result.success).toBe(false);
  });

  it('legal_name com valor máximo (255 chars) é aceito', () => {
    const result = LeadCreateSchema.safeParse({
      ...VALID_PAYLOAD,
      legal_name: 'A'.repeat(255),
    });
    expect(result.success).toBe(true);
  });

  it('legal_name acima de 255 chars falha', () => {
    const result = LeadCreateSchema.safeParse({
      ...VALID_PAYLOAD,
      legal_name: 'A'.repeat(256),
    });
    expect(result.success).toBe(false);
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

// ─── Erros de telefone — lógica de tratamento ─────────────────────────────────

describe('Lógica de erro 409 LEAD_PHONE_DUPLICATE', () => {
  // Simula a lógica de useCreateLead.onError
  function handleCreateError(
    status: number,
    code: string,
  ): {
    type: 'duplicate_phone' | 'duplicate_email' | 'internal_email' | 'generic';
    message: string;
  } {
    if (status === 409 && code === 'LEAD_PHONE_DUPLICATE') {
      return {
        type: 'duplicate_phone',
        message: 'Este telefone já está cadastrado para outro lead.',
      };
    }
    if (status === 409 && code === 'LEAD_EMAIL_DUPLICATE') {
      return {
        type: 'duplicate_email',
        message: 'Já existe lead com este email.',
      };
    }
    if (status === 422 && code === 'LEAD_EMAIL_INTERNAL') {
      return {
        type: 'internal_email',
        message: 'Use o email do cliente, não um email interno.',
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

// ─── Erro 409 LEAD_EMAIL_DUPLICATE (F14-S03) ─────────────────────────────────

describe('Lógica de erro 409 LEAD_EMAIL_DUPLICATE (F14-S03)', () => {
  function handleEmailDuplicateError(
    status: number,
    code: string,
  ): { type: string; message: string } {
    if (status === 409 && code === 'LEAD_EMAIL_DUPLICATE') {
      return { type: 'duplicate_email', message: 'Já existe lead com este email.' };
    }
    return { type: 'generic', message: 'Erro ao criar lead. Tente novamente.' };
  }

  it('409 LEAD_EMAIL_DUPLICATE → tipo duplicate_email', () => {
    const err = handleEmailDuplicateError(409, 'LEAD_EMAIL_DUPLICATE');
    expect(err.type).toBe('duplicate_email');
  });

  it('mensagem de duplicate_email corresponde ao contrato', () => {
    const err = handleEmailDuplicateError(409, 'LEAD_EMAIL_DUPLICATE');
    expect(err.message).toBe('Já existe lead com este email.');
  });

  it('409 LEAD_PHONE_DUPLICATE não aciona duplicate_email', () => {
    const err = handleEmailDuplicateError(409, 'LEAD_PHONE_DUPLICATE');
    expect(err.type).toBe('generic');
  });

  it('500 LEAD_EMAIL_DUPLICATE não aciona duplicate_email (status errado)', () => {
    const err = handleEmailDuplicateError(500, 'LEAD_EMAIL_DUPLICATE');
    expect(err.type).toBe('generic');
  });
});

// ─── Erro 422 LEAD_EMAIL_INTERNAL (F14-S03) ──────────────────────────────────

describe('Lógica de erro 422 LEAD_EMAIL_INTERNAL (F14-S03)', () => {
  function handleInternalEmailError(
    status: number,
    code: string,
  ): { type: string; message: string } {
    if (status === 422 && code === 'LEAD_EMAIL_INTERNAL') {
      return { type: 'internal_email', message: 'Use o email do cliente, não um email interno.' };
    }
    return { type: 'generic', message: 'Erro ao criar lead. Tente novamente.' };
  }

  it('422 LEAD_EMAIL_INTERNAL → tipo internal_email', () => {
    const err = handleInternalEmailError(422, 'LEAD_EMAIL_INTERNAL');
    expect(err.type).toBe('internal_email');
  });

  it('mensagem de internal_email corresponde ao contrato', () => {
    const err = handleInternalEmailError(422, 'LEAD_EMAIL_INTERNAL');
    expect(err.message).toBe('Use o email do cliente, não um email interno.');
  });

  it('409 LEAD_EMAIL_INTERNAL não aciona internal_email (status errado)', () => {
    const err = handleInternalEmailError(409, 'LEAD_EMAIL_INTERNAL');
    expect(err.type).toBe('generic');
  });

  it('422 outro código não aciona internal_email', () => {
    const err = handleInternalEmailError(422, 'VALIDATION_ERROR');
    expect(err.type).toBe('generic');
  });
});

// ─── maskCnpj — função auxiliar de máscara ───────────────────────────────────
// Testa a função diretamente sem importar o módulo (lógica pura inline)

describe('maskCnpj — formatação de CNPJ na digitação', () => {
  // Replica a função do modal para testar isoladamente
  function maskCnpj(value: string): string {
    const digits = value.replace(/\D/g, '').slice(0, 14);
    if (digits.length <= 2) return digits;
    if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
    if (digits.length <= 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
    if (digits.length <= 12)
      return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
  }

  it('14 dígitos → máscara completa', () => {
    expect(maskCnpj('12345678000190')).toBe('12.345.678/0001-90');
  });

  it('entrada já com máscara → normaliza (sem duplicar separadores)', () => {
    expect(maskCnpj('12.345.678/0001-90')).toBe('12.345.678/0001-90');
  });

  it('entrada parcial 8 dígitos → 12.345.678', () => {
    expect(maskCnpj('12345678')).toBe('12.345.678');
  });

  it('entrada vazia → string vazia', () => {
    expect(maskCnpj('')).toBe('');
  });

  it('letras são ignoradas — apenas dígitos são processados', () => {
    expect(maskCnpj('12ABC345678000190')).toBe('12.345.678/0001-90');
  });

  it('mais de 14 dígitos → truncado em 14', () => {
    // 15 dígitos: o 15º é ignorado
    expect(maskCnpj('123456780001901')).toBe('12.345.678/0001-90');
  });
});
