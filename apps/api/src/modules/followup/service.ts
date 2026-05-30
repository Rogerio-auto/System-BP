// =============================================================================
// followup/service.ts — Regras de negócio para follow-up (F5-S05).
//
// Responsabilidades:
//   - Validar que template_id pertence à organização antes de criar regra.
//   - Delegação ao repository para queries Drizzle.
//   - City scope não se aplica a follow-up (escopo é organization_id).
//
// RBAC exigido (verificado nas rotas, não aqui):
//   - followup:read        — leitura de rules + jobs
//   - followup:write       — criação e update de rules
//   - followup:cancel_job  — cancelar job
// =============================================================================
import type { Database } from '../../db/client.js';

import {
  cancelFollowupJob,
  createFollowupRule,
  getFollowupRuleById,
  listFollowupJobs,
  listFollowupRules,
  updateFollowupRule,
} from './repository.js';
import type {
  FollowupJobResponse,
  FollowupJobsListQuery,
  FollowupJobsListResponse,
  FollowupRuleCreate,
  FollowupRuleResponse,
  FollowupRulesListResponse,
  FollowupRuleUpdate,
} from './schemas.js';

// ---------------------------------------------------------------------------
// Rules service
// ---------------------------------------------------------------------------

export async function listRulesService(
  db: Database,
  organizationId: string,
): Promise<FollowupRulesListResponse> {
  return listFollowupRules(db, organizationId);
}

export async function createRuleService(
  db: Database,
  organizationId: string,
  input: FollowupRuleCreate,
): Promise<FollowupRuleResponse> {
  return createFollowupRule(db, organizationId, input);
}

export async function updateRuleService(
  db: Database,
  organizationId: string,
  ruleId: string,
  input: FollowupRuleUpdate,
): Promise<FollowupRuleResponse> {
  // Verifica que a regra existe na organização (getFollowupRuleById lança NotFoundError)
  await getFollowupRuleById(db, organizationId, ruleId);
  return updateFollowupRule(db, organizationId, ruleId, input);
}

// ---------------------------------------------------------------------------
// Jobs service
// ---------------------------------------------------------------------------

export async function listJobsService(
  db: Database,
  organizationId: string,
  query: FollowupJobsListQuery,
): Promise<FollowupJobsListResponse> {
  return listFollowupJobs(db, organizationId, query);
}

export async function cancelJobService(
  db: Database,
  organizationId: string,
  jobId: string,
): Promise<FollowupJobResponse> {
  return cancelFollowupJob(db, organizationId, jobId);
}
