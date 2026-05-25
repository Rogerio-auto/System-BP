// =============================================================================
// internal/credit-analyses/index.ts — Re-exportações do módulo credit-analyses.
//
// Centraliza as importações necessárias para quem registrar o plugin
// (internal/index.ts) e para testes.
//
// Por que não usar autoload para este módulo?
//   O autoload de internal/index.ts usa dirNameRoutePrefix: true, o que daria
//   o prefixo /internal/credit-analyses para routes.ts deste diretório.
//   O endpoint deve estar em /internal/customers/:id/credit-analyses, portanto
//   o plugin é registrado manualmente em internal/index.ts com o prefixo correto.
//   O autoload ignora este módulo via ignorePattern: /credit-analyses/.
// =============================================================================
export { default as internalCreditAnalysesRoutes } from './routes.js';
export type { CreditAnalysisHistoryResponse, AnalysisItem } from './schemas.js';
