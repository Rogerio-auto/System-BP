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
// F16-S29: worker RabbitMQ consumer de IA do livechat.
// Consome hm.q.livechat.ai, executa LangGraph e responde via sendMessage.
// Iniciado como processo separado: pnpm --filter @elemento/api worker:livechat-ai
export { processJob } from './livechat-ai.js';

// COMO ADICIONAR UM NOVO WORKER PERIÓDICO:
//   1. Implemente em workers/<nome>.ts com main() + guarda process.argv.
//   2. Exporte a função de tick para testes (ex: runSchedulerTick).
//   3. Adicione o script em package.json (worker:<nome>).
//   4. (opcional) Re-exporte aqui para documentação centralizada de workers ativos.
// =============================================================================
import { registerHandler } from '../events/handlers.js';
import { buildAutoContractFromAnalysisHandler } from '../handlers/auto-contract-from-analysis.js';
import { buildCancelFollowupsOnReplyHandler } from '../handlers/cancel-followups-on-inbound-message.js';
import { buildFanoutNotificationHandler } from '../handlers/fanout-notification.js';

import { buildKanbanOnAnalysisHandler } from './kanban-on-analysis.js';
import { buildKanbanOnQualificationHandler } from './kanban-on-qualification.js';
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

// F17-S09: worker periódico de win-back (3 gatilhos independentes).
// 1. winback_renovation: contratos com ≤2 parcelas não pagas restantes.
// 2. winback_lost: leads com status='closed_lost' há ≥30 dias.
// 3. winback_stagnant: kanban cards sem mudança de stage há ≥45 dias.
// Cria tarefa winback para role='agente' + emite evento contract.near_end (scan 1).
// Iniciado como processo separado: pnpm --filter @elemento/api worker:winback
// Gated por winback.enabled + winback.scan.enabled (default=disabled).
export { runWinbackScan } from './winback-scan.js';

// F16-S08: consumer RabbitMQ de mensagens inbound (live chat).
// Consome hm.q.inbound.message → parseia InboundEvent → persiste contato/conversa/mensagem
// (idempotente) → enfileira mídia (hm.q.inbound.media) → publica socket relay (hm.q.socket.relay).
// Iniciado como processo separado: pnpm --filter @elemento/api worker:livechat-inbound
// Exporta processMessage para testes unitários (sem iniciar o consumer real).
export { processMessage } from './livechat-inbound.js';

// F23-S01: worker periodico de refresh das MVs de relatorios.
// Iniciado como processo separado: pnpm --filter @elemento/api worker:reports:refresh
// Intervalo: 5 min. Advisory lock previne sobreposicao de execucoes.
// Gated por dashboard.enabled (default=disabled).
export { runReportsRefreshTick } from './reports-refresh.js';

/**
 * Registra todos os worker-handlers de domínio no registry do outbox-publisher.
 *
 * Chamado via dynamic import em events/handlers.ts → setupHandlers().
 * Handlers são self-contained: importam db e logger internamente.
 */
export function setupWorkerHandlers(): void {
  // F25-S03: leads.qualified -> eleva priority do card (sem mover stage)
  registerHandler(
    'leads.qualified',
    'kanban.on_lead_qualified',
    buildKanbanOnQualificationHandler(),
  );

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

  // F24-S06: fan-out rules-driven — registrar para todos os eventos do TRIGGER_CATALOG (kind='event').
  // O handler é idempotente (bucket=event_id) e verifica a flag notifications.rules.enabled.
  // Um único builder é criado e compartilhado para todos os eventos do catálogo.
  const fanoutHandler = buildFanoutNotificationHandler();

  // Eventos catalogados com kind='event' (TRIGGER_CATALOG em packages/shared-schemas).
  // O handler lê notification_rules do DB por trigger_key = event_name, portanto
  // registrar para todos os eventos do catálogo é seguro — sem regras = no-op.
  const FANOUT_EVENT_NAMES = [
    'simulations.generated',
    'credit_analysis.status_changed',
    'chatwoot.handoff_requested',
    'contract.signed',
    'contract.near_end',
    'payment_due.overdue_15d',
    'billing.collection_sent',
    'task.created',
    'customer.law_firm_referred',
  ] as const;

  for (const eventName of FANOUT_EVENT_NAMES) {
    registerHandler(
      eventName,
      `notifications.fanout.on_${eventName.replace(/\./g, '_')}`,
      fanoutHandler,
    );
  }
}
