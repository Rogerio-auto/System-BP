// =============================================================================
// workers/index.ts — Registro de worker-handlers no outbox-publisher
//                    + referências de workers periódicos.
//
// Exporta setupWorkerHandlers() chamado em events/handlers.ts → setupHandlers()
// no startup do processo outbox-publisher.
//
// Cada handler importa db/logger do seu próprio módulo (db/client.ts + pino),
// o que os torna auto-suficientes e compatíveis com vi.mock nos testes.
//
// COMO ADICIONAR UM NOVO WORKER-HANDLER (event-driven):
//   1. Implemente em handlers/<nome>.ts, exporte build<Nome>Handler() ou similar.
//   2. Adicione o import e registerHandler() em setupWorkerHandlers() abaixo.
//   3. Nomeie o handlerName como "<dominio>.on_<evento>" (único — idempotência).
//
// COMO ADICIONAR UM NOVO WORKER PERIÓDICO:
//   1. Implemente em workers/<nome>.ts com main() + guarda process.argv.
//   2. Exporte a função de tick para testes (ex: runSchedulerTick).
//   3. Adicione o script em package.json (worker:<nome>).
//   4. (opcional) Re-exporte aqui para documentação centralizada de workers ativos.
// =============================================================================
import { registerHandler } from '../events/handlers.js';
import { buildAutoContractFromAnalysisHandler } from '../handlers/auto-contract-from-analysis.js';
import { buildCancelFollowupsOnReplyHandler } from '../handlers/cancel-followups-on-inbound-message.js';

import { buildKanbanOnAnalysisHandler } from './kanban-on-analysis.js';
import { buildKanbanOnSimulationHandler } from './kanban-on-simulation.js';

// F5-S02: worker periódico de agendamento de follow-ups.
// Iniciado como processo separado: pnpm --filter @elemento/api worker:followup
// Re-exportado aqui para documentação centralizada e acesso em scripts de diagnóstico.
export { runSchedulerTick } from './followup-scheduler.js';

// F5-S03: worker periódico de envio de templates via Meta WhatsApp Cloud API.
// Iniciado como processo separado: pnpm --filter @elemento/api worker:followup:sender
// Gated por followup.enabled + followup.sender.enabled (default=disabled).
export { runSenderTick } from './followup-sender.js';

// F5-S07: worker periódico de agendamento de cobranças de parcelas.
// Iniciado como processo separado: pnpm --filter @elemento/api worker:collection
// Gated por billing.enabled + billing.scheduler.enabled (default=disabled).
export { runCollectionSchedulerTick } from './collection-scheduler.js';

// F5-S07: worker periódico de envio de templates de cobrança via Meta WhatsApp.
// Iniciado como processo separado: pnpm --filter @elemento/api worker:collection:sender
// Gated por billing.enabled + billing.sender.enabled (default=disabled).
export { runCollectionSenderTick } from './collection-sender.js';

// F15-S08: worker periódico de varredura de inadimplência 15d.
// Detecta clientes com spc_status='none' e parcela(s) com 15+ dias de atraso.
// Cria tarefa spc_inclusion para role='cobranca' + emite evento payment_due.overdue_15d.
// Iniciado como processo separado: pnpm --filter @elemento/api worker:spc:scan
// Gated por spc.enabled + spc.scan.enabled (default=disabled).
export { runSpcOverdueScanTick } from './spc-overdue-scan.js';

// F16-S08: consumer RabbitMQ de mensagens inbound (live chat).
// Consome hm.q.inbound.message → parseia InboundEvent → persiste contato/conversa/mensagem
// (idempotente) → enfileira mídia (hm.q.inbound.media) → publica socket relay (hm.q.socket.relay).
// Iniciado como processo separado: pnpm --filter @elemento/api worker:livechat-inbound
// Exporta processMessage para testes unitários (sem iniciar o consumer real).
export { processMessage } from './livechat-inbound.js';

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

  // F4-S05: credit_analysis.status_changed → move card conforme decisão da análise
  registerHandler(
    'credit_analysis.status_changed',
    'kanban.on_analysis_status_changed',
    buildKanbanOnAnalysisHandler(),
  );

  // F5-S04: whatsapp.message_received → cancela followup_jobs scheduled do lead
  registerHandler(
    'whatsapp.message_received',
    'followup.cancel_on_customer_reply',
    buildCancelFollowupsOnReplyHandler(),
  );

  // F17-S13: credit_analysis.status_changed → cria/cancela contrato draft automaticamente
  registerHandler(
    'credit_analysis.status_changed',
    'contracts.on_analysis_status_changed',
    buildAutoContractFromAnalysisHandler(),
  );
}
