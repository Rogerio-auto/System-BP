// =============================================================================
// followup/service.ts — Regras de negócio para follow-up (F5-S05).
//
// Responsabilidades:
//   - Validar que template_id pertence à organização antes de criar/atualizar regra.
//   - Passar cityScopeIds ao repository para filtro RBAC multi-cidade em jobs.
//   - Delegação ao repository para queries Drizzle.
//
// RBAC exigido (verificado nas rotas, não aqui):
//   - followup:read        — leitura de rules + jobs
//   - followup:write       — criação e update de rules
//   - followup:cancel_job  — cancelar job
// =============================================================================
import type { Database } from '../../db/client.js';
import { NotFoundError } from '../../shared/errors.js';

import {
  cancelFollowupJob,
  checkTemplateInOrg,
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
  // M-02: validar que template_id pertence à org antes do INSERT
  const templateExists = await checkTemplateInOrg(db, organizationId, input.template_id);
  if (!templateExists) {
    throw new NotFoundError('Template não encontrado');
  }
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

  // M-02: se template_id está sendo atualizado, validar que pertence à org
  if (input.template_id !== undefined) {
    const templateExists = await checkTemplateInOrg(db, organizationId, input.template_id);
    if (!templateExists) {
      throw new NotFoundError('Template não encontrado');
    }
  }

  return updateFollowupRule(db, organizationId, ruleId, input);
}

// ---------------------------------------------------------------------------
// Jobs service
// ---------------------------------------------------------------------------

/**
 * Lista jobs filtrados por org e cityScopeIds (RBAC multi-cidade).
 * cityScopeIds === null → admin/gestor_geral: sem filtro de cidade.
 * cityScopeIds === []   → sem acesso: retorna vazio.
 * cityScopeIds: string[] → filtra leads.city_id IN (...).
 */
export async function listJobsService(
  db: Database,
  organizationId: string,
  cityScopeIds: string[] | null,
  query: FollowupJobsListQuery,
): Promise<FollowupJobsListResponse> {
  return listFollowupJobs(db, organizationId, cityScopeIds, query);
}

/**
 * Cancela job validando org + cityScope antes de atualizar.
 */
export async function cancelJobService(
  db: Database,
  organizationId: string,
  cityScopeIds: string[] | null,
  jobId: string,
): Promise<FollowupJobResponse> {
  return cancelFollowupJob(db, organizationId, cityScopeIds, jobId);
}
