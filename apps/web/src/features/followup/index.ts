// =============================================================================
// features/followup/index.ts — Barrel exports do módulo de follow-up.
// =============================================================================

export { FollowupRulesPage } from './FollowupRulesPage';
export { FollowupJobsPage } from './FollowupJobsPage';
export { FollowupDisabledBanner } from './FollowupBanner';
export {
  useFollowupRules,
  useCreateFollowupRule,
  useUpdateFollowupRule,
  useFollowupJobs,
  useCancelFollowupJob,
  FOLLOWUP_KEYS,
} from './hooks/useFollowup';
export type {
  FollowupRuleResponse,
  FollowupRulesListResponse,
  FollowupJobResponse,
  FollowupJobsListResponse,
  FollowupJobsFilters,
  FollowupJobStatus,
  TriggerType,
} from './schemas';
export {
  JOB_STATUS_META,
  TRIGGER_TYPE_LABEL,
  CANCELLABLE_STATUSES,
  FollowupRuleFormSchema,
  FollowupJobStatusSchema,
} from './schemas';
