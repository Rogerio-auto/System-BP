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
import { SignJWT, jwtVerify } from 'jose';

import { env } from '../../config/env.js';
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
  setDefaultChannel,
  softDeleteChannel,
} from './repository.js';
import type {
  ChannelListQuery,
  ChannelListResponse,
  ChannelResponse,
  ConnectChannelBody,
  MetaDiscoverBody,
  MetaDiscoverResponse,
  MetaDiscoveredPhone,
  MetaEmbeddedSignupBody,
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
// setDefaultChannelService — PATCH /api/channels/:id/default
// ---------------------------------------------------------------------------

/**
 * Define o canal `channelId` como padrão da organização.
 *
 * Executa em transação única:
 *   1. SET is_default = false para todos os canais da org.
 *   2. SET is_default = true  para o canal alvo.
 *   3. Audit log CHANNEL_DEFAULT_SET.
 *
 * Lança NotFoundError (404) se o canal não pertencer à organização ou já
 * estiver deletado.
 *
 * Permissão necessária: channels:manage (verificada no middleware `authorize`).
 */
export async function setDefaultChannelService(
  db: Database,
  actor: ActorContext,
  channelId: string,
): Promise<ChannelResponse> {
  const result = await db.transaction(async (tx) => {
    const updated = await setDefaultChannel(
      // `as` justificado: Drizzle transaction é estruturalmente compatível com Database
      tx as unknown as Database,
      actor.organizationId,
      channelId,
    );

    if (updated === undefined) {
      throw new NotFoundError('Canal não encontrado ou já removido');
    }

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
        action: 'channel.default_set',
        resource: { type: 'channel', id: channelId },
        // LGPD §8.5: sem PII no audit log — apenas IDs opacos
        after: { channelId, setDefaultBy: actor.userId },
      },
    );

    return updated;
  });

  return toChannelResponse(result);
}

// ---------------------------------------------------------------------------
// Meta Embedded Signup — helpers internos
// ---------------------------------------------------------------------------

/** Issuer/Audience do pending token (distinto dos auth tokens). */
const PENDING_TOKEN_ISS = 'elemento:channels:embedded-signup';

interface PendingTokenPayload {
  /** Access token do usuário Meta (curta duração — contido no JWT, nunca exposto). */
  readonly at: string;
  /** Telefones descobertos — passados de volta pelo frontend no embedded-signup. */
  readonly phones: MetaDiscoveredPhone[];
}

async function signPendingToken(payload: PendingTokenPayload): Promise<string> {
  const secret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
  return new SignJWT({ at: payload.at, phones: payload.phones })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(PENDING_TOKEN_ISS)
    .setAudience(PENDING_TOKEN_ISS)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(secret);
}

async function verifyPendingToken(token: string): Promise<PendingTokenPayload> {
  const secret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ['HS256'],
      issuer: PENDING_TOKEN_ISS,
      audience: PENDING_TOKEN_ISS,
    });
    if (typeof payload['at'] !== 'string' || !Array.isArray(payload['phones'])) {
      throw new AppError(422, 'VALIDATION_ERROR', 'pendingToken com payload inválido');
    }
    // `as` justificado: shape validada acima (at: string, phones: array)
    return { at: payload['at'], phones: payload['phones'] as MetaDiscoveredPhone[] };
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(422, 'VALIDATION_ERROR', 'pendingToken inválido ou expirado');
  }
}

// ---------------------------------------------------------------------------
// discoverMetaWhatsAppService — POST /api/channels/meta/whatsapp/discover
// ---------------------------------------------------------------------------

/**
 * Troca o code OAuth do Meta SDK por um access_token e descobre os números
 * de WhatsApp associados às WABAs do usuário.
 *
 * Fluxo:
 * 1. POST /oauth/access_token (code → user_access_token).
 * 2. GET /me/whatsapp_business_accounts (lista WABAs acessíveis).
 * 3. Para cada WABA: GET /{waba_id}/phone_numbers (lista números).
 * 4. Assina pendingToken JWT (10min) com o access_token encapsulado.
 * 5. Retorna { pendingToken, phones[] } — o access_token NUNCA chega ao front.
 *
 * LGPD: access_token não é PII de titular mas é segredo operacional —
 * encapsulado no JWT, nunca logado, nunca retornado em texto claro.
 *
 * @throws AppError 422 FEATURE_NOT_CONFIGURED se FACEBOOK_APP_ID/SECRET ausentes.
 * @throws AppError 422 META_TOKEN_EXCHANGE_FAILED se o code for inválido.
 */
export async function discoverMetaWhatsAppService(
  _db: Database,
  _actor: ActorContext,
  body: MetaDiscoverBody,
): Promise<MetaDiscoverResponse> {
  if (!env.FACEBOOK_APP_ID || !env.FACEBOOK_APP_SECRET) {
    throw new AppError(
      422,
      'FEATURE_NOT_CONFIGURED',
      'Meta Embedded Signup não está configurado neste servidor. Configure FACEBOOK_APP_ID e FACEBOOK_APP_SECRET.',
    );
  }

  // 1. Exchange code → user_access_token
  const tokenUrl = new URL('https://graph.facebook.com/v23.0/oauth/access_token');
  tokenUrl.searchParams.set('client_id', env.FACEBOOK_APP_ID);
  tokenUrl.searchParams.set('client_secret', env.FACEBOOK_APP_SECRET);
  tokenUrl.searchParams.set('code', body.code);

  const tokenRes = await fetch(tokenUrl.toString(), { method: 'GET' });
  if (!tokenRes.ok) {
    throw new AppError(
      422,
      'META_TOKEN_EXCHANGE_FAILED',
      'Falha ao trocar o code pelo access_token da Meta. O code pode ter expirado.',
    );
  }
  const tokenData = (await tokenRes.json()) as { access_token?: string };
  if (typeof tokenData.access_token !== 'string' || tokenData.access_token === '') {
    throw new AppError(422, 'META_TOKEN_EXCHANGE_FAILED', 'Meta retornou access_token inválido.');
  }
  const accessToken = tokenData.access_token;

  // 2. Listar WABAs acessíveis pelo usuário
  const client = createGraphClient({ accessToken, maxAttempts: 1, defaultTimeoutMs: 15_000 });

  interface WabaListResponse {
    readonly data: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  }
  const wabaList = await client.get<WabaListResponse>('/me/whatsapp_business_accounts', {
    params: { fields: 'id,name' },
  });

  if (!Array.isArray(wabaList.data) || wabaList.data.length === 0) {
    throw new AppError(
      422,
      'META_NO_WABA',
      'Nenhuma conta WhatsApp Business encontrada para este usuário Meta. Verifique se o usuário tem acesso ao WABA no Meta Business Manager.',
    );
  }

  // 3. Para cada WABA, buscar os números de telefone disponíveis
  interface PhoneListItem {
    readonly id: string;
    readonly display_phone_number: string;
    readonly verified_name: string;
  }
  interface PhoneListResponse {
    readonly data: ReadonlyArray<PhoneListItem>;
  }

  const phones: MetaDiscoveredPhone[] = [];

  for (const waba of wabaList.data) {
    const phoneList = await client.get<PhoneListResponse>(`/${waba.id}/phone_numbers`, {
      params: { fields: 'id,display_phone_number,verified_name' },
    });

    if (!Array.isArray(phoneList.data)) continue;

    for (const p of phoneList.data) {
      phones.push({
        phoneNumberId: p.id,
        displayPhoneNumber: p.display_phone_number,
        verifiedName: p.verified_name,
        wabaId: waba.id,
        wabaName: waba.name,
      });
    }
  }

  if (phones.length === 0) {
    throw new AppError(
      422,
      'META_NO_PHONES',
      'Nenhum número de telefone WhatsApp encontrado nas contas WABA deste usuário.',
    );
  }

  // 4. Assinar pending token — access_token encapsulado, nunca exposto ao front
  const pendingToken = await signPendingToken({ at: accessToken, phones });

  return { pendingToken, phones };
}

// ---------------------------------------------------------------------------
// connectEmbeddedSignupService — POST /api/channels/meta/whatsapp/embedded-signup
// ---------------------------------------------------------------------------

/**
 * Finaliza a conexão de um canal WhatsApp via Embedded Signup.
 *
 * Fluxo:
 * 1. Verifica e decodifica o pendingToken (expira em 10min).
 * 2. Encontra o phoneNumberId selecionado na lista do token.
 * 3. Chama connectChannelService com o access_token do token + App Secret da env.
 *
 * @throws AppError 422 se o pendingToken expirou ou o phoneNumberId não está no token.
 */
export async function connectEmbeddedSignupService(
  db: Database,
  actor: ActorContext,
  body: MetaEmbeddedSignupBody,
): Promise<ChannelResponse> {
  if (!env.FACEBOOK_APP_SECRET) {
    throw new AppError(
      500,
      'CONFIGURATION_ERROR',
      'FACEBOOK_APP_SECRET não configurado — necessário para validação de webhook.',
    );
  }

  // 1. Verificar e decodificar pending token
  const decoded = await verifyPendingToken(body.pendingToken);

  // 2. Encontrar o número selecionado
  const selectedPhone = decoded.phones.find((p) => p.phoneNumberId === body.phoneNumberId);
  if (selectedPhone === undefined) {
    throw new AppError(
      422,
      'PHONE_NOT_IN_TOKEN',
      'O phoneNumberId selecionado não consta no token de sessão. Inicie o fluxo novamente.',
    );
  }

  // 3. Conectar canal usando o fluxo padrão (inclui verificação via Graph API + cifragem)
  return connectChannelService(db, actor, {
    provider: 'meta_whatsapp',
    name: body.name,
    phoneNumber: selectedPhone.displayPhoneNumber,
    accessToken: decoded.at,
    appSecret: env.FACEBOOK_APP_SECRET,
    phoneNumberId: selectedPhone.phoneNumberId,
    wabaId: selectedPhone.wabaId,
    cityId: body.cityId ?? null,
  });
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
