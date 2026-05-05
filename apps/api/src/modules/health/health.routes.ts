// =============================================================================
// /health — verifica que o serviço está vivo + dependências críticas.
// Não esconda falhas. Se DB caiu, retorne 503 com status detalhado.
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { pool } from '../../db/client.js';

const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  uptime_s: z.number(),
  checks: z.object({
    db: z.enum(['ok', 'down']),
  }),
});

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/health',
    { schema: { response: { 200: healthResponseSchema, 503: healthResponseSchema } } },
    async (_req, reply) => {
      let dbStatus: 'ok' | 'down' = 'ok';
      try {
        await pool.query('SELECT 1');
      } catch {
        dbStatus = 'down';
      }

      const status = dbStatus === 'ok' ? 'ok' : 'down';
      const code = status === 'ok' ? 200 : 503;

      return reply.code(code).send({
        status,
        uptime_s: Math.round(process.uptime()),
        checks: { db: dbStatus },
      });
    },
  );
};
