// =============================================================================
// __tests__/TemplateForm.test.tsx — Testes de validação DLP e lógica pura.
//
// Contexto: F5-S09.
//
// Estratégia: testa lógica pura isolada (schemas DLP, mapeamentos de status,
// geração de preview) sem renderizar React (JSDOM não configurado neste projeto).
//
// Cobertura:
//   - DLP: CPF/email/telefone bloqueiam validação do schema
//   - name: slug inválido rejeitado
//   - STATUS_CONFIG: label e variante para cada status
//   - Preview: variáveis {{N}} substituídas pelos nomes semânticos
// =============================================================================
import { describe, expect, it } from 'vitest';

import {
  TemplateCreateFormSchema,
  TemplateUpdateFormSchema,
  TemplateStatusSchema,
  type TemplateHeaderType,
} from '../schemas';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_PAYLOAD: {
  name: string;
  category: 'utility';
  language: string;
  body: string;
  variables: string[];
  headerType?: TemplateHeaderType;
  headerText?: string;
} = {
  name: 'followup_d1',
  category: 'utility',
  language: 'pt_BR',
  body: 'Olá {{1}}, sua proposta de crédito está em análise.',
  variables: ['nome_cliente'],
  headerType: 'none',
};

function parseCreate(overrides: Partial<typeof VALID_PAYLOAD>) {
  return TemplateCreateFormSchema.safeParse({ ...VALID_PAYLOAD, ...overrides });
}

// ─── STATUS_CONFIG mapeamento ─────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; variant: string }> = {
  approved: { variant: 'success', label: 'Aprovado' },
  pending: { variant: 'warning', label: 'Pendente' },
  rejected: { variant: 'danger', label: 'Rejeitado' },
  paused: { variant: 'neutral', label: 'Pausado' },
};

describe('TemplateStatusSchema', () => {
  it('aceita todos os 4 status válidos', () => {
    for (const s of ['pending', 'approved', 'rejected', 'paused']) {
      expect(TemplateStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it('rejeita status inválido', () => {
    expect(TemplateStatusSchema.safeParse('unknown').success).toBe(false);
  });
});

describe('STATUS_CONFIG label mapping', () => {
  it('approved → label "Aprovado" variante success', () => {
    expect(STATUS_CONFIG['approved']?.label).toBe('Aprovado');
    expect(STATUS_CONFIG['approved']?.variant).toBe('success');
  });

  it('pending → label "Pendente" variante warning', () => {
    expect(STATUS_CONFIG['pending']?.label).toBe('Pendente');
    expect(STATUS_CONFIG['pending']?.variant).toBe('warning');
  });

  it('rejected → label "Rejeitado" variante danger', () => {
    expect(STATUS_CONFIG['rejected']?.label).toBe('Rejeitado');
    expect(STATUS_CONFIG['rejected']?.variant).toBe('danger');
  });

  it('paused → label "Pausado" variante neutral', () => {
    expect(STATUS_CONFIG['paused']?.label).toBe('Pausado');
    expect(STATUS_CONFIG['paused']?.variant).toBe('neutral');
  });
});

// ─── Preview: substituição de variáveis ────────────────────────────────────────

function renderPreview(body: string, variables: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => {
    const idx = parseInt(n, 10) - 1;
    return variables[idx] ?? `{{${n}}}`;
  });
}

describe('renderPreview', () => {
  it('substitui {{1}} e {{2}} pelos nomes semânticos', () => {
    const result = renderPreview('Olá {{1}}, seu crédito de {{2}} está aprovado.', [
      'nome_cliente',
      'valor',
    ]);
    expect(result).toContain('nome_cliente');
    expect(result).toContain('valor');
    expect(result).not.toContain('{{1}}');
    expect(result).not.toContain('{{2}}');
  });

  it('mantém placeholder se variável não definida', () => {
    const result = renderPreview('Olá {{1}}, seu CPF: {{2}}', ['nome_cliente']);
    expect(result).toContain('nome_cliente');
    expect(result).toContain('{{2}}');
  });

  it('body vazio → string vazia', () => {
    expect(renderPreview('', [])).toBe('');
  });
});

// ─── TemplateCreateFormSchema — DLP ───────────────────────────────────────────

describe('TemplateCreateFormSchema — DLP (LGPD)', () => {
  it('aceita body válido com variáveis {{N}}', () => {
    const result = parseCreate({});
    expect(result.success).toBe(true);
  });

  it('rejeita body contendo CPF em forma bruta', () => {
    const result = parseCreate({ body: 'Seu CPF 123.456.789-00 foi aprovado.' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(' ');
      expect(messages).toMatch(/CPF em forma bruta/i);
    }
  });

  it('rejeita body contendo e-mail hardcoded', () => {
    const result = parseCreate({ body: 'Acesse usuario@banco.gov.br para mais info.' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(' ');
      expect(messages).toMatch(/e-mail hardcoded/i);
    }
  });

  it('rejeita body contendo telefone hardcoded', () => {
    const result = parseCreate({ body: 'Ligue para +55 69 99999-0000.' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(' ');
      expect(messages).toMatch(/telefone hardcoded/i);
    }
  });

  it('rejeita name com caracteres inválidos (maiúsculas / espaços)', () => {
    const result = parseCreate({ name: 'NOME INVÁLIDO com espaços' });
    expect(result.success).toBe(false);
  });

  it('rejeita name com hífen (não permitido)', () => {
    const result = parseCreate({ name: 'followup-d1' });
    expect(result.success).toBe(false);
  });

  it('aceita name snake_case minúsculo', () => {
    const result = parseCreate({ name: 'followup_d1' });
    expect(result.success).toBe(true);
  });

  it('rejeita body vazio', () => {
    const result = parseCreate({ body: '' });
    expect(result.success).toBe(false);
  });
});

// ─── TemplateUpdateFormSchema — DLP ───────────────────────────────────────────

describe('TemplateUpdateFormSchema — DLP (LGPD)', () => {
  it('aceita update sem campos (tudo opcional)', () => {
    const result = TemplateUpdateFormSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('aceita update com body válido', () => {
    const result = TemplateUpdateFormSchema.safeParse({
      body: 'Proposta {{1}} aprovada para {{2}}.',
    });
    expect(result.success).toBe(true);
  });

  it('rejeita update com CPF no body', () => {
    const result = TemplateUpdateFormSchema.safeParse({
      body: 'CPF 987.654.321-00 validado.',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(' ');
      expect(messages).toMatch(/CPF em forma bruta/i);
    }
  });
});

// ─── F5-S15 — headerType + headerText ─────────────────────────────────────────

describe('TemplateCreateFormSchema — F5-S15 header', () => {
  it('aceita headerType=none (default)', () => {
    const result = parseCreate({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.headerType).toBe('none');
    }
  });

  it('aceita headerType=text com headerText válido', () => {
    const result = parseCreate({
      headerType: 'text' as const,
      headerText: 'Banco do Povo — Crédito Rural',
    });
    expect(result.success).toBe(true);
  });

  it('rejeita headerType=text sem headerText', () => {
    const result = parseCreate({
      headerType: 'text' as const,
      // headerText ausente
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(' ');
      expect(messages).toMatch(/cabeçalho é obrigatório/i);
    }
  });

  it('rejeita headerText com CPF bruto', () => {
    const result = parseCreate({
      headerType: 'text' as const,
      headerText: 'CPF 123.456.789-00',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(' ');
      expect(messages).toMatch(/CPF em forma bruta/i);
    }
  });

  it('rejeita headerText com e-mail hardcoded', () => {
    const result = parseCreate({
      headerType: 'text' as const,
      headerText: 'Contato: usuario@banco.gov.br',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(' ');
      expect(messages).toMatch(/e-mail hardcoded/i);
    }
  });

  it('rejeita headerText quando headerType=document', () => {
    const result = parseCreate({
      headerType: 'document' as const,
      headerText: 'Texto indevido',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(' ');
      expect(messages).toMatch(/só é permitido quando o tipo é 'Texto'/i);
    }
  });

  it('aceita headerType=document sem headerText', () => {
    const result = parseCreate({
      headerType: 'document' as const,
    });
    expect(result.success).toBe(true);
  });

  it('aceita headerType=image sem headerText', () => {
    const result = parseCreate({
      headerType: 'image' as const,
    });
    expect(result.success).toBe(true);
  });

  it('rejeita headerText > 60 caracteres', () => {
    const result = parseCreate({
      headerType: 'text' as const,
      headerText: 'A'.repeat(61),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(' ');
      expect(messages).toMatch(/Máximo 60 caracteres/i);
    }
  });
});

describe('TemplateUpdateFormSchema — F5-S15 header', () => {
  it('aceita update com headerType=text e headerText válido', () => {
    const result = TemplateUpdateFormSchema.safeParse({
      headerType: 'text',
      headerText: 'Novo título',
    });
    expect(result.success).toBe(true);
  });

  it('rejeita update com headerType=text sem headerText', () => {
    const result = TemplateUpdateFormSchema.safeParse({
      headerType: 'text',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(' ');
      expect(messages).toMatch(/cabeçalho é obrigatório/i);
    }
  });

  it('aceita update com headerType=document sem headerText', () => {
    const result = TemplateUpdateFormSchema.safeParse({
      headerType: 'document',
    });
    expect(result.success).toBe(true);
  });
});
