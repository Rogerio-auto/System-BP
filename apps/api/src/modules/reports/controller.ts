// =============================================================================
// reports/controller.ts — HTTP handlers para os 3 endpoints de relatórios (F23-S03).
// Espelha o padrão de dashboard/controller.ts.
// request.user é garantido por authenticate() + authorize() nos preHandlers.
// =============================================================================
import type {
  AiQuery,
  AttendanceQuery,
  AuditQuery,
  CollectionQuery,
  CreditQuery,
  FunnelQuery,
  OverviewQuery,
  ProductivityQuery,
} from '@elemento/shared-schemas';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { db } from '../../db/client.js';
import { ForbiddenError } from '../../shared/errors.js';
import { typedQuery } from '../../shared/fastify-types.js';

import type { ReportsActorContext } from './service.js';
import {
  getReportsAi,
  getReportsAttendance,
  getReportsAudit,
  getReportsCollection,
  getReportsCredit,
  getReportsFunnel,
  getReportsOverview,
  getReportsProductivity,
} from './service.js';

function getActorContext(request: FastifyRequest): ReportsActorContext {
  if (!request.user)
    throw new ForbiddenError('Contexto de usuário ausente — authenticate() não foi executado');
  const { id, organizationId, permissions, cityScopeIds } = request.user;
  return {
    userId: id,
    organizationId,
    permissions,
    cityScopeIds,
    ip: request.ip,
    userAgent: request.headers['user-agent'] ?? null,
  };
}

export async function getReportsOverviewController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const result = await getReportsOverview(db, actor, typedQuery<OverviewQuery>(request));
  return reply.status(200).send(result);
}

export async function getReportsFunnelController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const result = await getReportsFunnel(db, actor, typedQuery<FunnelQuery>(request));
  return reply.status(200).send(result);
}

export async function getReportsAttendanceController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const result = await getReportsAttendance(db, actor, typedQuery<AttendanceQuery>(request));
  return reply.status(200).send(result);
}

export async function getReportsCreditController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const result = await getReportsCredit(db, actor, typedQuery<CreditQuery>(request));
  return reply.status(200).send(result);
}

export async function getReportsCollectionController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const result = await getReportsCollection(db, actor, typedQuery<CollectionQuery>(request));
  return reply.status(200).send(result);
}

export async function getReportsProductivityController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const result = await getReportsProductivity(db, actor, typedQuery<ProductivityQuery>(request));
  return reply.status(200).send(result);
}

export async function getReportsAiController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const result = await getReportsAi(db, actor, typedQuery<AiQuery>(request));
  return reply.status(200).send(result);
}

export async function getReportsAuditController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const result = await getReportsAudit(db, actor, typedQuery<AuditQuery>(request));
  return reply.status(200).send(result);
}
