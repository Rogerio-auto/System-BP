/**
 * Tipos compartilhados entre apps/web e apps/api.
 * NÃO incluir lógica nem dependências de runtime aqui — apenas tipos puros.
 *
 * Schemas Zod ficam em @elemento/shared-schemas.
 */

export type Uuid = string;

export type IsoDateTime = string;

export type Cents = number;

export type Brl = number;

/** Roles do sistema. Fonte da verdade: docs/10-seguranca-permissoes.md */
export const ROLES = [
  'admin',
  'gestor_geral',
  'gestor_regional',
  'agente',
  'operador',
  'leitura',
] as const;
export type Role = (typeof ROLES)[number];
