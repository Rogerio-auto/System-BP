// =============================================================================
// features/configuracoes/canais/api.ts — Re-exporta hooks e tipos do módulo
// de canais para consumo externo (F20-S07).
//
// Ponto de entrada único para qualquer feature que precise de `useChannels`,
// `useSetDefaultChannel`, ou tipos `ChannelResponse`.
//
// LGPD: nenhum campo PII exposto — campos sensíveis ficam cifrados no backend.
// =============================================================================

export {
  CHANNELS_QUERY_KEY,
  useChannels,
  useConnectChannel,
  useDeleteChannel,
  useSetDefaultChannel,
} from './useChannels';

export type { ChannelResponse, ConnectMetaWhatsAppBody } from './useChannels';
