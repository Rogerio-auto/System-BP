// =============================================================================
// channels/service.ts — Regras de negócio do módulo de canais (F16-S11).
//
// Responsabilidades:
//   - connectChannel: verifica credenciais via Meta Graph API (meta_whatsapp/instagram),
//     cifra segredos, persiste em transação canal + channel_secrets, audit log.
//   - listChannels: lista canais com filtros, city scope aplicado no repository.
//   - deleteChannel: soft-delete com audit log.
//
// Idempotência:
//   - Mesmo (orgId, provider, phoneNumberId/igUserId/wahaSessionId) → 409 CONFLICT.
//
// Verificação de credencial (meta_whatsapp):
//   - GET /{phone_number_id} via GraphClient antes de persistir.
//   - Falha → 422 VALIDATION_ERROR com código INVALID_CREDENTIAL.
//   - Não verificamos waha (sem API do provider para validar key sem nr de conversa).
//
// LGPD (doc 17 §8.1, §8.5):
//   - phoneNumber (PII) → cifrado via encryptPii antes de INSERT.
//   - accessToken / appSecret / apiKey → cifrados via encryptPii.
//   - Segredos NUNCA logados, NUNCA no response.
//   - Audit log: before/after com apenas IDs opacos (sem PII, sem tokens).
//
// Erros:
//   - Duplicata canal   → ChannelDuplicateError (409 CONFLICT)
//   - Credencial inválida → ChannelInvalidCredentialError (422 VALIDATION_ERROR)
//   - Canal não encontrado → NotFoundError (404)
// =============================================================================
import type { Database } from '../../db/client.js';
import { ProviderError, isProviderError } from '../../integrations/channels/shared/errors.js';
import { createGraphClient } from '../../integrations/channels/shared/graphClient.js';
import { auditLog } from '../../lib/audit.js';
import { encryptPii } from '../../lib/crypto/pii.js';
import { AppError, NotFoundError } from '../../shared/errors.js';

import type { ChannelRow, InsertChannelData } from './repository.js';
import {
  findChannelByProviderKey,
  findChannels,
  insertChannelWithSecrets,
  softDeleteChannel,
} from './repository.js';
import type {
  ChannelListQuery,
  ChannelListResponse,
  ChannelResponse,
  ConnectChannelBody,
} from './schemas.js';

// ---------------------------------------------------------------------------
// Erros customizados
// ---------------------------------------------------------------------------

/**
 * Canal já existente para (orgId, provider, phoneNumberId|igUserId|wahaSessionId).
 * HTTP 409 — idempotência: o caller pode checar por conflito sem criar duplicata.
 */
export class ChannelDuplicateError extends AppError {
  constructor(provider: string) {
    super(409, 'CONFLICT', `Canal ${provider} com este identificador já está cadastrado`, {
      code: 'CHANNEL_DUPLICATE',
    });
    this.name = 'ChannelDuplicateError';
  }
}

/**
 * Credencial fornecida é inválida (rejeitada pelo provider).
 * HTTP 422 — erro semântico: os dados fornecidos não são válidos para este provider.
 *
 * LGPD: não incluir detalhes da credencial na mensagem — apenas o código de erro.
 */
export class ChannelInvalidCredentialError extends AppError {
  constructor(detail?: string) {
    super(422, 'VALIDATION_ERROR', 'Credencial inválida ou sem permissão no provider', {
      code: 'INVALID_CREDENTIAL',
      ...(detail !== undefined ? { detail } : {}),
    });
    this.name = 'ChannelInvalidCredentialError';
  }
}

// ---------------------------------------------------------------------------
// Contexto do ator (passado pelos controllers)
// ---------------------------------------------------------------------------

export interface ActorContext {
  userId: string;
  organizationId: string;
  role: string;
  cityScopeIds: string[] | null;
  ip?: string | null;
  userAgent?: string | null;
}

// ---------------------------------------------------------------------------
// Mapeador: ChannelRow → ChannelResponse
// ---------------------------------------------------------------------------

function toChannelResponse(row: ChannelRow): ChannelResponse {
  return {
    id: row.id,
    organization_id: row.organizationId,
    city_id: row.cityId,
    provider: row.provider as ChannelResponse['provider'],
    name: row.name,
    display_handle: row.displayHandle,
    phone_number_id: row.phoneNumberId,
    waba_id: row.wabaId,
    ig_user_id: row.igUserId,
    ig_username: row.igUsername,
    is_active: row.isActive,
    is_default: row.isDefault,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Verificação de credencial Meta via Graph API
// ---------------------------------------------------------------------------

/**
 * Verifica que o accessToken tem permissão no phoneNumberId dado.
 * Chama GET /{phone_number_id} na Graph API.
 * Lança ChannelInvalidCredentialError se o token for inválido.
 *
 * LGPD: accessToken não é logado — apenas o status de resposta.
 * Injetável para testes: graphClientFactory permite mock.
 */
async function verifyMetaWhatsAppCredential(
  accessToken: string,
  phoneNumberId: string,
  graphClientFactory = createGraphClient,
): Promise<void> {
  const client = graphClientFactory({
    accessToken,
    // Timeout curto para verificação de credencial (não é mensagem crítica)
    defaultTimeoutMs: 10_000,
    // Sem retry na verificação — credencial inválida não vai melhorar com retry
    maxAttempts: 1,
  });

  try {
    // GET /{phone_number_id} retorna dados do número se o token for válido.
    // Se o token for inválido, a Meta retorna 400/401.
    // Não usamos o resultado — apenas confirmamos que não lança erro.
    await client.get<{ id: string }>(`/${phoneNumberId}`);
  } catch (e) {
    if (isProviderError(e)) {
      // 400/401/403 → credencial inválida
      if (e.upstreamStatus >= 400 && e.upstreamStatus < 500) {
        throw new ChannelInvalidCredentialError(
          `Meta API retornou ${e.upstreamStatus} para phone_number_id fornecido`,
        );
      }
    }
    // Erro de rede / timeout → re-lançar como ProviderError (502)
    if (e instanceof ProviderError) {
      throw e;
    }
    // Erro inesperado
    throw new AppError(
      502,
      'EXTERNAL_SERVICE_ERROR',
      'Falha ao verificar credenciais com a Meta API',
    );
  }
}

// ---------------------------------------------------------------------------
// connectChannelService
// ---------------------------------------------------------------------------

/**
 * Conecta um novo canal (entrada manual de credenciais).
 *
 * Fluxo:
 * 1. Verificar duplicata por chave de negócio (409 se existir).
 * 2. Para meta_whatsapp: verificar credencial via Graph API (422 se inválida).
 * 3. Cifrar segredos (encryptPii).
 * 4. Transação: insertChannelWithSecrets + auditLog.
 * 5. Retornar ChannelResponse (sem segredos).
 *
 * @param db            Instância do banco (fora de transação — a função cria)
 * @param actor         Contexto do ator autenticado
 * @param body          Payload discriminado por provider
 * @param graphFactory  Injetável para testes (mock do GraphClient)
 */
export async function connectChannelService(
  db: Database,
  actor: ActorContext,
  body: ConnectChannelBody,
  graphFactory = createGraphClient,
): Promise<ChannelResponse> {
  // 1. Verificar duplicata
  const existingKey =
    body.provider === 'meta_whatsapp'
      ? { phoneNumberId: body.phoneNumberId }
      : body.provider === 'meta_instagram'
        ? { igUserId: body.igUserId }
        : { wahaSessionId: body.wahaSessionId };

  const existing = await findChannelByProviderKey(db, {
    organizationId: actor.organizationId,
    provider: body.provider,
    ...existingKey,
  });

  if (existing !== undefined) {
    throw new ChannelDuplicateError(body.provider);
  }

  // 2. Verificar credencial e cifrar segredos (por provider — type-narrowing correto)
  // Operações async pesadas FORA da transação para não bloquear a tx.
  // LGPD: tokens cifrados antes de qualquer persistência.
  let accessTokenEnc: Buffer;
  let appSecretEnc: Buffer | null = null;
  let apiKeyEnc: Buffer | null = null;
  let phoneNumberEnc: Buffer | null = null;

  if (body.provider === 'meta_whatsapp') {
    // Verificar credencial via Meta Graph API (422 se inválida)
    await verifyMetaWhatsAppCredential(body.accessToken, body.phoneNumberId, graphFactory);
    // Cifrar segredos
    accessTokenEnc = Buffer.from(await encryptPii(body.accessToken));
    appSecretEnc = Buffer.from(await encryptPii(body.appSecret));
    // phoneNumber é PII — cifrar antes de persistir
    phoneNumberEnc = Buffer.from(await encryptPii(body.phoneNumber));
  } else if (body.provider === 'meta_instagram') {
    accessTokenEnc = Buffer.from(await encryptPii(body.accessToken));
    appSecretEnc = Buffer.from(await encryptPii(body.appSecret));
  } else {
    // waha: apiKey vai em access_token_enc (NOT NULL) e em api_key_enc (campo dedicado).
    // Ambas apontam para o mesmo valor cifrado — api_key_enc é o campo semântico,
    // access_token_enc é necessário por ser NOT NULL no schema.
    const apiKeyBuffer = Buffer.from(await encryptPii(body.apiKey));
    accessTokenEnc = apiKeyBuffer;
    apiKeyEnc = apiKeyBuffer;
  }

  // 4. Montar dados do canal por provider
  const channelData = buildChannelData(body, actor.organizationId, phoneNumberEnc);

  // 5. Transação: insert canal + segredos + audit log
  const created = await db.transaction(async (tx) => {
    const row = await insertChannelWithSecrets(
      // `as` justificado: Drizzle transaction é estruturalmente compatível com Database
      tx as unknown as Database,
      channelData,
      { accessTokenEnc, appSecretEnc, apiKeyEnc },
    );

    await auditLog(
      // `as` justificado: AuditTx é interface estrutural compatível com a tx Drizzle
      tx as unknown as Parameters<typeof auditLog>[0],
      {
        organizationId: actor.organizationId,
        actor: {
          userId: actor.userId,
          role: actor.role,
          ip: actor.ip ?? null,
          userAgent: actor.userAgent ?? null,
        },
        action: 'channel.created',
        resource: { type: 'channel', id: row.id },
        // LGPD §8.5: sem PII, sem tokens no audit log
        after: { channelId: row.id, provider: row.provider, name: row.name },
      },
    );

    return row;
  });

  return toChannelResponse(created);
}

// ---------------------------------------------------------------------------
// buildChannelData — monta InsertChannelData por provider
// ---------------------------------------------------------------------------

function buildChannelData(
  body: ConnectChannelBody,
  organizationId: string,
  phoneNumberEnc: Buffer | null,
): InsertChannelData {
  const cityId =
    'cityId' in body && body.cityId !== null && body.cityId !== undefined ? body.cityId : null;

  switch (body.provider) {
    case 'meta_whatsapp':
      return {
        organizationId,
        cityId,
        provider: 'meta_whatsapp',
        name: body.name,
        // display_handle: número de telefone (possivelmente PII visual — não cifrado aqui,
        // mas o campo é para exibição. O número REAL cifrado está em phoneNumberEnc.
        // display_handle pode ser redacted em logs pelo pino.redact da lista canônica).
        displayHandle: body.name,
        phoneNumberEnc,
        phoneNumberId: body.phoneNumberId,
        wabaId: body.wabaId,
        igUserId: null,
        igUsername: null,
        wahaSessionId: null,
      };

    case 'meta_instagram':
      return {
        organizationId,
        cityId,
        provider: 'meta_instagram',
        name: body.name,
        displayHandle: body.igUsername ?? body.name,
        phoneNumberEnc: null,
        phoneNumberId: null,
        wabaId: null,
        igUserId: body.igUserId,
        igUsername: body.igUsername ?? null,
        wahaSessionId: null,
      };

    case 'waha':
      return {
        organizationId,
        cityId,
        provider: 'waha',
        name: body.name,
        displayHandle: body.wahaSessionId,
        phoneNumberEnc: null,
        phoneNumberId: null,
        wabaId: null,
        igUserId: null,
        igUsername: null,
        wahaSessionId: body.wahaSessionId,
      };
  }
}

// ---------------------------------------------------------------------------
// listChannelsService
// ---------------------------------------------------------------------------

export async function listChannelsService(
  db: Database,
  actor: ActorContext,
  query: ChannelListQuery,
): Promise<ChannelListResponse> {
  const rows = await findChannels(db, {
    organizationId: actor.organizationId,
    cityScopeIds: actor.cityScopeIds,
    status: query.status,
  });

  return { data: rows.map(toChannelResponse) };
}

// ---------------------------------------------------------------------------
// deleteChannelService — soft-delete
// ---------------------------------------------------------------------------

export async function deleteChannelService(
  db: Database,
  actor: ActorContext,
  channelId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const success = await softDeleteChannel(
      tx as unknown as Database,
      actor.organizationId,
      channelId,
    );

    if (!success) {
      throw new NotFoundError('Canal não encontrado ou já removido');
    }

    await auditLog(tx as unknown as Parameters<typeof auditLog>[0], {
      organizationId: actor.organizationId,
      actor: {
        userId: actor.userId,
        role: actor.role,
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
      },
      action: 'channel.deleted',
      resource: { type: 'channel', id: channelId },
      after: { channelId, deletedBy: actor.userId },
    });
  });
}
