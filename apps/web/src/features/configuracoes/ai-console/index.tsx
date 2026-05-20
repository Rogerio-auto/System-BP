// =============================================================================
// features/configuracoes/ai-console/index.tsx
//
// Ponto de entrada do sub-módulo "Agente de IA" dentro do Hub de Configurações.
// Exporta as páginas para as sub-rotas registradas em App.tsx.
//
// Sub-rotas:
//   /configuracoes/ia/prompts                        → PromptsListPage
//   /configuracoes/ia/prompts/:key                   → PromptDetailPage
//   /configuracoes/ia/decisoes                       → DecisionsListPage
//   /configuracoes/ia/decisoes/conversa/:id          → ConversationTimelinePage
// =============================================================================

export { PromptsListPage } from './prompts/PromptsListPage';
export { PromptDetailPage } from './prompts/PromptDetailPage';
export { DecisionsListPage } from './decisions/DecisionsListPage';
export { ConversationTimelinePage } from './decisions/ConversationTimelinePage';
