// =============================================================================
// middlewares/index.ts — Re-exporta os middlewares de auth para uso público.
//
// Uso:
//   import { authenticate, authorize } from '../middlewares/index.js';
//
// Nota: applyCityScope é exportado de shared/scope.ts (usado por repositories).
// =============================================================================
export { authenticate } from './authenticate.js';
export { authorize } from './authorize.js';
export type { AuthorizeOptions } from './authorize.js';
