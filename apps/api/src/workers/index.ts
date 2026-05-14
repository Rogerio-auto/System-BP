// =============================================================================
// workers/index.ts — Registro de worker-handlers no outbox-publisher.
//
// Exporta setupWorkerHandlers() chamado em events/handlers.ts → setupHandlers()
// no startup do processo outbox-publisher.
//
// Cada handler importa db/logger do seu próprio módulo (db/client.ts + pino),
// o que os torna auto-suficientes e compatíveis com vi.mock nos testes.
//
// COMO ADICIONAR UM NOVO WORKER-HANDLER:
//   1. Implemente em workers/<nome>.ts, exporte registerKanbanXxx() ou similar.
//   2. Adicione o import e registerHandler() em setupWorkerHandlers() abaixo.
//   3. Nomeie o handlerName como "<dominio>.on_<evento>" (único — idempotência).
// =============================================================================
import { registerHandler } from '../events/handlers.js';

import { buildKanbanOnSimulationHandler } from './kanban-on-simulation.js';

/**
 * Registra todos os worker-handlers de domínio no registry do outbox-publisher.
 *
 * Chamado via dynamic import em events/handlers.ts → setupHandlers().
 * Handlers são self-contained: importam db e logger internamente.
 */
export function setupWorkerHandlers(): void {
  // F2-S09: simulations.generated → move card para "Simulação" se em "Pré-atendimento"
  registerHandler(
    'simulations.generated',
    'kanban.on_simulation_generated',
    buildKanbanOnSimulationHandler(),
  );
}
