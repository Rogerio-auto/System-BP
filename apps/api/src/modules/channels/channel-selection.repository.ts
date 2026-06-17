// =============================================================================
// channels/channel-selection.repository.ts — Queries de seleção de canal (F20-S02).
//
// Responsabilidade única: localizar o canal ativo correto para envio de mensagens.
//
// Lógica de prioridade (doc planejamento-2026-06-multi-canal.md):
//   1. Explicit: WHERE id = channelId AND organization_id = orgId
//   2. Fallback: WHERE organization_id = orgId ORDER BY is_default DESC, created_at ASC LIMIT 1
//
// city scope NÃO é aplicado aqui — envio de worker não está restrito a cidade.
// O channel_id foi escolhido pelo usuário ou pela org, não por scope RBAC.
//
// LGPD (doc 17 §8.1):
//   - `findActiveChannelForOrg` NÃO seleciona colunas *_enc (PII).
//   - `findChannelSecrets` retorna bytea cifrado — responsabilidade do caller
//     chamar `decryptPii` e nunca logar o resultado.
// =============================================================================
import { and, asc, desc, eq, isNull } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { channelSecrets, channels } from '../../db/schema/index.js';

// ---------------------------------------------------------------------------
// Tipos de retorno
// ---------------------------------------------------------------------------

/**
 * Dados públicos do canal — sem segredos, sem PII cifrada.
 * Suficiente para resolver o contexto de envio (excepto access_token).
 */
export interface ActiveChannelRow {
  id: string;
  organizationId: string;
  name: string;
  phoneNumberId: string | null;
  wabaId: string | null;
  metaAppId: string | null;
  isDefault: boolean;
}

/**
 * Row completa de channel_secrets — campos bytea cifrados.
 * Nunca logar. Decifrar via decryptPii antes de usar.
 */
export interface ChannelSecretsRow {
  channelId: string;
  accessTokenEnc: Buffer;
  appSecretEnc: Buffer | null;
  apiKeyEnc: Buffer | null;
}

// ---------------------------------------------------------------------------
// Colunas selecionadas para canal (sem PII cifrada, sem segredos)
// ---------------------------------------------------------------------------

const SELECTION_COLUMNS = {
  id: channels.id,
  organizationId: channels.organizationId,
  name: channels.name,
  phoneNumberId: channels.phoneNumberId,
  wabaId: channels.wabaId,
  metaAppId: channels.metaAppId,
  isDefault: channels.isDefault,
} as const;

// ---------------------------------------------------------------------------
// findActiveChannelForOrg
// ---------------------------------------------------------------------------

/**
 * Localiza o canal ativo correto para uma org.
 *
 * Prioridade:
 *   1. Se `channelId` fornecido → busca exato com scope de org (segurança cross-tenant).
 *   2. Senão → ORDER BY is_default DESC, created_at ASC LIMIT 1 (default primeiro).
 *
 * Retorna `null` se não houver canal ativo (sem default, sem explícito, ou org sem canais).
 *
 * @param db              Instância Drizzle (ou transação).
 * @param organizationId  ID da organização — sempre aplicado para evitar cross-tenant.
 * @param channelId       ID explícito do canal (opcional).
 */
export async function findActiveChannelForOrg(
  db: Database,
  organizationId: string,
  channelId?: string | null,
): Promise<ActiveChannelRow | null> {
  if (channelId !== null && channelId !== undefined && channelId.length > 0) {
    // Busca explícita — garante que o canal pertence à org (RBAC cross-tenant).
    const rows = await db
      .select(SELECTION_COLUMNS)
      .from(channels)
      .where(
        and(
          eq(channels.id, channelId),
          eq(channels.organizationId, organizationId),
          eq(channels.isActive, true),
          isNull(channels.deletedAt),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  // Fallback automático: is_default DESC (true > false), depois mais antigo primeiro.
  const rows = await db
    .select(SELECTION_COLUMNS)
    .from(channels)
    .where(
      and(
        eq(channels.organizationId, organizationId),
        eq(channels.isActive, true),
        isNull(channels.deletedAt),
      ),
    )
    .orderBy(desc(channels.isDefault), asc(channels.createdAt))
    .limit(1);

  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// findChannelSecrets
// ---------------------------------------------------------------------------

/**
 * Busca os segredos cifrados do canal.
 *
 * Retorna `null` se não existir row em channel_secrets para o channelId dado
 * (canal sem segredos cadastrados — estado inválido, mas tratado no service).
 *
 * LGPD: o caller é responsável por:
 *   - Decifrar `accessTokenEnc` via `decryptPii` (nunca passar o Buffer cifrado adiante).
 *   - Nunca logar nenhum campo deste retorno.
 *
 * @param db         Instância Drizzle (ou transação).
 * @param channelId  ID do canal cujos secrets queremos.
 */
export async function findChannelSecrets(
  db: Database,
  channelId: string,
): Promise<ChannelSecretsRow | null> {
  const rows = await db
    .select({
      channelId: channelSecrets.channelId,
      accessTokenEnc: channelSecrets.accessTokenEnc,
      appSecretEnc: channelSecrets.appSecretEnc,
      apiKeyEnc: channelSecrets.apiKeyEnc,
    })
    .from(channelSecrets)
    .where(eq(channelSecrets.channelId, channelId))
    .limit(1);

  return rows[0] ?? null;
}
