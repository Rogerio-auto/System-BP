// =============================================================================
// auth/schemas.ts — Re-exporta schemas públicos + define schemas internos da API.
//
// Schemas públicos (loginBodySchema, etc.) vivem em packages/shared-schemas
// para serem reutilizados pelo frontend.
//
// Schemas de resposta aqui adicionam headers/cookies não expostos ao frontend.
// =============================================================================
export {
  loginBodySchema,
  loginResponseSchema,
  refreshBodySchema,
  refreshResponseSchema,
  logoutBodySchema,
} from '@elemento/shared-schemas';
