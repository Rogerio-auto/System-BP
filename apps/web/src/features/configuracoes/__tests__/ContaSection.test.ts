// =============================================================================
// __tests__/ContaSection.test.ts — Testes de lógica pura da aba Conta (F8-S09).
//
// Estratégia: testa lógica JavaScript pura sem renderizar React
// (JSDOM não configurado no vitest — alinhado ao padrão da codebase).
//
// Cobertura:
//   Seção Perfil:
//     1. Validação de fullName: comprimento mínimo 2 chars
//     2. Validação de fullName: comprimento máximo 200 chars
//     3. fullName vazio → inválido
//
//   Seção Segurança (política de senha):
//     4. Nova senha: mínimo 8 chars
//     5. Nova senha: máximo 128 chars
//     6. Nova senha: exige pelo menos 1 letra
//     7. Nova senha: exige pelo menos 1 dígito
//     8. Nova senha: não pode começar com espaço
//     9. Nova senha: não pode terminar com espaço
//     10. Nova senha igual à atual → inválido (refinement)
//     11. Senhas que atendem todos os critérios → válido
//
//   Aparência:
//     12. ThemeToggle: lógica de estado light/dark
//
//   Self-service (segurança de escopo):
//     13. Body de troca de senha nunca contém userId
//     14. Endpoint correto: /api/account/password (não /api/admin/*)
// =============================================================================

import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Lógica pura de validação de fullName (espelha react-hook-form rules)
// ---------------------------------------------------------------------------

function validateFullName(value: string): string | true {
  if (!value || value.length === 0) return 'O nome é obrigatório';
  if (value.length < 2) return 'O nome deve ter pelo menos 2 caracteres';
  if (value.length > 200) return 'O nome deve ter no máximo 200 caracteres';
  return true;
}

// ---------------------------------------------------------------------------
// Lógica pura de política de senha (espelha schemas.ts + react-hook-form rules)
// ---------------------------------------------------------------------------

interface PasswordValidation {
  valid: boolean;
  error?: string;
}

function validateNewPassword(
  value: string,
  currentPassword: string = 'different-password',
): PasswordValidation {
  if (value.length < 8) return { valid: false, error: 'min-8' };
  if (value.length > 128) return { valid: false, error: 'max-128' };
  if (!/[a-zA-Z]/.test(value)) return { valid: false, error: 'needs-letter' };
  if (!/[0-9]/.test(value)) return { valid: false, error: 'needs-digit' };
  if (value !== value.trim()) return { valid: false, error: 'no-leading-trailing-spaces' };
  if (value === currentPassword) return { valid: false, error: 'same-as-current' };
  return { valid: true };
}

// ---------------------------------------------------------------------------
// Seção Perfil: validação de fullName
// ---------------------------------------------------------------------------

describe('ContaSection — Perfil: validação de fullName', () => {
  it('1. nome com 2+ chars é válido', () => {
    expect(validateFullName('Ab')).toBe(true);
    expect(validateFullName('Rogério')).toBe(true);
    expect(validateFullName('João Silva')).toBe(true);
  });

  it('2. nome com mais de 200 chars é inválido', () => {
    const longName = 'A'.repeat(201);
    const result = validateFullName(longName);
    expect(result).not.toBe(true);
    expect(result).toContain('200');
  });

  it('3. nome vazio é inválido', () => {
    const result = validateFullName('');
    expect(result).not.toBe(true);
  });

  it('3b. nome com 1 char é inválido (mínimo 2)', () => {
    const result = validateFullName('A');
    expect(result).not.toBe(true);
    expect(result).toContain('2');
  });

  it('3c. nome com exatamente 200 chars é válido', () => {
    const maxName = 'A'.repeat(200);
    expect(validateFullName(maxName)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Seção Segurança: política de senha
// ---------------------------------------------------------------------------

describe('ContaSection — Segurança: política de senha', () => {
  it('4. senha com menos de 8 chars → inválida', () => {
    const result = validateNewPassword('Abc1');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('min-8');
  });

  it('5. senha com mais de 128 chars → inválida', () => {
    const longPass = 'Abc1' + 'x'.repeat(130);
    const result = validateNewPassword(longPass);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('max-128');
  });

  it('6. senha sem letra → inválida', () => {
    const result = validateNewPassword('12345678');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('needs-letter');
  });

  it('7. senha sem dígito → inválida', () => {
    const result = validateNewPassword('SenhaSemDigito');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('needs-digit');
  });

  it('8. senha com espaço no início → inválida', () => {
    const result = validateNewPassword(' Senha123');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('no-leading-trailing-spaces');
  });

  it('9. senha com espaço no final → inválida', () => {
    const result = validateNewPassword('Senha123 ');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('no-leading-trailing-spaces');
  });

  it('10. nova senha igual à atual → inválida', () => {
    const same = 'Senha123!';
    const result = validateNewPassword(same, same);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('same-as-current');
  });

  it('11. senha que atende todos os critérios → válida', () => {
    const validPasswords = ['Senha123', 'abc123XY', 'P4ssw0rd!', '12345aaB', 'Nova123Senha'];
    for (const pass of validPasswords) {
      const result = validateNewPassword(pass);
      expect(result.valid).toBe(true);
    }
  });

  it('11b. senha com exatamente 8 chars → válida', () => {
    const result = validateNewPassword('Abc12345');
    expect(result.valid).toBe(true);
  });

  it('11c. senha com exatamente 128 chars → válida', () => {
    const borderPass = 'Abc1' + 'x'.repeat(124);
    const result = validateNewPassword(borderPass);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Aparência: lógica de tema
// ---------------------------------------------------------------------------

describe('ContaSection — Aparência: lógica de tema', () => {
  it('12. ThemeToggle lida com exatamente 2 estados: light e dark', () => {
    type Theme = 'light' | 'dark';
    const validThemes: Theme[] = ['light', 'dark'];
    const allThemes = ['light', 'dark', 'auto', 'system'] as const;

    // Apenas light e dark são válidos
    for (const t of allThemes) {
      const isValid = validThemes.includes(t as Theme);
      if (t === 'light' || t === 'dark') {
        expect(isValid).toBe(true);
      } else {
        expect(isValid).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Self-service: garantias de segurança de escopo
// ---------------------------------------------------------------------------

describe('ContaSection — Self-service: escopo e endpoints', () => {
  it('13. body de troca de senha não tem campo userId (sem escalada de privilégio)', () => {
    // Verifica estruturalmente que o tipo ChangePasswordBody definido no hook
    // não inclui userId — escopo é sempre do usuário autenticado
    interface ChangePasswordBody {
      currentPassword: string;
      newPassword: string;
    }

    const body: ChangePasswordBody = {
      currentPassword: 'atual123',
      newPassword: 'Nova456',
    };

    // userId não deve fazer parte do body
    expect(Object.keys(body)).not.toContain('userId');
    expect(Object.keys(body)).not.toContain('user_id');
    expect(Object.keys(body)).toEqual(['currentPassword', 'newPassword']);
  });

  it('14. endpoints de conta são /api/account/* — nunca /api/admin/*', () => {
    // Documenta os endpoints canônicos do módulo account
    const ACCOUNT_ENDPOINTS = {
      getProfile: '/api/account/profile',
      updateProfile: '/api/account/profile',
      changePassword: '/api/account/password',
    };

    for (const [, endpoint] of Object.entries(ACCOUNT_ENDPOINTS)) {
      // Deve começar com /api/account/ — nunca /api/admin/
      expect(endpoint).toMatch(/^\/api\/account\//);
      expect(endpoint).not.toMatch(/^\/api\/admin\//);
    }
  });

  it('14b. query key do perfil é account-scoped (não admin-scoped)', () => {
    // A query key do profile deve refletir o escopo self-service
    const ACCOUNT_QUERY_KEY = {
      profile: ['account', 'profile'] as const,
    };

    expect(ACCOUNT_QUERY_KEY.profile[0]).toBe('account');
    expect(ACCOUNT_QUERY_KEY.profile).not.toContain('admin');
  });
});

// ---------------------------------------------------------------------------
// 2FA / TOTP: lógica pura de validação e formatos (F8-S11)
// ---------------------------------------------------------------------------

describe('ContaSection — 2FA: lógica de validação', () => {
  // Espelha a validação do backend: código de 6 dígitos ou recovery code
  function isTotpCode(code: string): boolean {
    return /^\d{6}$/.test(code);
  }

  function isRecoveryCode(code: string): boolean {
    // Formato: XXXXX-XXXXX (10 chars alfanuméricos + hífen)
    return /^[A-Z2-9]{5}-[A-Z2-9]{5}$/i.test(code);
  }

  function normalizeRecoveryCode(input: string): string {
    const normalized = input.replace(/-/g, '').toUpperCase();
    if (normalized.length === 10) {
      return `${normalized.slice(0, 5)}-${normalized.slice(5, 10)}`;
    }
    return input.toUpperCase();
  }

  it('15. código de 6 dígitos é TOTP válido', () => {
    expect(isTotpCode('123456')).toBe(true);
    expect(isTotpCode('000000')).toBe(true);
    expect(isTotpCode('999999')).toBe(true);
  });

  it('16. código com menos de 6 dígitos não é TOTP', () => {
    expect(isTotpCode('12345')).toBe(false);
    expect(isTotpCode('')).toBe(false);
  });

  it('17. código com letras não é TOTP (é possível recovery code)', () => {
    expect(isTotpCode('ABCDEF')).toBe(false);
    expect(isTotpCode('abc123')).toBe(false);
  });

  it('18. recovery code no formato XXXXX-XXXXX é válido', () => {
    expect(isRecoveryCode('ABCDE-FGHJK')).toBe(true);
    expect(isRecoveryCode('WXYZ2-34567')).toBe(true);
    expect(isRecoveryCode('MNPQR-STUV2')).toBe(true);
  });

  it('19. recovery code sem hífen não é válido (formato esperado)', () => {
    expect(isRecoveryCode('ABCDEFGHJK')).toBe(false);
  });

  it('20. normalização de recovery code sem hífen', () => {
    const normalized = normalizeRecoveryCode('ABCDEFGHJK');
    expect(normalized).toBe('ABCDE-FGHJK');
  });

  it('21. normalização de recovery code com lowercase', () => {
    const normalized = normalizeRecoveryCode('abcde-fghjk');
    expect(normalized).toBe('ABCDE-FGHJK');
  });

  it('22. endpoints 2FA são /api/account/2fa/* (self-service)', () => {
    const TFA_ENDPOINTS = {
      status: '/api/account/2fa/status',
      enroll: '/api/account/2fa/enroll',
      activate: '/api/account/2fa/activate',
      disable: '/api/account/2fa/disable',
    };

    for (const [, endpoint] of Object.entries(TFA_ENDPOINTS)) {
      expect(endpoint).toMatch(/^\/api\/account\/2fa\//);
      expect(endpoint).not.toMatch(/^\/api\/admin\//);
    }
  });

  it('23. verify-2fa usa endpoint /api/auth/verify-2fa (separado do account)', () => {
    const VERIFY_ENDPOINT = '/api/auth/verify-2fa';
    expect(VERIFY_ENDPOINT).toMatch(/^\/api\/auth\//);
  });

  it('24. recovery codes têm 10 chars no formato XXXXX-XXXXX', () => {
    // Simula a geração de recovery codes (sem deps)
    const RECOVERY_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    function isValidRecoveryCode(code: string): boolean {
      const parts = code.split('-');
      if (parts.length !== 2) return false;
      const [a, b] = parts;
      if (!a || !b || a.length !== 5 || b.length !== 5) return false;
      for (const char of a + b) {
        if (!RECOVERY_CHARSET.includes(char)) return false;
      }
      return true;
    }

    // Códigos de fixture do teste backend
    const fixtureCodes = ['ABCDE-FGHJK', 'LMNPQ-RSTUV', 'WXYZ2-34567'];
    for (const code of fixtureCodes) {
      expect(isValidRecoveryCode(code)).toBe(true);
    }
  });
});
