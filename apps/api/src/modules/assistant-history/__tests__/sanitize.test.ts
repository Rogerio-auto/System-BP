// =============================================================================
// modules/assistant-history/__tests__/sanitize.test.ts — F6-S25
//
// Testes puros (sem DB) da higienização de texto antes de persistir:
//   - maskNames: heurística Title Case mascara nomes compostos.
//   - sanitizeForPersistence: DLP (CPF/telefone) + mascaramento de nome.
//   - deriveConversationTitle: título NUNCA interpola texto livre — só
//     escolhe entre um conjunto fixo de rótulos por intenção (garantia por
//     construção, não apenas heurística).
// =============================================================================
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CONVERSATION_TITLE,
  deriveConversationTitle,
  maskNames,
  sanitizeForPersistence,
  sanitizeUserProvidedTitle,
} from '../sanitize.js';

describe('F6-S25: maskNames — heurística Title Case', () => {
  it('mascara nome composto de 2 palavras', () => {
    expect(maskNames('Qual o status do João Silva?')).toBe('Qual o status do <NOME>?');
  });

  it('mascara nome composto com conector (de/da/do/dos/das)', () => {
    expect(maskNames('Preciso ver os dados de Maria Aparecida de Souza')).toBe(
      'Preciso ver os dados de <NOME>',
    );
  });

  it('NÃO mascara uma única palavra Title Case (ex.: nome de cidade isolado)', () => {
    expect(maskNames('Análise do funil de Ariquemes')).toBe('Análise do funil de Ariquemes');
  });

  it('não altera texto sem sequência Title Case', () => {
    expect(maskNames('quantos leads temos hoje?')).toBe('quantos leads temos hoje?');
  });
});

describe('F6-S25: sanitizeForPersistence — DLP + mascaramento de nome', () => {
  it('mascara CPF e nome no mesmo texto', () => {
    const result = sanitizeForPersistence('CPF de João Silva é 123.456.789-01');
    expect(result).not.toMatch(/\d{3}\D?\d{3}\D?\d{3}\D?\d{2}/);
    expect(result).not.toContain('João Silva');
    expect(result).toContain('<NOME>');
  });

  it('mascara telefone', () => {
    const result = sanitizeForPersistence('Ligar para (69) 99999-8888');
    expect(result).not.toMatch(/99999-8888/);
  });

  it('idempotente: reaplicar não reintroduz PII', () => {
    const once = sanitizeForPersistence('João Silva, CPF 123.456.789-01');
    const twice = sanitizeForPersistence(once);
    expect(twice).not.toContain('João Silva');
    expect(twice).not.toMatch(/\d{3}\D?\d{3}\D?\d{3}\D?\d{2}/);
  });
});

describe('F6-S25: deriveConversationTitle — nunca interpola texto livre', () => {
  it('retorna rótulo fixo para intenção de funil', () => {
    expect(deriveConversationTitle('Quantos leads estão no funil de Ariquemes?')).toBe(
      'Análise do funil',
    );
  });

  it('retorna rótulo fixo para intenção de cobrança', () => {
    expect(deriveConversationTitle('Quais cobranças estão em atraso?')).toBe('Cobranças em atraso');
  });

  it('retorna título padrão quando nenhuma regra casa', () => {
    expect(deriveConversationTitle('bom dia, tudo bem?')).toBe(DEFAULT_CONVERSATION_TITLE);
  });

  it('NUNCA contém um nome próprio, mesmo que a pergunta tenha um nome não-mascarado', () => {
    // Mesmo se a chamada de sanitização de nome falhasse por algum motivo,
    // deriveConversationTitle não interpola o texto de entrada no resultado
    // — é uma garantia por construção, testada aqui diretamente com um nome
    // "vazando" na entrada.
    const withLeakedName = 'Qual o funil do lead João Pedro da Silva Santos?';
    const title = deriveConversationTitle(withLeakedName);
    expect(title).toBe('Análise do funil');
    expect(title).not.toContain('João');
    expect(title).not.toContain('Silva');
  });
});

describe('F6-S25: sanitizeUserProvidedTitle', () => {
  it('higieniza título fornecido pelo usuário (DLP + nome)', () => {
    const result = sanitizeUserProvidedTitle('Conversa sobre João Silva');
    expect(result).not.toContain('João Silva');
  });

  it('título vazio após sanitização cai no default', () => {
    expect(sanitizeUserProvidedTitle('   ')).toBe(DEFAULT_CONVERSATION_TITLE);
  });

  it('trunca títulos muito longos', () => {
    const long = 'a'.repeat(300);
    const result = sanitizeUserProvidedTitle(long);
    expect(result.length).toBeLessThanOrEqual(200);
  });
});
