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
