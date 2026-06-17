// =============================================================================
// modules/channels/index.ts — Barrel de exports públicos do módulo de canais.
//
// Exporta apenas o que outros módulos precisam consumir:
//   - resolveChannelForSend: serviço de resolução de canal (F20-S02)
//   - ResolvedChannel: tipo de retorno (F20-S03/S04/S05 dependem dele)
//
// Internals (routes, controller, service CRUD, repository CRUD, schemas)
// NÃO são reexportados — importar diretamente quando necessário dentro do módulo.
// =============================================================================

export type { ResolvedChannel } from './channel-selection.service.js';
export { resolveChannelForSend } from './channel-selection.service.js';
