// =============================================================================
// features/billing/index.ts — Barrel exports do módulo de cobrança (F5-S08).
// =============================================================================

export { PaymentDuesPage } from './PaymentDuesPage';
export { CollectionRulesPage } from './CollectionRulesPage';
export { CollectionJobsPage } from './CollectionJobsPage';
export { BillingGatedBanner } from './components/BillingGatedBanner';
export { MarkPaidModal } from './components/MarkPaidModal';
export {
  usePaymentDues,
  useMarkPaymentDuePaid,
  useRenegotiatePaymentDue,
  useCollectionRules,
  useCreateCollectionRule,
  useUpdateCollectionRule,
  useCollectionJobs,
  useCancelCollectionJob,
  BILLING_KEYS,
} from './hooks/useBilling';
export type {
  PaymentDueResponse,
  PaymentDuesListResponse,
  PaymentDuesFilters,
  PaymentDueStatus,
  CollectionRuleResponse,
  CollectionRulesListResponse,
  CollectionRuleForm,
  CollectionJobResponse,
  CollectionJobsListResponse,
  CollectionJobsFilters,
  CollectionJobStatus,
  CollectionTriggerType,
} from './schemas';
export {
  DUE_STATUS_META,
  JOB_STATUS_META,
  TRIGGER_TYPE_LABEL,
  CANCELLABLE_JOB_STATUSES,
  MARKABLE_DUE_STATUSES,
  CollectionRuleFormSchema,
  PaymentDueStatusSchema,
  CollectionJobStatusSchema,
} from './schemas';
