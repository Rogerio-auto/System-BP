// =============================================================================
// __tests__/ProductDrawer.test.tsx — Testes de lógica pura do ProductDrawer.
//
// Estratégia: testa lógica pura isolada sem renderizar React
// (JSDOM não configurado no vitest deste projeto).
//
// Cobertura:
//   1. nameToKey: geração automática de key a partir do nome
//   2. Validação do schema Zod (ProductFormSchema)
//   3. Casos edge: caracteres especiais, acentos, espaços múltiplos
// =============================================================================

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Replica da função nameToKey (mesma lógica do ProductDrawer.tsx)
// ---------------------------------------------------------------------------

function nameToKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_') // espaços/especiais → _
    .replace(/^_+|_+$/g, '') // trim underscores
    .slice(0, 60);
}

// ---------------------------------------------------------------------------
// Schema Zod inline (replica do ProductDrawer — para testar validação)
// ---------------------------------------------------------------------------

const ProductFormSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório').max(200, 'Nome muito longo'),
  key: z
    .string()
    .min(3, 'key deve ter ao menos 3 caracteres')
    .max(60, 'key deve ter no máximo 60 caracteres')
    .regex(/^[a-z0-9_]+$/, 'key: apenas letras minúsculas, dígitos e underscores'),
  description: z.string().max(1000, 'Descrição muito longa').optional(),
  is_active: z.boolean(),
});

// ---------------------------------------------------------------------------
// Testes: nameToKey
// ---------------------------------------------------------------------------

describe('nameToKey', () => {
  it('converte nome simples em snake_case', () => {
    expect(nameToKey('Microcrédito Básico')).toBe('microcredito_basico');
  });

  it('remove acentos', () => {
    expect(nameToKey('Crédito Especial')).toBe('credito_especial');
  });

  it('substitui espaços múltiplos por underscore único', () => {
    expect(nameToKey('Produto   de   Crédito')).toBe('produto_de_credito');
  });

  it('remove caracteres especiais', () => {
    expect(nameToKey('Produto (v2) - Teste!')).toBe('produto_v2_teste');
  });

  it('limita a 60 caracteres', () => {
    const longName = 'a'.repeat(70);
    expect(nameToKey(longName)).toHaveLength(60);
  });

  it('retorna string vazia para input vazio', () => {
    expect(nameToKey('')).toBe('');
  });

  it('não começa nem termina com underscore', () => {
    expect(nameToKey(' produto ')).toBe('produto');
  });

  it('preserva dígitos', () => {
    expect(nameToKey('Produto 2024')).toBe('produto_2024');
  });
});

// ---------------------------------------------------------------------------
// Testes: ProductFormSchema (Zod)
// ---------------------------------------------------------------------------

describe('ProductFormSchema', () => {
  it('aceita dados válidos', () => {
    const result = ProductFormSchema.safeParse({
      name: 'Microcrédito Básico',
      key: 'microcredito_basico',
      is_active: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejeita name vazio', () => {
    const result = ProductFormSchema.safeParse({
      name: '',
      key: 'test_key',
      is_active: true,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const nameError = result.error.issues.find((i) => i.path[0] === 'name');
      expect(nameError).toBeDefined();
    }
  });

  it('rejeita key com menos de 3 caracteres', () => {
    const result = ProductFormSchema.safeParse({
      name: 'Produto',
      key: 'ab',
      is_active: true,
    });
    expect(result.success).toBe(false);
  });

  it('rejeita key com letras maiúsculas', () => {
    const result = ProductFormSchema.safeParse({
      name: 'Produto',
      key: 'MyProduct',
      is_active: true,
    });
    expect(result.success).toBe(false);
  });

  it('rejeita key com espaços', () => {
    const result = ProductFormSchema.safeParse({
      name: 'Produto',
      key: 'my product',
      is_active: true,
    });
    expect(result.success).toBe(false);
  });

  it('aceita key com dígitos', () => {
    const result = ProductFormSchema.safeParse({
      name: 'Produto 2024',
      key: 'produto_2024',
      is_active: true,
    });
    expect(result.success).toBe(true);
  });

  it('aceita description opcional ausente', () => {
    const result = ProductFormSchema.safeParse({
      name: 'Produto',
      key: 'produto_test',
      is_active: false,
    });
    expect(result.success).toBe(true);
  });

  it('rejeita description maior que 1000 chars', () => {
    const result = ProductFormSchema.safeParse({
      name: 'Produto',
      key: 'produto_test',
      description: 'x'.repeat(1001),
      is_active: true,
    });
    expect(result.success).toBe(false);
  });
});
