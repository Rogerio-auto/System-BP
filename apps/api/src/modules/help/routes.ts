// help/routes.ts - Rotas de telemetria da Central de Ajuda (F10-S12).
//
// Rotas:
//   POST /api/help/views     - registra visualizacao (autenticado, rate-limit 30s)
//   POST /api/help/feedback  - registra avaliacao (autenticado)
//   GET  /api/help/popular   - top N slugs por views 30 dias (autenticado)
//
// LGPD (doc 17 sec 9):
//   - POST /views: rate-limit 30s por userId:slug. Excedente -> 204 (silencioso).
//   - POST /feedback: pino.redact cobre req.body.comment.
//   - GET /popular: slug+count agregado - sem PII.
//
// TODO (F10-S09): adicionar tag Help em plugins/openapi.ts quando S09 mergear.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { db } from '../../db/client.js';
import { authenticate } from '../auth/middlewares/authenticate.js';

import { getPopular, recordFeedback, recordView } from './repository.js';
import {
  PopularQuery,
  PopularResponseSchema,
  RecordFeedbackBody,
  RecordViewBody,
} from './schemas.js';

// ---------------------------------------------------------------------------
// Rate-limit in-memory (MVP single-instance)
// Estrutura: Map<userId:slug, lastViewAt epoch ms>
// TTL: 30s. GC a cada 1000 inserts (remove entries > 60s).
// Limitacao: nao funciona em multi-instancia. Migracao futura: Redis SETNX.
// ---------------------------------------------------------------------------

const RATE_LIMIT_MS = 30_000;
const GC_INTERVAL = 1_000;
const GC_STALE_MS = 60_000;

const viewRateMap = new Map<string, number>();
let insertsSinceLastGc = 0;

function checkAndSetRateLimit(userId: string, slug: string): boolean {
  const key = `${userId}:${slug}`;
  const now = Date.now();
  const lastAt = viewRateMap.get(key);

  if (lastAt !== undefined && now - lastAt < RATE_LIMIT_MS) {
    return false;
  }

  viewRateMap.set(key, now);

  insertsSinceLastGc++;
  if (insertsSinceLastGc >= GC_INTERVAL) {
    insertsSinceLastGc = 0;
    const cutoff = now - GC_STALE_MS;
    for (const [k, t] of viewRateMap.entries()) {
      if (t < cutoff) viewRateMap.delete(k);
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Cache in-memory para GET /popular
// TTL: 10 minutos. Invalidacao eventual (writes nao invalidam).
// ---------------------------------------------------------------------------

interface CacheEntry {
  data: Array<{ slug: string; count: number }>;
  expiresAt: number;
}

const popularCache = new Map<number, CacheEntry>();
const POPULAR_CACHE_TTL_MS = 10 * 60 * 1000;
const POPULAR_PERIOD_DAYS = 30;

// ---------------------------------------------------------------------------
// Plugin de rotas
// ---------------------------------------------------------------------------

export const helpRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', authenticate());

  // POST /api/help/views
  app.post('/api/help/views', { schema: { body: RecordViewBody } }, async (request, reply) => {
    const userId = (request.user as { id: string }).id;
    const { slug } = request.body;

    if (!checkAndSetRateLimit(userId, slug)) {
      return reply.status(204).send();
    }

    await recordView(db, userId, slug);
    return reply.status(201).send();
  });

  // POST /api/help/feedback
  app.post(
    '/api/help/feedback',
    { schema: { body: RecordFeedbackBody } },
    async (request, reply) => {
      const userId = (request.user as { id: string }).id;
      const { slug, helpful, comment } = request.body;

      // LGPD: pino.redact cobre req.body.comment no log automatico do Fastify.
      // Nao logar comment manualmente.
      const result = await recordFeedback(db, userId, { slug, helpful, comment });
      return reply.status(201).send({ id: result.id });
    },
  );

  // GET /api/help/popular
  app.get(
    '/api/help/popular',
    { schema: { querystring: PopularQuery, response: { 200: PopularResponseSchema } } },
    async (request, reply) => {
      const { limit } = request.query;

      const cached = popularCache.get(limit);
      if (cached !== undefined && Date.now() < cached.expiresAt) {
        return reply
          .status(200)
          .send({ data: cached.data, period_days: POPULAR_PERIOD_DAYS, cached: true });
      }

      const since = new Date(Date.now() - POPULAR_PERIOD_DAYS * 24 * 60 * 60 * 1000);
      const data = await getPopular(db, limit, since);

      popularCache.set(limit, { data, expiresAt: Date.now() + POPULAR_CACHE_TTL_MS });
      return reply.status(200).send({ data, period_days: POPULAR_PERIOD_DAYS, cached: false });
    },
  );
};
