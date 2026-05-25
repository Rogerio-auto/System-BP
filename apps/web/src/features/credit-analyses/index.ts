// =============================================================================
// features/credit-analyses/index.ts — Barrel exports do módulo.
// =============================================================================

export { CreditAnalysesListPage } from './CreditAnalysesListPage';
export { CreditAnalysisDetailPage } from './CreditAnalysisDetailPage';
export { CreditAnalysisStatusBadge } from './components/CreditAnalysisStatusBadge';
export { CreditAnalysisDiff } from './components/CreditAnalysisDiff';
export { CreditAnalysisVersionTimeline } from './components/CreditAnalysisVersionTimeline';
export {
  CreditAnalysisForm,
  CreditAnalysisModal,
  AddVersionModal,
  DecideModal,
  RequestReviewModal,
} from './components/CreditAnalysisForm';
export {
  useCreditAnalysesList,
  useCreditAnalysis,
  useLeadCreditAnalyses,
  useCreateCreditAnalysis,
  useAddVersion,
  useDecideAnalysis,
  useRequestReview,
} from './hooks/useCreditAnalyses';
export type {
  CreditAnalysisStatus,
  CreditAnalysisResponse,
  CreditAnalysisListResponse,
  CreditAnalysisFilters,
} from './schemas';
export { ANALYSIS_STATUS_META, DECIDABLE_STATUSES } from './schemas';
