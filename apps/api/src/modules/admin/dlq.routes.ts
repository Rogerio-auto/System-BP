// =============================================================================
// modules/admin/dlq.routes.ts — Rotas admin da Dead-Letter Queue (DLQ).
//
// Rotas:
//   GET  /api/admin/dlq           — lista entradas pendentes (admin/superadmin)
//   POST /api/admin/dlq/:id/replay — retenta um evento da DLQ (admin/superadmin)
//
// RBAC: permissão 'dlq:manage' (admin/superadmin).
//
// Audit: replay registra auditoria via auditLog() na transação.
//
// Paginação: limit/offset via query string (GET).
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { db } from '../../db/client.js';
import { auditLog } from '../../lib/audit.js';
import { findDlqById, listPendingDlq, replayFromDlq } from '../../services/outbox/dlq.js';
import { NotFoundError, ConflictError } from '../../shared/errors.js';
import { authenticate, authorize } from '../auth/middlewares/index.js';

// ---------------------------------------------------------------------------
// Schemas de resposta
// ---------------------------------------------------------------------------

const dlqEntrySchema = z.object({
  id: z.string().uuid(),
  originalEventId: z.string().uuid(),
  organizationId: z.string().uuid(),
  eventName: z.string(),
  eventVersion: z.number().int(),
  aggregateType: z.string(),
  aggregateId: z.string().uuid(),
  /** Payload sem PII bruta — LGPD §8.5. */
  payload: z.record(z.unknown()),
  correlationId: z.string().uuid().nullable(),
  totalAttempts: z.number().int(),
  lastError: z.string().nullable(),
  reprocessed: z.boolean(),
  reprocessEventId: z.string().uuid().nullable(),
  movedAt: z.string(),
  reprocessedAt: z.string().nullable(),
});

const dlqListResponseSchema = z.object({
  data: z.array(dlqEntrySchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});

const replayResponseSchema = z.object({
  newEventId: z.string().uuid(),
  message: z.string(),
});

// ---------------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------------

export const adminDlqRoutes: FastifyPluginAsyncZod = async (app) => {
  // -------------------------------------------------------------------------
  // GET /api/admin/dlq — lista entradas pendentes da DLQ
  // -------------------------------------------------------------------------
  app.get(
    '/api/admin/dlq',
    {
      preHandler: [authenticate(), authorize({ permissions: ['dlq:manage'] })],
      schema: {
        querystring: z.object({
          event_name: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
          offset: z.coerce.number().int().min(0).default(0),
        }),
        response: {
          200: dlqListResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { event_name, limit, offset } = request.query;
      const user = request.user!;

      const rows = await listPendingDlq({
        // Escopo de cidade: admin vê sua organização; superadmin pode ver todas.
        // Por ora filtra por organizationId do usuário (RBAC multi-tenant).
        organizationId: user.cityScopeIds !== null ? user.organizationId : undefined,
        eventName: event_name,
        limit,
        offset,
      });

      const mapped = rows.map((row) => ({
        id: row.id,
        originalEventId: row.originalEventId,
        organizationId: row.organizationId,
        eventName: row.eventName,
        eventVersion: row.eventVersion,
        aggregateType: row.aggregateType,
        aggregateId: row.aggregateId,
        payload: row.payload as Record<string, unknown>,
        correlationId: row.correlationId ?? null,
        totalAttempts: row.totalAttempts,
        lastError: row.lastError ?? null,
        reprocessed: row.reprocessed,
        reprocessEventId: row.reprocessEventId ?? null,
        movedAt: row.movedAt.toISOString(),
        reprocessedAt: row.reprocessedAt?.toISOString() ?? null,
      }));

      return reply.status(200).send({
        data: mapped,
        total: mapped.length,
        limit,
        offset,
      });
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/admin/dlq/:id/replay — retenta um evento da DLQ
  // -------------------------------------------------------------------------
  app.post(
    '/api/admin/dlq/:id/replay',
    {
      preHandler: [authenticate(), authorize({ permissions: ['dlq:manage'] })],
      schema: {
        params: z.object({
          id: z.string().uuid(),
        }),
        response: {
          200: replayResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id: dlqId } = request.params;
      const user = request.user!;

      // Validar existência antes do replay
      const dlqRow = await findDlqById(dlqId);
      if (dlqRow === undefined) {
        throw new NotFoundError(`DLQ entry not found: ${dlqId}`);
      }
      if (dlqRow.reprocessed) {
        throw new ConflictError(`DLQ entry already reprocessed: ${dlqId}`, {
          dlqId,
          reprocessedAt: dlqRow.reprocessedAt,
          reprocessEventId: dlqRow.reprocessEventId,
        });
      }

      const { newEventId } = await replayFromDlq({
        dlqId,
        actorUserId: user.id,
      });

      // Audit log — mutação sensível (reprocessamento de evento de domínio)
      // Executa fora de transaction explícita (audit é best-effort aqui).
      await db.transaction(async (tx) => {
        await auditLog(
          // Justificativa do `as`: DrizzleTx é interface estrutural mínima;
          // transação Drizzle satisfaz o contrato mas TypeScript não infere sem cast.
          tx as Parameters<typeof auditLog>[0],
          {
            organizationId: dlqRow.organizationId,
            actor: {
              userId: user.id,
              role: user.permissions[0] ?? 'admin',
              ip: request.ip,
              userAgent: request.headers['user-agent'] ?? null,
            },
            action: 'dlq.replay',
            resource: { type: 'event_dlq', id: dlqId },
            before: {
              reprocessed: false,
              totalAttempts: dlqRow.totalAttempts,
              lastError: dlqRow.lastError,
            },
            after: {
              reprocessed: true,
              newEventId,
            },
          },
        );
      });

      return reply.status(200).send({
        newEventId,
        message: 'Event queued for reprocessing',
      });
    },
  );
};
