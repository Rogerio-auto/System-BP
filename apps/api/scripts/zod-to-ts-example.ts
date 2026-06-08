/(?!000\.000\.000-00)\d{3}\.\d{3}\.\d{3}-\d{2}/;
// scripts/zod-to-ts-example.ts — Helper Zod -> TS example
//
// Recebe um schema Zod e retorna { tsCode: string, exampleValue: unknown }.
// Valores realistas com placeholders LGPD-safe (nunca CPF/telefone reais).
//
// Suportados: ZodObject, ZodArray, ZodEnum, ZodLiteral, ZodOptional,
//   ZodNullable, ZodUnion, ZodString, ZodNumber, ZodBoolean, ZodDate.
// Outros -> fallback "<...>".
//
// LGPD: placeholders ficticios. assertNoPiiInExample() falha se detectar CPF real.
// =============================================================================
import type { z } from 'zod';

// ---------------------------------------------------------------------------
// LGPD placeholder constants
// ---------------------------------------------------------------------------

export const PLACEHOLDER_COMMENT = '// Valores fictícios — substituir antes de enviar';

const FAKE_UUID = '00000000-0000-4000-8000-000000000001';
const FAKE_EMAIL = 'usuario@example.com';
const FAKE_CPF = '000.000.000-00';
const FAKE_TELEFONE = '(11) 99999-9999';
const FAKE_NAME = 'João da Silva';
const FAKE_DATE = '2024-01-15T00:00:00.000Z';
const FAKE_URL = 'https://example.com';

// ---------------------------------------------------------------------------
// LGPD check: rejects real CPF patterns
// CPF format: ddd.ddd.ddd-dd  (with or without ponctuation)
// The negative lookahead ensures we skip the 000.000.000-00 placeholder.
// ---------------------------------------------------------------------------

// CPF real: requires dot separators (ddd.ddd.ddd-dd) to avoid false positives from UUIDs
const REAL_CPF_PATTERN = /(?!000\.000\.000-00)\d{3}\.\d{3}\.\d{3}-\d{2}/;
export function assertNoPiiInExample(value: unknown): void {
  const str = JSON.stringify(value) ?? '';
  if (REAL_CPF_PATTERN.test(str)) {
    throw new Error(
      'LGPD violation: generated example contains a real CPF pattern. Use placeholder 000.000.000-00.',
    );
  }
}

// ---------------------------------------------------------------------------
// String heuristics
// ---------------------------------------------------------------------------

function fakeStringByDescription(description: string | undefined): string {
  if (!description) return 'string';
  const d = description.toLowerCase();
  if (d.includes('cpf')) return FAKE_CPF;
  if (d.includes('telefone') || d.includes('phone') || d.includes('fone')) return FAKE_TELEFONE;
  if (d.includes('email') || d.includes('e-mail')) return FAKE_EMAIL;
  if (d.includes('nome') || d.includes('name')) return FAKE_NAME;
  if (d.includes('uuid') || d.includes('id')) return FAKE_UUID;
  if (d.includes('url') || d.includes('link')) return FAKE_URL;
  if (d.includes('data') || d.includes('date')) return FAKE_DATE;
  return 'string';
}

function fakeStringByChecks(checks: z.ZodStringDef['checks']): string | null {
  if (!checks?.length) return null;
  for (const check of checks) {
    if (check.kind === 'email') return FAKE_EMAIL;
    if (check.kind === 'uuid') return FAKE_UUID;
    if (check.kind === 'url') return FAKE_URL;
    if (check.kind === 'datetime') return FAKE_DATE;
    if (check.kind === 'regex') {
      const src = (check as { kind: 'regex'; regex: RegExp }).regex?.source ?? '';
      if (src.includes('cpf') || src.includes('CPF') || src.includes('telefone')) {
        return FAKE_CPF;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Core resolver
// ---------------------------------------------------------------------------

export interface ZodExample {
  tsCode: string;
  exampleValue: unknown;
}

type AnyDef = z.ZodTypeAny['_def'];

function exampleFromDef(def: AnyDef, depth = 0): unknown {
  if (depth > 8) return '<...>';

  const typeName = (def as { typeName: string }).typeName;

  switch (typeName) {
    case 'ZodString': {
      const d = def as z.ZodStringDef;
      const byChecks = fakeStringByChecks(d.checks);
      if (byChecks !== null) return byChecks;
      return fakeStringByDescription((d as unknown as { description?: string }).description);
    }

    case 'ZodNumber': {
      return 1;
    }

    case 'ZodBoolean': {
      return true;
    }

    case 'ZodDate': {
      return FAKE_DATE;
    }

    case 'ZodLiteral': {
      return (def as z.ZodLiteralDef).value;
    }

    case 'ZodEnum': {
      const vals = (def as z.ZodEnumDef).values as unknown as string[];
      return vals[0] ?? '<enum>';
    }

    case 'ZodNativeEnum': {
      const vals = Object.values((def as z.ZodNativeEnumDef).values as Record<string, unknown>);
      return vals[0] ?? '<enum>';
    }

    case 'ZodOptional': {
      return exampleFromDef((def as z.ZodOptionalDef).innerType._def, depth);
    }

    case 'ZodNullable': {
      return exampleFromDef((def as z.ZodNullableDef).innerType._def, depth);
    }

    case 'ZodDefault': {
      return exampleFromDef((def as z.ZodDefaultDef).innerType._def, depth);
    }

    case 'ZodUnion': {
      const options = (def as z.ZodUnionDef).options as unknown as z.ZodTypeAny[];
      return exampleFromDef(options[0]!._def, depth);
    }

    case 'ZodDiscriminatedUnion': {
      // options is ZodDiscriminatedUnionOption[] — just cast to unknown[] for simplicity
      const rawOpts = (def as z.ZodDiscriminatedUnionDef<string>)
        .options as unknown as z.ZodTypeAny[];
      const firstOpt = rawOpts[0];
      if (!firstOpt) return '<...>';
      return exampleFromDef(firstOpt._def, depth);
    }

    case 'ZodArray': {
      return [exampleFromDef((def as z.ZodArrayDef).type._def, depth + 1)];
    }

    case 'ZodObject': {
      const shape = (def as z.ZodObjectDef).shape() as Record<string, z.ZodTypeAny>;
      const result: Record<string, unknown> = {};
      for (const [key, fieldSchema] of Object.entries(shape)) {
        result[key] = exampleFromDef(fieldSchema._def, depth + 1);
      }
      return result;
    }

    case 'ZodRecord': {
      return { chave: exampleFromDef((def as z.ZodRecordDef).valueType._def, depth + 1) };
    }

    case 'ZodTuple': {
      return ((def as z.ZodTupleDef).items as unknown as z.ZodTypeAny[]).map((item) =>
        exampleFromDef(item._def, depth + 1),
      );
    }

    case 'ZodEffects': {
      return exampleFromDef((def as z.ZodEffectsDef).schema._def, depth);
    }

    case 'ZodBranded': {
      return exampleFromDef((def as z.ZodBrandedDef<z.ZodTypeAny>).type._def, depth);
    }

    case 'ZodPipeline': {
      return exampleFromDef((def as z.ZodPipelineDef<z.ZodTypeAny, z.ZodTypeAny>).in._def, depth);
    }

    case 'ZodNull': {
      return null;
    }

    case 'ZodUndefined':
    case 'ZodVoid': {
      return undefined;
    }

    case 'ZodAny':
    case 'ZodUnknown': {
      return '<...>';
    }

    default: {
      return '<...>';
    }
  }
}

/**
 * Gera um exemplo TypeScript a partir de um schema Zod.
 *
 * LGPD: usa placeholders ficticios. Lança erro se detectar CPF real valido.
 */
export function zodToTsExample(schema: z.ZodTypeAny): ZodExample {
  const exampleValue = exampleFromDef(schema._def);

  assertNoPiiInExample(exampleValue);

  const tsCode = `${PLACEHOLDER_COMMENT}\n${JSON.stringify(exampleValue, null, 2)}`;

  return { tsCode, exampleValue };
}
