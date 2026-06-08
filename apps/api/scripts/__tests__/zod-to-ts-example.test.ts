// =============================================================================
// scripts/__tests__/zod-to-ts-example.test.ts — 10 fixtures cobrindo todos
// os tipos suportados + check LGPD.
// =============================================================================
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { assertNoPiiInExample, zodToTsExample } from '../zod-to-ts-example';

describe('zodToTsExample', () => {
  // 1. ZodString — simples
  it('ZodString retorna string placeholder', () => {
    const { exampleValue } = zodToTsExample(z.string());
    expect(typeof exampleValue).toBe('string');
  });

  // 2. ZodString com email check
  it('ZodString com .email() retorna placeholder de email', () => {
    const { exampleValue } = zodToTsExample(z.string().email());
    expect(exampleValue).toBe('usuario@example.com');
  });

  // 3. ZodString com uuid check
  it('ZodString com .uuid() retorna UUID placeholder', () => {
    const { exampleValue } = zodToTsExample(z.string().uuid());
    expect(exampleValue).toBe('00000000-0000-4000-8000-000000000001');
  });

  // 4. ZodNumber
  it('ZodNumber retorna numero', () => {
    const { exampleValue } = zodToTsExample(z.number());
    expect(typeof exampleValue).toBe('number');
  });

  // 5. ZodBoolean
  it('ZodBoolean retorna boolean', () => {
    const { exampleValue } = zodToTsExample(z.boolean());
    expect(typeof exampleValue).toBe('boolean');
  });

  // 6. ZodEnum
  it('ZodEnum retorna o primeiro valor', () => {
    const schema = z.enum(['admin', 'gestor', 'agente']);
    const { exampleValue } = zodToTsExample(schema);
    expect(exampleValue).toBe('admin');
  });

  // 7. ZodOptional
  it('ZodOptional drills into inner type', () => {
    const schema = z.optional(z.string().email());
    const { exampleValue } = zodToTsExample(schema);
    expect(exampleValue).toBe('usuario@example.com');
  });

  // 8. ZodNullable
  it('ZodNullable drills into inner type', () => {
    const schema = z.nullable(z.number());
    const { exampleValue } = zodToTsExample(schema);
    expect(typeof exampleValue).toBe('number');
  });

  // 9. ZodArray
  it('ZodArray retorna array com um elemento', () => {
    const schema = z.array(z.string().email());
    const { exampleValue } = zodToTsExample(schema);
    expect(Array.isArray(exampleValue)).toBe(true);
    expect((exampleValue as unknown[])[0]).toBe('usuario@example.com');
  });

  // 10. ZodObject
  it('ZodObject retorna objeto com campos corretos', () => {
    const schema = z.object({
      id: z.string().uuid(),
      email: z.string().email(),
      ativo: z.boolean(),
      papel: z.enum(['admin', 'gestor']),
      score: z.number(),
    });
    const { exampleValue } = zodToTsExample(schema);
    const obj = exampleValue as Record<string, unknown>;
    expect(obj['id']).toBe('00000000-0000-4000-8000-000000000001');
    expect(obj['email']).toBe('usuario@example.com');
    expect(typeof obj['ativo']).toBe('boolean');
    expect(obj['papel']).toBe('admin');
    expect(typeof obj['score']).toBe('number');
  });

  // 11. ZodUnion — pega o primeiro
  it('ZodUnion retorna exemplo do primeiro tipo', () => {
    const schema = z.union([z.string(), z.number()]);
    const { exampleValue } = zodToTsExample(schema);
    expect(typeof exampleValue).toBe('string');
  });

  // 12. ZodLiteral
  it('ZodLiteral retorna o valor literal', () => {
    const schema = z.literal('ativo');
    const { exampleValue } = zodToTsExample(schema);
    expect(exampleValue).toBe('ativo');
  });

  // 13. tsCode inclui comentário LGPD
  it('tsCode inclui comentário de valores fictícios', () => {
    const { tsCode } = zodToTsExample(z.string());
    expect(tsCode).toContain('Valores fictícios');
  });

  // 14. LGPD: assertNoPiiInExample rejeita CPF real
  it('assertNoPiiInExample lança erro para CPF real', () => {
    expect(() => assertNoPiiInExample({ cpf: '123.456.789-09' })).toThrow(/LGPD/);
  });

  // 15. LGPD: placeholder 000.000.000-00 não lança erro
  it('assertNoPiiInExample nao lança erro para CPF placeholder', () => {
    expect(() => assertNoPiiInExample({ cpf: '000.000.000-00' })).not.toThrow();
  });
});
