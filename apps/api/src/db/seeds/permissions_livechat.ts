// =============================================================================
// db/seeds/permissions_livechat.ts — Seed de permissões do módulo live chat.
//
// Este arquivo documenta as permissões seedadas pela migration
// 0062_seed_livechat_channel_permissions.sql.
//
// Permissões:
//   channel.connect → conectar, listar e remover canais de mensagem
//
// Roles:
//   admin        → channel.connect
//   gestor_geral → channel.connect
//
// Nota: agentes não recebem channel.connect — a conexão de canais é
// responsabilidade do gestor/admin (operação de configuração de sistema).
// =============================================================================

/**
 * Catálogo de permissões do módulo live chat F16.
 * Espelha o que está na migration 0062_seed_livechat_channel_permissions.sql.
 */
export const LIVECHAT_PERMISSIONS = {
  'channel.connect': 'Conectar, listar e desativar canais de mensagem (WhatsApp, Instagram, WAHA)',
} as const satisfies Record<string, string>;

export type LivechatPermissionKey = keyof typeof LIVECHAT_PERMISSIONS;
