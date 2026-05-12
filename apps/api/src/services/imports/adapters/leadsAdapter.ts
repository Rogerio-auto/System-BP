// =============================================================================
// services/imports/adapters/leadsAdapter.ts — Adapter de leads para importação.
//
// Implementa ImportAdapter<LeadsParsed, LeadsCreateInput> para o pipeline de import.
//
// Fases:
//   parseRow     — extrai campos (name, phone, email, city_name, source, ...).
//   validateRow  — aplica Zod (LeadCreateSchema), normaliza phone para E.164,
//                  resolve city_name → city_id, verifica dedupe de phone.
//   persistRow   — chama createLead do service de leads.
//
// LGPD §8.5:
//   Dados brutos (raw) e normalizados (parsed) podem conter PII.
//   Nunca logar raw ou parsed sem redact aplicado pelo chamador.
//   Dedupe por phone_normalized evita duplicatas dentro da mesma org.
// =============================================================================
import { and, eq, isNull } from 'drizzle-orm';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { z } from 'zod';

import { db } from '../../../db/client.js';
import { cities } from '../../../db/schema/cities.js';
import { leads } from '../../../db/schema/leads.js';
import { createLead } from '../../../modules/leads/service.js';
import { AppError } from '../../../shared/errors.js';
import type { ImportAdapter, ImportContext, PersistResult, Transaction } from '../adapter.js';

// Re-export isParseError para uso nos testes
export { isParseError } from '../adapter.js';

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

/** Resultado do parseRow — campos extraídos da linha bruta. */
export interface LeadsParsed {
  name: string;
  /** Telefone raw — pode ser qualquer formato, normalizado em validateRow. */
  phoneRaw: string;
  email: string | null;
  /** Nome da cidade (como está no CSV). Resolvido para city_id em validateRow. */
  cityName: string | null;
  /** Fonte do lead. Default: 'import'. */
  source: string;
  /** CPF raw (opcional). */
  cpf: string | null;
  /** Notas livres. */
  notes: string | null;
}

/** Input para createLead do service (F1-S11). */
export interface LeadsCreateInput {
  name: string;
  phone_e164: string;
  email: string | null;
  city_id: string;
  source: 'whatsapp' | 'manual' | 'import' | 'chatwoot' | 'api';
  status: 'new';
  cpf: string | null;
  notes: string | null;
  agent_id: null;
  metadata: { import_batch_id: string; original_city_name?: string | null };
}

// ---------------------------------------------------------------------------
// Mapeamento de aliases de colunas (case-insensitive)
// ---------------------------------------------------------------------------

const COLUMN_ALIASES: Record<keyof LeadsParsed, string[]> = {
  name: ['name', 'nome', 'nome_completo', 'Nome', 'NOME'],
  phoneRaw: ['phone', 'telefone', 'fone', 'celular', 'phone_e164', 'Phone', 'TELEFONE'],
  email: ['email', 'e-mail', 'Email', 'EMAIL'],
  cityName: ['city', 'cidade', 'city_name', 'Cidade', 'CIDADE'],
  source: ['source', 'origem', 'Source', 'ORIGEM'],
  cpf: ['cpf', 'CPF', 'documento'],
  notes: ['notes', 'notas', 'observacoes', 'observações', 'Notes'],
};

/**
 * Extrai um campo do objeto raw usando múltiplos aliases possíveis.
 * Retorna a string limpa ou null se não encontrado.
 */
function extractField(raw: Record<string, unknown>, field: keyof LeadsParsed): string | null {
  const aliases = COLUMN_ALIASES[field];
  for (const alias of aliases) {
    const val = raw[alias];
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      return String(val).trim();
    }
    // Case-insensitive fallback
    const keyLower = alias.toLowerCase();
    const matchedKey = Object.keys(raw).find((k) => k.toLowerCase() === keyLower);
    if (matchedKey !== undefined) {
      const v = raw[matchedKey];
      if (v !== undefined && v !== null && String(v).trim() !== '') {
        return String(v).trim();
      }
    }
  }
  return null;
}

/**
 * Normaliza um telefone raw para formato E.164.
 * Tenta múltiplas estratégias:
 *   1. libphonenumber com assumção de BR (+55).
 *   2. Se já começa com +, parse direto.
 *
 * Retorna null se não conseguir normalizar.
 */
function toE164(phoneRaw: string): string | null {
  // Remove formatação comum (espaços, traços, parênteses)
  const cleaned = phoneRaw.replace(/[\s\-().]/g, '');

  // Tenta parse com country BR como default
  const parsed = parsePhoneNumberFromString(cleaned, 'BR');
  if (parsed?.isValid()) {
    return parsed.format('E.164');
  }

  // Se já inicia com +, tenta parse internacional
  if (cleaned.startsWith('+')) {
    const intl = parsePhoneNumberFromString(cleaned);
    if (intl?.isValid()) {
      return intl.format('E.164');
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Busca city_id por nome (case-insensitive) na org
// ---------------------------------------------------------------------------

async function resolveCityByName(
  database: typeof db,
  cityName: string,
  organizationId: string,
): Promise<string | null> {
  const results = await database
    .select({ id: cities.id })
    .from(cities)
    .where(
      and(
        eq(cities.organizationId, organizationId),
        // name é citext — comparação case-insensitive nativa
        eq(cities.name, cityName),
        isNull(cities.deletedAt),
      ),
    )
    .limit(1);

  return results[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// Dedupe: verifica se phone_normalized já existe na org
// ---------------------------------------------------------------------------

async function phoneExistsInOrg(
  database: typeof db,
  phoneNormalized: string,
  organizationId: string,
): Promise<boolean> {
  const results = await database
    .select({ id: leads.id })
    .from(leads)
    .where(
      and(
        eq(leads.organizationId, organizationId),
        eq(leads.phoneNormalized, phoneNormalized),
        isNull(leads.deletedAt),
      ),
    )
    .limit(1);

  return results.length > 0;
}

// ---------------------------------------------------------------------------
// Implementação do adapter
// ---------------------------------------------------------------------------

const VALID_SOURCES = ['whatsapp', 'manual', 'import', 'chatwoot', 'api'] as const;

export const leadsAdapter: ImportAdapter<LeadsParsed, LeadsCreateInput> = {
  entityType: 'leads',

  // -------------------------------------------------------------------------
  // parseRow — extrai campos da linha bruta
  // -------------------------------------------------------------------------
  parseRow(raw: Record<string, unknown>): LeadsParsed | { error: string } {
    const name = extractField(raw, 'name');
    if (name === null) {
      return { error: 'Campo obrigatório ausente: nome (name, nome, nome_completo)' };
    }

    const phoneRaw = extractField(raw, 'phoneRaw');
    if (phoneRaw === null) {
      return { error: 'Campo obrigatório ausente: telefone (phone, telefone, celular)' };
    }

    const sourceRaw = extractField(raw, 'source');
    // Default para 'import' se não informado ou inválido
    const source: string =
      sourceRaw !== null && VALID_SOURCES.includes(sourceRaw as (typeof VALID_SOURCES)[number])
        ? sourceRaw
        : 'import';

    return {
      name,
      phoneRaw,
      email: extractField(raw, 'email'),
      cityName: extractField(raw, 'cityName'),
      source,
      cpf: extractField(raw, 'cpf'),
      notes: extractField(raw, 'notes'),
    };
  },

  // -------------------------------------------------------------------------
  // validateRow — valida, normaliza e verifica dedupe
  // -------------------------------------------------------------------------
  async validateRow(
    parsed: LeadsParsed,
    ctx: ImportContext,
  ): Promise<{ input: LeadsCreateInput; errors?: never } | { errors: string[]; input?: never }> {
    const errors: string[] = [];

    // 1. Normalizar phone para E.164
    const phone_e164 = toE164(parsed.phoneRaw);
    if (phone_e164 === null) {
      errors.push(`Telefone inválido: "${parsed.phoneRaw}". Use o formato +5511999999999`);
    }

    // 2. Validar email (se presente)
    if (parsed.email !== null) {
      const emailResult = z.string().email().safeParse(parsed.email);
      if (!emailResult.success) {
        errors.push(`Email inválido: "${parsed.email}"`);
      }
    }

    // 3. Resolver city_name → city_id
    let cityId: string | null = null;
    if (parsed.cityName !== null) {
      // Usamos db global — a transaction injetada em persistRow é para a escrita.
      // Aqui as consultas de validação são read-only, db global é correto.
      cityId = await resolveCityByName(db, parsed.cityName, ctx.organizationId);
      if (cityId === null) {
        errors.push(`Cidade não encontrada: "${parsed.cityName}"`);
      }
    } else {
      errors.push('Cidade obrigatória (city, cidade, city_name)');
    }

    // 4. Verificar dedupe de phone na org (apenas se phone é válido)
    if (phone_e164 !== null) {
      const phoneNormalized = phone_e164.replace(/^\+/, '');
      const exists = await phoneExistsInOrg(db, phoneNormalized, ctx.organizationId);
      if (exists) {
        errors.push(`Telefone já cadastrado na organização: "${parsed.phoneRaw}"`);
      }
    }

    if (errors.length > 0) {
      return { errors };
    }

    // TypeScript: narrowing após os guards acima
    // `as` justificado: já verificamos que phone_e164 e cityId não são null
    const sourceValue = VALID_SOURCES.includes(parsed.source as (typeof VALID_SOURCES)[number])
      ? (parsed.source as (typeof VALID_SOURCES)[number])
      : ('import' as const);

    return {
      input: {
        name: parsed.name,
        phone_e164: phone_e164 as string,
        email: parsed.email,
        city_id: cityId as string,
        source: sourceValue,
        status: 'new',
        cpf: parsed.cpf,
        notes: parsed.notes,
        agent_id: null,
        metadata: {
          import_batch_id: ctx.batchId,
          original_city_name: parsed.cityName,
        },
      },
    };
  },

  // -------------------------------------------------------------------------
  // persistRow — cria o lead via service (F1-S11)
  // -------------------------------------------------------------------------
  async persistRow(
    input: LeadsCreateInput,
    ctx: ImportContext,
    _tx: Transaction,
  ): Promise<PersistResult> {
    // createLead gerencia sua própria transação internamente (inclui outbox + audit).
    // Não passamos `_tx` pois createLead cria nova transação (limitação MVP).
    // TODO(F2): refatorar createLead para aceitar transação externa para atomicidade total.

    const actor = {
      userId: ctx.userId,
      organizationId: ctx.organizationId,
      role: 'import',
      cityScopeIds: null as string[] | null,
      ip: ctx.ip,
      userAgent: null as string | null,
    };

    try {
      const lead = await createLead(db, actor, {
        ...input,
        source: 'import',
      });

      return { entityId: lead.id };
    } catch (err: unknown) {
      // Converter erros de duplicate phone para erro legível
      if (err instanceof AppError && err.statusCode === 409) {
        throw err; // re-throw para o worker marcar como 'failed'
      }
      throw err;
    }
  },
};
