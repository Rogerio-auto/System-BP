// =============================================================================
// channels/repository.ts — Queries Drizzle para o módulo de canais (F16-S11).
//
// Responsabilidades:
//   - findChannels: lista canais com filtros de org, cidade e status.
//   - findChannelByProviderKey: busca por (orgId, provider, phoneNumberId|igUserId|wahaSessionId)
//     para deduplicação idempotente.
//   - findChannelById: busca por ID com scope de org (nunca retorna channel_secrets).
//   - insertChannelWithSecrets: insere channel + channel_secrets em transação.
//   - softDeleteChannel: marca deleted_at = now().
//
// City scope:
//   - cityScopeIds === null  → acesso global (admin): sem filtro de cidade.
//   - cityScopeIds === []    → sem acesso: retorna vazio.
//   - cityScopeIds: string[] → WHERE city_id IN (...).
//
// LGPD (doc 17 §8.1):
//   - Colunas *_enc NUNCA selecionadas nas queries públicas.
//   - channel_secrets NUNCA retornada nas queries de listagem/detalhe.
// =============================================================================
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import type { NewChannel } from '../../db/schema/channels.js';
import type { NewChannelSecret } from '../../db/schema/channelSecrets.js';
import { channelSecrets, channels } from '../../db/schema/index.js';

// ---------------------------------------------------------------------------
// Tipos de retorno
// ---------------------------------------------------------------------------

/**
 * Row pública do canal — sem segredos, sem PII cifrada.
 * Espelha ChannelDto de shared-types/livechat.ts.
 */
export interface ChannelRow {
  id: string;
  organizationId: string;
  cityId: string | null;
  provider: string;
  name: string;
  displayHandle: string | null;
  phoneNumberId: string | null;
  wabaId: string | null;
  igUserId: string | null;
  igUsername: string | null;
  isActive: boolean;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Dados para inserir um novo canal.
 * Os segredos cifrados vão para channel_secrets na mesma transação.
 */
export interface InsertChannelData {
  organizationId: string;
  cityId: string | null;
  provider: 'meta_whatsapp' | 'meta_instagram' | 'waha';
  name: string;
  displayHandle: string;
  phoneNumberEnc: Buffer | null;
  phoneNumberId: string | null;
  wabaId: string | null;
  igUserId: string | null;
  igUsername: string | null;
  wahaSessionId: string | null;
}

export interface InsertChannelSecretsData {
  channelId: string;
  accessTokenEnc: Buffer;
  appSecretEnc: Buffer | null;
  apiKeyEnc: Buffer | null;
}

// ---------------------------------------------------------------------------
// Helper: city scope condition
// ---------------------------------------------------------------------------

type ScopeCondition = ReturnType<typeof inArray> | ReturnType<typeof sql> | null;

function buildCityScopeCondition(cityScopeIds: string[] | null): ScopeCondition {
  if (cityScopeIds === null) {
    // Acesso global — sem filtro adicional
    return null;
  }

  if (cityScopeIds.length === 0) {
    // Sem scope de cidade: condição sempre falsa — nenhuma row retornada.
    // `as` justificado: sql<boolean> é compatível com SQL condition no Drizzle.
    return sql`1 = 0` as ReturnType<typeof sql>;
  }

  return inArray(channels.cityId, cityScopeIds);
}

// ---------------------------------------------------------------------------
// Colunas públicas (sem PII cifrada, sem segredos)
// ---------------------------------------------------------------------------

const PUBLIC_CHANNEL_COLUMNS = {
  id: channels.id,
  organizationId: channels.organizationId,
  cityId: channels.cityId,
  provider: channels.provider,
  name: channels.name,
  displayHandle: channels.displayHandle,
  phoneNumberId: channels.phoneNumberId,
  wabaId: channels.wabaId,
  igUserId: channels.igUserId,
  igUsername: channels.igUsername,
  isActive: channels.isActive,
  isDefault: channels.isDefault,
  createdAt: channels.createdAt,
  updatedAt: channels.updatedAt,
} as const;

// ---------------------------------------------------------------------------
// findChannels
// ---------------------------------------------------------------------------

export interface FindChannelsParams {
  organizationId: string;
  cityScopeIds: string[] | null;
  status?: 'active' | 'inactive' | undefined;
}

export async function findChannels(
  db: Database,
  params: FindChannelsParams,
): Promise<ChannelRow[]> {
  const { organizationId, cityScopeIds, status } = params;

  const conditions = [
    eq(channels.organizationId, organizationId),
    // Soft-delete: excluir canais deletados
    isNull(channels.deletedAt),
  ];

  const scopeCondition = buildCityScopeCondition(cityScopeIds);
  if (scopeCondition !== null) {
    conditions.push(scopeCondition);
  }

  if (status === 'active') {
    conditions.push(eq(channels.isActive, true));
  } else if (status === 'inactive') {
    conditions.push(eq(channels.isActive, false));
  }

  return db
    .select(PUBLIC_CHANNEL_COLUMNS)
    .from(channels)
    .where(and(...conditions));
}

// ---------------------------------------------------------------------------
// findChannelById
// ---------------------------------------------------------------------------

export async function findChannelById(
  db: Database,
  organizationId: string,
  channelId: string,
): Promise<ChannelRow | undefined> {
  const rows = await db
    .select(PUBLIC_CHANNEL_COLUMNS)
    .from(channels)
    .where(
      and(
        eq(channels.id, channelId),
        eq(channels.organizationId, organizationId),
        isNull(channels.deletedAt),
      ),
    )
    .limit(1);

  return rows[0];
}

// ---------------------------------------------------------------------------
// findChannelByProviderKey — para idempotência
// ---------------------------------------------------------------------------

/**
 * Busca canal por chave de negócio única por provider:
 *   meta_whatsapp  → (orgId, provider, phoneNumberId)
 *   meta_instagram → (orgId, provider, igUserId)
 *   waha           → (orgId, provider, wahaSessionId)
 *
 * O índice único do DB (channels_org_provider_phone_number_id_key) cobre o
 * caso de meta_whatsapp. Para instagram/waha verificamos aqui em app layer
 * antes do INSERT para dar erro 409 antes de violar constraint.
 */
export async function findChannelByProviderKey(
  db: Database,
  params: {
    organizationId: string;
    provider: string;
    phoneNumberId?: string | null;
    igUserId?: string | null;
    wahaSessionId?: string | null;
  },
): Promise<ChannelRow | undefined> {
  const { organizationId, provider, phoneNumberId, igUserId, wahaSessionId } = params;

  const conditions = [
    eq(channels.organizationId, organizationId),
    eq(channels.provider, provider),
    isNull(channels.deletedAt),
  ];

  if (phoneNumberId !== null && phoneNumberId !== undefined) {
    conditions.push(eq(channels.phoneNumberId, phoneNumberId));
  } else if (igUserId !== null && igUserId !== undefined) {
    conditions.push(eq(channels.igUserId, igUserId));
  } else if (wahaSessionId !== null && wahaSessionId !== undefined) {
    conditions.push(eq(channels.wahaSessionId, wahaSessionId));
  }

  const rows = await db
    .select(PUBLIC_CHANNEL_COLUMNS)
    .from(channels)
    .where(and(...conditions))
    .limit(1);

  return rows[0];
}

// ---------------------------------------------------------------------------
// insertChannelWithSecrets — transação caller-controlada
// ---------------------------------------------------------------------------

/**
 * Insere channel + channel_secrets dentro de uma transação fornecida pelo caller.
 * O caller é responsável por abrir e commitar/rollbar a transação.
 * Retorna a ChannelRow inserida (sem segredos).
 */
export async function insertChannelWithSecrets(
  tx: Database,
  channelData: InsertChannelData,
  secretsData: Omit<InsertChannelSecretsData, 'channelId'>,
): Promise<ChannelRow> {
  // Construir o objeto de insert usando NewChannel (tipo Drizzle inferido).
  // exactOptionalPropertyTypes: campos opcionais nullable do DB aceitam null diretamente.
  // Drizzle mapeia null → SQL NULL; undefined omitido → usa DEFAULT do schema.
  // Usamos `satisfies` para verificar o tipo sem `as unknown`.
  const channelInsert = {
    organizationId: channelData.organizationId,
    cityId: channelData.cityId ?? null,
    provider: channelData.provider,
    name: channelData.name,
    displayHandle: channelData.displayHandle,
    phoneNumberEnc: channelData.phoneNumberEnc ?? null,
    phoneNumberId: channelData.phoneNumberId ?? null,
    wabaId: channelData.wabaId ?? null,
    igUserId: channelData.igUserId ?? null,
    igUsername: channelData.igUsername ?? null,
    wahaSessionId: channelData.wahaSessionId ?? null,
    isActive: true,
    isDefault: false,
  } satisfies NewChannel;

  const insertedRows = await tx
    .insert(channels)
    .values(channelInsert)
    .returning(PUBLIC_CHANNEL_COLUMNS);

  const inserted = insertedRows[0];
  if (inserted === undefined) {
    // Nunca deve ocorrer — INSERT sempre retorna 1 row.
    throw new Error('[channels] INSERT não retornou row — falha inesperada');
  }

  // Inserir segredos cifrados na tabela segregada.
  // appSecretEnc e apiKeyEnc são null para providers que não os usam.
  const secretsInsert = {
    channelId: inserted.id,
    accessTokenEnc: secretsData.accessTokenEnc,
    appSecretEnc: secretsData.appSecretEnc ?? null,
    apiKeyEnc: secretsData.apiKeyEnc ?? null,
  } satisfies NewChannelSecret;

  await tx.insert(channelSecrets).values(secretsInsert);

  return inserted;
}

// ---------------------------------------------------------------------------
// softDeleteChannel
// ---------------------------------------------------------------------------

/**
 * Marca o canal como deletado (soft-delete: deleted_at = now()).
 * Retorna true se o canal foi encontrado e deletado, false se não existia.
 */
export async function softDeleteChannel(
  db: Database,
  organizationId: string,
  channelId: string,
): Promise<boolean> {
  const result = await db
    .update(channels)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(channels.id, channelId),
        eq(channels.organizationId, organizationId),
        isNull(channels.deletedAt),
      ),
    )
    .returning({ id: channels.id });

  return result.length > 0;
}
