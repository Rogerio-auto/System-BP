// =============================================================================
// features/contracts/index.ts — Barrel da feature Contratos (F17-S05, F17-S06, F17-S11, F17-S14).
// =============================================================================

export { ContractsPage } from './ContractsPage';
export { ContractDetail } from './ContractDetail';
export { ContractCreateModal } from './ContractCreateModal';
export { ContractSignModal } from './ContractSignModal';
export { ContractHealthBadge } from './ContractHealthBadge';
export { ContractDuesList } from './ContractDuesList';
export { LinkedContractBadge } from './LinkedContractBadge';
export {
  useContracts,
  useContract,
  useSignContract,
  useContractHealth,
  useContractDues,
  useCreateContract,
  useContractByAnalysis,
} from './hooks';
