// =============================================================================
// channels/channel-selection.service.ts — Serviço de resolução de canal (F20-S02).
//
// Responsabilidade: dado (organizationId, explicitChannelId?), retornar as
// credenciais decifradas prontas para instanciar o MetaWhatsAppClient.
//
// É o ponto único de verdade para "qual canal usar?" em todos os workers F20.
// F20-S03 (followup), F20-S04 (collection), F20-S05 (billing) importam daqui.
//
// Fluxo:
//   1. findActiveChannelForOrg: resolve canal com prioridade explícita > default > first.
//   2. findChannelSecrets: busca bytea cifrado.
//   3. decryptPii: decifra accessTokenEnc (AES-256-GCM) → plaintext.
//   4. Retorna ResolvedChannel com campos prontos para uso.
//   5. ExternalServiceError se nenhum canal ativo encontrado.
//
// LGPD (doc 17 §8.1, §8.3):
//   - `accessToken` NUNCA logado — apenas `channelId` e `channelName` nos logs.
//   - `decryptPii` chamado internamente; o plaintext não é exposto além do retorno.
//   - Caller é responsável por não logar `ResolvedChannel.accessToken`.
// =============================================================================
import type { Database } from '../../db/client.js';
import { decryptPii } from '../../lib/crypto/pii.js';
import { logger } from '../../lib/logger.js';
import { ExternalServiceError } from '../../shared/errors.js';

import { findActiveChannelForOrg, findChannelSecrets } from './channel-selection.repository.js';

// ---------------------------------------------------------------------------
// Tipo público exportado (consumido por F20-S03/S04/S05)
// ---------------------------------------------------------------------------

/**
 * Credenciais de envio resolvidas e decifradas para um canal Meta WhatsApp.
 *
 * LGPD: `accessToken` é dado sensível. Nunca logar, nunca persistir,
 * nunca incluir em erros/traces. Usar apenas para instanciar MetaWhatsAppClient.
 *
 * `phoneNumberId` é ID técnico da Meta — não é PII; pode ser logado.
 * `channelName` é o nome amigável configurado pelo admin — pode ser logado.
 */
export interface ResolvedChannel {
  /** UUID do canal no banco — safe para logs e auditoria. */
  channelId: string;
  /** Access token Meta decifrado — NUNCA logar. */
  accessToken: string;
  /** ID técnico do número Meta (phone_number_id). */
  phoneNumberId: string;
  /** ID da WABA (para gestão de templates). Null se não configurado. */
  wabaId: string | null;
  /** Meta App ID. Null se não configurado. */
  metaAppId: string | null;
  /** Nome amigável do canal (para logs). */
  channelName: string;
}

// ---------------------------------------------------------------------------
// resolveChannelForSend
// ---------------------------------------------------------------------------

/**
 * Resolve as credenciais de envio para uma organização.
 *
 * Prioridade de resolução:
 *   1. `explicitChannelId` fornecido → usa exatamente esse canal (com scope de org).
 *   2. Canal marcado `is_default = true` na org.
 *   3. Primeiro canal ativo da org (ORDER BY created_at ASC).
 *   4. Nenhum → lança `ExternalServiceError`.
 *
 * Não aplica city scope — envio de worker não é restrito a cidade;
 * o canal foi escolhido pela org/usuário, não por RBAC de cidade.
 *
 * @param db                Instância Drizzle (pode ser tx caller-controlada).
 * @param organizationId    ID da organização (obrigatório — evita cross-tenant).
 * @param explicitChannelId Canal específico, ou null/undefined para fallback.
 * @throws ExternalServiceError se nenhum canal ativo encontrado.
 */
export async function resolveChannelForSend(
  db: Database,
  organizationId: string,
  explicitChannelId?: string | null,
): Promise<ResolvedChannel> {
  // 1. Resolver o canal com prioridade explícita → default → first-active.
  const channel = await findActiveChannelForOrg(db, organizationId, explicitChannelId);

  if (channel === null) {
    const reason =
      explicitChannelId !== null && explicitChannelId !== undefined
        ? `Canal ${explicitChannelId} não encontrado ou inativo para a organização`
        : 'Nenhum canal WhatsApp ativo configurado para esta organização';

    logger.warn(
      { organizationId, explicitChannelId: explicitChannelId ?? null },
      '[channel-selection] Resolução de canal falhou: %s',
      reason,
    );

    throw new ExternalServiceError(reason);
  }

  // 2. Buscar segredos cifrados.
  const secrets = await findChannelSecrets(db, channel.id);

  if (secrets === null) {
    // Estado inválido: canal existe mas não tem secrets — inconsistência de dados.
    logger.error(
      { channelId: channel.id, channelName: channel.name, organizationId },
      '[channel-selection] Canal sem secrets cadastrados — inconsistência de dados',
    );

    throw new ExternalServiceError(
      `Canal ${channel.name} não possui credenciais configuradas. ` +
        'Reconfigure o canal no painel administrativo.',
    );
  }

  // 3. Decifrar access_token_enc (AES-256-GCM).
  // `as Buffer` justificado: Drizzle mapeia bytea → Buffer; o tipo TS é Uint8Array
  // mas o driver node-postgres sempre devolve Buffer (subclasse de Uint8Array).
  const accessToken = await decryptPii(secrets.accessTokenEnc as Buffer);

  // 4. Garantir que phoneNumberId existe (invariante do schema meta_whatsapp).
  if (channel.phoneNumberId === null) {
    logger.error(
      { channelId: channel.id, channelName: channel.name, organizationId },
      '[channel-selection] Canal sem phone_number_id — provider não suportado para envio',
    );

    throw new ExternalServiceError(
      `Canal ${channel.name} não é um canal Meta WhatsApp válido para envio de mensagens.`,
    );
  }

  // Log estruturado: channelId + channelName apenas — NUNCA accessToken (LGPD §8.3).
  logger.debug(
    { channelId: channel.id, channelName: channel.name, organizationId },
    '[channel-selection] Canal resolvido para envio',
  );

  return {
    channelId: channel.id,
    accessToken,
    phoneNumberId: channel.phoneNumberId,
    wabaId: channel.wabaId,
    metaAppId: channel.metaAppId,
    channelName: channel.name,
  };
}
