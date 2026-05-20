// =============================================================================
// ai-console/playground/repository.ts — Queries Drizzle para o módulo playground.
//
// Responsabilidades:
//   - Carregar contexto real de lead/city (somente leitura) quando o operador
//     passou use_real_context=true com lead_id/city_id.
//   - Nenhuma escrita de estado de conversa — dry-run não persiste nada.
//
// LGPD (doc 17 §8.4):
//   - lead.cpf é cifrado — retornamos apenas metadados não-PII para o contexto.
//   - Nunca retornar CPF bruto, e-mail bruto ou telefone bruto.
//   - city_id e lead_id são IDs opacos, não são PII per se.
//
// Sem applyCityScope aqui:
//   - O playground é admin-only (ai_playground:run).
//   - Admin tem acesso global — sem necessidade de escopo de cidade.
//   - A permissão já foi verificada pelo middleware authorize() antes do handler.
// =============================================================================
import { and, eq, isNull } from 'drizzle-orm';

import type { Database } from '../../../db/client.js';
import { cities } from '../../../db/schema/cities.js';
import { leads } from '../../../db/schema/leads.js';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/**
 * Metadados não-PII do lead para enriquecer o contexto do playground.
 * Nunca expõe CPF, e-mail ou telefone em claro.
 */
export interface LeadContext {
  leadId: string;
  /** UUID da cidade do lead. */
  cityId: string | null;
  /** Nome da cidade. null se sem cidade. */
  cityName: string | null;
  /** Status do lead. */
  status: string;
}

/**
 * Metadados da cidade para enriquecer o contexto do playground.
 */
export interface CityContext {
  cityId: string;
  cityName: string;
}

// ---------------------------------------------------------------------------
// Queries de leitura de contexto
// ---------------------------------------------------------------------------

/**
 * Carrega metadados não-PII de um lead para o contexto do playground.
 *
 * Somente leitura — nunca escreve. Admin-only (verificado pelo middleware).
 *
 * @param db Database instance.
 * @param organizationId UUID da organização (multi-tenant).
 * @param leadId UUID do lead.
 * @returns LeadContext ou null se não encontrado.
 */
export async function loadLeadContext(
  db: Database,
  organizationId: string,
  leadId: string,
): Promise<LeadContext | null> {
  const rows = await db
    .select({
      leadId: leads.id,
      cityId: leads.cityId,
      cityName: cities.name,
      status: leads.status,
    })
    .from(leads)
    // LEFT JOIN cidade para obter o nome
    .leftJoin(cities, eq(leads.cityId, cities.id))
    .where(
      and(eq(leads.id, leadId), eq(leads.organizationId, organizationId), isNull(leads.deletedAt)),
    )
    .limit(1);

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    leadId: row.leadId,
    cityId: row.cityId ?? null,
    cityName: row.cityName ?? null,
    status: row.status,
  };
}

/**
 * Carrega metadados de uma cidade para o contexto do playground.
 *
 * Somente leitura — nunca escreve. Admin-only (verificado pelo middleware).
 *
 * @param db Database instance.
 * @param organizationId UUID da organização (multi-tenant).
 * @param cityId UUID da cidade.
 * @returns CityContext ou null se não encontrada.
 */
export async function loadCityContext(
  db: Database,
  organizationId: string,
  cityId: string,
): Promise<CityContext | null> {
  const rows = await db
    .select({
      cityId: cities.id,
      cityName: cities.name,
    })
    .from(cities)
    .where(and(eq(cities.id, cityId), eq(cities.organizationId, organizationId)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    cityId: row.cityId,
    cityName: row.cityName,
  };
}
