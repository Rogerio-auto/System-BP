// =============================================================================
// features/help/contextual/index.ts — Barrel público do módulo de ajuda contextual.
//
// Exporta os contratos públicos do módulo para uso pelo resto do app (F12-S06):
//   - <ContextualHelp featureKey>        → ícone ⓘ in-context.
//   - <ContextualHelpDrawer />            → drawer global (montar em AppLayout).
//   - useContextualTutorials              → hook de dados (opcional para F12-S06).
//   - useContextualHelpStore              → store Zustand (opcional para telemetria F12-S07).
//
// Store interna e tipos secundários não são exportados pelo barrel
// para manter o contrato de API mínimo.
// =============================================================================

export { ContextualHelp } from './ContextualHelp';
export type { ContextualHelpProps } from './ContextualHelp';

export { ContextualHelpDrawer } from './ContextualHelpDrawer';

export { useContextualTutorials } from './useContextualTutorials';
export type { TutorialEntry, UseContextualTutorialsResult } from './useContextualTutorials';

export { useContextualHelpStore } from './contextual-help-store';
export type { DrawerTutorial } from './contextual-help-store';
