// =============================================================================
// features/configuracoes/ai-console/index.tsx
//
// Ponto de entrada do sub-módulo "Agente de IA" dentro do Hub de Configurações.
// Exporta as páginas para as sub-rotas registradas em App.tsx.
//
// Sub-rotas:
//   /configuracoes/ia/prompts        → PromptsListPage
//   /configuracoes/ia/prompts/:key   → PromptDetailPage
// =============================================================================

export { PromptsListPage } from './prompts/PromptsListPage';
export { PromptDetailPage } from './prompts/PromptDetailPage';
