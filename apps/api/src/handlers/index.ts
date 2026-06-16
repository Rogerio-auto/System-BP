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

// F15-S06: fan-out de notificações por evento (task.created, contract.signed)
export { handleFanoutNotification } from './fanout-notification.js';

// F17-S13: auto-contrato por análise aprovada/recusada
export { handleAutoContractFromAnalysis } from './auto-contract-from-analysis.js';
