// =============================================================================
// dlp.test.ts — Testes unitários da lib/dlp.ts (F9-S04).
//
// Cobre:
//   - redactPii: CPF, CNPJ, Email, Phone (E.164 e nacional), RG heurística.
//   - Estabilidade de tokens: mesmo valor → mesmo token na mesma chamada.
//   - Tokens sequenciais: valores distintos → tokens incrementais.
//   - isPiiFree: verificação de ausência de PII.
//   - maskPii: masking defensivo com '<masked>'.
//   - maskPiiInValue: masking recursivo em objetos/arrays JSON.
//
// LGPD: nenhum teste retorna valores de PII em assertions — apenas tokens.
// =============================================================================
import { describe, expect, it } from 'vitest';

import { isPiiFree, maskPii, maskPiiInValue, redactPii } from '../dlp.js';

// ---------------------------------------------------------------------------
// redactPii — CPF
// ---------------------------------------------------------------------------

describe('redactPii — CPF', () => {
  it('mascara CPF com pontuação completa', () => {
    const { redactedText, dlpApplied, dlpTokens } = redactPii('Meu CPF é 123.456.789-09');
    expect(dlpApplied).toBe(true);
    expect(redactedText).toContain('<CPF_1>');
    expect(redactedText).not.toContain('123.456.789-09');
    expect(dlpTokens).toContain('<CPF_1>');
  });

  it('mascara CPF sem pontuação', () => {
    const { redactedText, dlpApplied } = redactPii('CPF: 12345678909');
    expect(dlpApplied).toBe(true);
    expect(redactedText).toContain('<CPF_1>');
    expect(redactedText).not.toContain('12345678909');
  });

  it('mascara múltiplos CPFs distintos com tokens incrementais', () => {
    const { redactedText, dlpTokens } = redactPii('CPF1: 123.456.789-09 e CPF2: 987.654.321-00');
    expect(redactedText).toContain('<CPF_1>');
    expect(redactedText).toContain('<CPF_2>');
    expect(dlpTokens).toHaveLength(2);
  });

  it('reutiliza token para o mesmo CPF em posições distintas', () => {
    const text = 'CPF: 123.456.789-09. Repito: 123.456.789-09.';
    const { redactedText, dlpTokens } = redactPii(text);
    // Apenas um token gerado (mesmo valor → mesmo token)
    expect(dlpTokens).toHaveLength(1);
    // Ambas as ocorrências substituídas pelo mesmo token
    const matches = redactedText.match(/<CPF_1>/g);
    expect(matches).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// redactPii — Email
// ---------------------------------------------------------------------------

describe('redactPii — Email', () => {
  it('mascara endereço de e-mail', () => {
    const { redactedText, dlpApplied } = redactPii('Contato: joao@bdp.ro.gov.br');
    expect(dlpApplied).toBe(true);
    expect(redactedText).toContain('<EMAIL_1>');
    expect(redactedText).not.toContain('joao@bdp.ro.gov.br');
  });

  it('mascara múltiplos e-mails', () => {
    const { dlpTokens } = redactPii('a@a.com e b@b.com');
    expect(dlpTokens.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// redactPii — Telefone
// ---------------------------------------------------------------------------

describe('redactPii — Telefone', () => {
  it('mascara telefone E.164', () => {
    const { redactedText, dlpApplied } = redactPii('WhatsApp: +5569999990000');
    expect(dlpApplied).toBe(true);
    expect(redactedText).toContain('<PHONE_1>');
    expect(redactedText).not.toContain('+5569999990000');
  });

  it('mascara telefone nacional com parênteses', () => {
    const { redactedText, dlpApplied } = redactPii('Tel: (69) 99999-0000');
    expect(dlpApplied).toBe(true);
    expect(redactedText).toContain('<PHONE_1>');
  });

  it('mascara telefone nacional sem parênteses', () => {
    const { redactedText, dlpApplied } = redactPii('Tel: 69 99999-0000');
    expect(dlpApplied).toBe(true);
    expect(redactedText).toContain('<PHONE_1>');
  });
});

// ---------------------------------------------------------------------------
// redactPii — RG (heurística)
// ---------------------------------------------------------------------------

describe('redactPii — RG heurística', () => {
  it('mascara RG no formato 00.000.000-X', () => {
    const { redactedText, dlpApplied } = redactPii('RG: 12.345.678-9');
    expect(dlpApplied).toBe(true);
    expect(redactedText).toContain('<RG_1>');
    expect(redactedText).not.toContain('12.345.678-9');
  });
});

// ---------------------------------------------------------------------------
// redactPii — Combinado (mensagem do operador com múltiplos tipos)
// ---------------------------------------------------------------------------

describe('redactPii — mensagem mista', () => {
  it('mascara CPF, email e telefone na mesma mensagem', () => {
    const msg = 'João: CPF 123.456.789-09, email joao@test.com, tel (69) 99999-0000';
    const { redactedText, dlpApplied, dlpTokens, counts } = redactPii(msg);

    expect(dlpApplied).toBe(true);
    expect(redactedText).not.toContain('123.456.789-09');
    expect(redactedText).not.toContain('joao@test.com');
    expect(redactedText).not.toContain('(69) 99999-0000');
    expect(dlpTokens.length).toBeGreaterThanOrEqual(3);
    expect(counts['CPF']).toBeGreaterThanOrEqual(1);
    expect(counts['EMAIL']).toBeGreaterThanOrEqual(1);
    expect(counts['PHONE']).toBeGreaterThanOrEqual(1);
  });

  it('retorna dlpApplied=false para texto sem PII', () => {
    const { dlpApplied, dlpTokens } = redactPii('Olá, como posso ajudar?');
    expect(dlpApplied).toBe(false);
    expect(dlpTokens).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// isPiiFree
// ---------------------------------------------------------------------------

describe('isPiiFree', () => {
  it('retorna true para texto sem PII', () => {
    expect(isPiiFree('Olá, preciso de ajuda com crédito rural.')).toBe(true);
  });

  it('retorna false para texto com CPF', () => {
    expect(isPiiFree('Meu CPF: 123.456.789-09')).toBe(false);
  });

  it('retorna false para texto com e-mail', () => {
    expect(isPiiFree('Email: user@example.com')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// maskPii — masking defensivo (resposta do LangGraph)
// ---------------------------------------------------------------------------

describe('maskPii', () => {
  it('substitui CPF por <masked>', () => {
    const result = maskPii('CPF: 123.456.789-09');
    expect(result).toContain('<masked>');
    expect(result).not.toContain('123.456.789-09');
  });

  it('substitui email por <masked>', () => {
    const result = maskPii('email@example.com');
    expect(result).toContain('<masked>');
    expect(result).not.toContain('email@example.com');
  });

  it('não altera texto sem PII', () => {
    const text = 'Contexto sintético sem dados pessoais';
    expect(maskPii(text)).toBe(text);
  });
});

// ---------------------------------------------------------------------------
// maskPiiInValue — masking recursivo em objetos JSON (trace do LangGraph)
// ---------------------------------------------------------------------------

describe('maskPiiInValue', () => {
  it('mascara string PII em objeto aninhado', () => {
    const obj = {
      node: 'classify_intent',
      intent: 'credito_rural',
      // Simula PII vazando no trace (cenário de defesa em profundidade)
      debug: 'processando 123.456.789-09',
    };
    const masked = maskPiiInValue(obj) as typeof obj;
    expect(masked['debug']).toContain('<masked>');
    expect(masked['node']).toBe('classify_intent');
    expect(masked['intent']).toBe('credito_rural');
  });

  it('mascara string PII em array de objetos (trace)', () => {
    const trace = [
      { node: 'n1', detail: 'email: foo@bar.com' },
      { node: 'n2', detail: 'sem pii' },
    ];
    const masked = maskPiiInValue(trace) as typeof trace;
    expect(masked[0]?.['detail']).toContain('<masked>');
    expect(masked[1]?.['detail']).toBe('sem pii');
  });

  it('passa valores não-string sem alteração', () => {
    const obj = { count: 42, flag: true, nullVal: null };
    const masked = maskPiiInValue(obj) as typeof obj;
    expect(masked['count']).toBe(42);
    expect(masked['flag']).toBe(true);
    expect(masked['nullVal']).toBeNull();
  });

  it('mascara PII em objeto profundamente aninhado', () => {
    const deep = {
      level1: {
        level2: {
          level3: 'cpf: 123.456.789-09',
        },
      },
    };
    const masked = maskPiiInValue(deep) as typeof deep;
    expect(masked['level1']['level2']['level3']).toContain('<masked>');
  });
});
