// =============================================================================
// channels/schemas.ts — Schemas Zod para o módulo de canais (F16-S11).
//
// Contratos de entrada/saída das rotas:
//   POST /api/channels/connect — conectar canal por provider discriminado
//   GET  /api/channels         — listar canais da organização
//   DELETE /api/channels/:id   — desativar canal (soft-delete)
//
// LGPD (doc 17 §8.1):
//   - phoneNumber no body de entrada é PII → cifrado antes de persistir.
//   - ChannelResponseSchema nunca expõe phoneNumber nem access_token/app_secret.
//   - Apenas campos técnicos (phoneNumberId, wabaId) são expostos no DTO.
//
// Discriminated union por provider:
//   meta_whatsapp  → campos obrigatórios: phoneNumber, accessToken, appSecret,
//                    phoneNumberId, wabaId
//   meta_instagram → campos obrigatórios: accessToken, appSecret, igUserId
//   waha           → campos obrigatórios: apiKey, wahaSessionId
// =============================================================================
import 'zod-openapi/extend';

import { z } from 'zod';

// ---------------------------------------------------------------------------
// ChannelResponseSchema — DTO público (sem segredos)
// ---------------------------------------------------------------------------

/**
 * DTO público de um canal.
 *
 * LGPD L3: phoneNumber removido. Somente phoneNumberId (ID técnico da Meta)
 * está disponível — não é PII. access_token / app_secret nunca retornados.
 */
export const ChannelResponseSchema = z.object({
  id: z.string().uuid().describe('UUID do canal'),
  organization_id: z.string().uuid().describe('UUID da organização dona do canal'),
  city_id: z.string().uuid().nullable().describe('UUID da cidade escopo do canal'),
  provider: z
    .enum(['meta_whatsapp', 'meta_instagram', 'waha'])
    .describe('Provider do canal de mensagem'),
  name: z.string().describe('Nome amigável do canal'),
  display_handle: z.string().nullable().describe('Handle exibível (ex: @usuario, nome da página)'),
  // WhatsApp
  phone_number_id: z.string().nullable().describe('ID técnico do número no Meta (não é PII)'),
  waba_id: z.string().nullable().describe('WABA ID do WhatsApp Business Account'),
  // Instagram
  ig_user_id: z.string().nullable().describe('User ID técnico do Instagram Business'),
  ig_username: z.string().nullable().describe('Username do Instagram'),
  // Comum
  is_active: z.boolean().describe('true se o canal está ativo'),
  is_default: z.boolean().describe('true se é o canal padrão da organização'),
  created_at: z.string().datetime().describe('Data/hora de criação (ISO 8601)'),
  updated_at: z.string().datetime().describe('Data/hora de atualização (ISO 8601)'),
});

export type ChannelResponse = z.infer<typeof ChannelResponseSchema>;

// ---------------------------------------------------------------------------
// ChannelListResponseSchema
// ---------------------------------------------------------------------------

export const ChannelListResponseSchema = z.object({
  data: z.array(ChannelResponseSchema),
});

export type ChannelListResponse = z.infer<typeof ChannelListResponseSchema>;

// ---------------------------------------------------------------------------
// ConnectMetaWhatsAppSchema
// ---------------------------------------------------------------------------

const ConnectMetaWhatsAppSchema = z.object({
  provider: z.literal('meta_whatsapp'),
  /** Nome amigável do canal. */
  name: z.string().min(1).max(100).describe('Nome amigável para este canal'),
  /**
   * Número de telefone do canal — PII (doc 17 §8.1).
   * Cifrado antes de persistir em phone_number_enc (bytea).
   * NUNCA retornado no DTO de resposta.
   */
  phoneNumber: z
    .string()
    .min(7)
    .max(20)
    .regex(/^\+?[0-9\s\-()]+$/, 'Formato de telefone inválido')
    .describe('Número de telefone do canal (cifrado — nunca retornado)'),
  /**
   * Access token do Meta (System User Token).
   * Cifrado em channel_secrets.access_token_enc.
   * LGPD: credencial sensível — nunca logar, nunca retornar.
   */
  accessToken: z.string().min(1).describe('Token de acesso do Meta System User (cifrado)'),
  /**
   * App secret do Meta (para validação HMAC do webhook).
   * Cifrado em channel_secrets.app_secret_enc.
   * LGPD: credencial sensível.
   */
  appSecret: z.string().min(1).describe('App Secret do Meta App (cifrado, usado no webhook HMAC)'),
  /** ID técnico do número no Meta — não é PII. */
  phoneNumberId: z.string().min(1).describe('Phone Number ID da Meta (identificador técnico)'),
  /** WABA ID do WhatsApp Business Account. */
  wabaId: z.string().min(1).describe('WABA ID do WhatsApp Business Account'),
  /** UUID da cidade escopo (opcional). */
  cityId: z.string().uuid().nullable().optional().describe('UUID da cidade escopo do canal'),
});

// ---------------------------------------------------------------------------
// ConnectMetaInstagramSchema
// ---------------------------------------------------------------------------

const ConnectMetaInstagramSchema = z.object({
  provider: z.literal('meta_instagram'),
  name: z.string().min(1).max(100).describe('Nome amigável para este canal'),
  /** Access token de page de longa duração. Cifrado. */
  accessToken: z.string().min(1).describe('Token de acesso de página do Instagram (cifrado)'),
  /** App secret. Cifrado. */
  appSecret: z.string().min(1).describe('App Secret do Meta App (cifrado)'),
  /** User ID técnico do Instagram Business — não é PII. */
  igUserId: z.string().min(1).describe('Instagram Business User ID (identificador técnico)'),
  /** Username opcional do Instagram. */
  igUsername: z.string().nullable().optional().describe('Username do Instagram'),
  cityId: z.string().uuid().nullable().optional().describe('UUID da cidade escopo do canal'),
});

// ---------------------------------------------------------------------------
// ConnectWahaSchema
// ---------------------------------------------------------------------------

const ConnectWahaSchema = z.object({
  provider: z.literal('waha'),
  name: z.string().min(1).max(100).describe('Nome amigável para este canal'),
  /** API key do servidor WAHA. Cifrado. */
  apiKey: z.string().min(1).describe('API key do servidor WAHA (cifrado)'),
  /** ID da sessão WAHA — identificador técnico. */
  wahaSessionId: z.string().min(1).describe('ID da sessão WAHA'),
  cityId: z.string().uuid().nullable().optional().describe('UUID da cidade escopo do canal'),
});

// ---------------------------------------------------------------------------
// ConnectChannelSchema — union discriminada por provider
// ---------------------------------------------------------------------------

/**
 * Schema discriminado para POST /api/channels/connect.
 * Cada provider tem campos obrigatórios diferentes.
 * Zod valida e discrimina antes de o handler ser invocado.
 */
export const ConnectChannelSchema = z
  .discriminatedUnion('provider', [
    ConnectMetaWhatsAppSchema,
    ConnectMetaInstagramSchema,
    ConnectWahaSchema,
  ])
  .openapi({
    example: {
      provider: 'meta_whatsapp',
      name: 'WhatsApp Banco do Povo',
      phoneNumber: '+5569999999999',
      accessToken: 'EAAxxxxxxxx',
      appSecret: 'abc123secret',
      phoneNumberId: '100123456789',
      wabaId: '200987654321',
      cityId: null,
    },
  });

export type ConnectChannelBody = z.infer<typeof ConnectChannelSchema>;

// ---------------------------------------------------------------------------
// ChannelListQuerySchema
// ---------------------------------------------------------------------------

export const ChannelListQuerySchema = z.object({
  status: z
    .enum(['active', 'inactive'])
    .optional()
    .describe('Filtrar por status do canal (active = is_active=true, inactive = false)'),
});

export type ChannelListQuery = z.infer<typeof ChannelListQuerySchema>;

// ---------------------------------------------------------------------------
// ChannelIdParamSchema
// ---------------------------------------------------------------------------

export const ChannelIdParamSchema = z.object({
  id: z.string().uuid().describe('UUID do canal'),
});

export type ChannelIdParam = z.infer<typeof ChannelIdParamSchema>;

// ---------------------------------------------------------------------------
// SetDefaultChannelParamSchema — PATCH /api/channels/:id/default
// ---------------------------------------------------------------------------

export const SetDefaultChannelParamSchema = z.object({
  id: z.string().uuid().describe('UUID do canal a ser definido como padrão'),
});

export type SetDefaultChannelParam = z.infer<typeof SetDefaultChannelParamSchema>;

// ---------------------------------------------------------------------------
// Meta Embedded Signup — POST /api/channels/meta/whatsapp/discover
// ---------------------------------------------------------------------------

/**
 * Body de POST /api/channels/meta/whatsapp/discover.
 * `code` é o one-time code retornado pelo SDK do Facebook após o FB.login OAuth flow.
 * LGPD: code é efêmero e sem PII — descartado após troca pelo access_token.
 */
export const MetaDiscoverBodySchema = z.object({
  code: z.string().min(1).describe('Code one-time retornado pelo FB.login() do SDK da Meta'),
});

export type MetaDiscoverBody = z.infer<typeof MetaDiscoverBodySchema>;

/**
 * Número de telefone descoberto via Graph API após exchange do code.
 * Expõe apenas campos técnicos — sem PII além do número de telefone formatado.
 */
export const MetaDiscoveredPhoneSchema = z.object({
  phoneNumberId: z.string().min(1).describe('Phone Number ID técnico da Meta'),
  displayPhoneNumber: z.string().min(1).describe('Número de telefone no formato de exibição'),
  verifiedName: z.string().min(1).describe('Nome verificado associado ao número'),
  wabaId: z.string().min(1).describe('WABA ID do WhatsApp Business Account'),
  wabaName: z.string().min(1).describe('Nome do WhatsApp Business Account'),
});

export type MetaDiscoveredPhone = z.infer<typeof MetaDiscoveredPhoneSchema>;

/**
 * Resposta de POST /api/channels/meta/whatsapp/discover.
 *
 * `pendingToken` é um JWT de curta duração (10min) assinado pelo backend contendo
 * o access_token e a lista de telefones. O frontend passa este token opaco
 * de volta em /embedded-signup sem nunca ver o access_token real.
 *
 * LGPD: access_token NÃO aparece na resposta — encapsulado no pendingToken.
 */
export const MetaDiscoverResponseSchema = z.object({
  pendingToken: z.string().describe('JWT assinado com dados da sessão OAuth (expira em 10min)'),
  phones: z.array(MetaDiscoveredPhoneSchema),
});

export type MetaDiscoverResponse = z.infer<typeof MetaDiscoverResponseSchema>;

// ---------------------------------------------------------------------------
// Meta Embedded Signup — POST /api/channels/meta/whatsapp/embedded-signup
// ---------------------------------------------------------------------------

/**
 * Body de POST /api/channels/meta/whatsapp/embedded-signup.
 * `pendingToken` + `phoneNumberId` → cria o canal com o acesso_token encapsulado.
 */
export const MetaEmbeddedSignupBodySchema = z.object({
  pendingToken: z.string().min(1).describe('Token retornado por /discover (válido 10min)'),
  phoneNumberId: z.string().min(1).describe('Phone Number ID selecionado pelo usuário'),
  name: z.string().min(1).max(100).describe('Nome amigável do canal'),
  cityId: z.string().uuid().nullable().optional().describe('UUID da cidade escopo do canal'),
});

export type MetaEmbeddedSignupBody = z.infer<typeof MetaEmbeddedSignupBodySchema>;
