// =============================================================================
// handlers/index.ts — Barrel de handlers de eventos do sistema.
//
// Cada handler é responsável por processar eventos do outbox e executar
// side-effects (cancelamentos, notificações, etc.) de forma transacional.
// =============================================================================
export {
  buildCancelCollectionsOnPaymentHandler,
  cancelCollectionJobsOnPayment,
} from './cancel-collections-on-payment.js';

export {
  handleInboundMessageReceived,
  buildCancelFollowupsOnReplyHandler,
} from './cancel-followups-on-inbound-message.js';

// F24-S06: fan-out rules-driven por notification_rules (todos os eventos do catálogo)
export { handleFanoutNotification, buildFanoutNotificationHandler } from './fanout-notification.js';

// F17-S13: auto-contrato por análise aprovada/recusada
export {
  handleAutoContractFromAnalysis,
  buildAutoContractFromAnalysisHandler,
} from './auto-contract-from-analysis.js';
