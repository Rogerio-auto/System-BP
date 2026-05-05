// =============================================================================
// Fábrica do app Fastify. Permite testar sem subir porta.
// =============================================================================
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';

import { env } from './config/env.js';
import { healthRoutes } from './modules/health/health.routes.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport:
        env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' } }
          : undefined,
    },
    disableRequestLogging: false,
    genReqId: () => crypto.randomUUID(),
    trustProxy: true,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: env.CORS_ALLOWED_ORIGINS,
    credentials: true,
  });
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });
  await app.register(sensible);

  await app.register(healthRoutes);

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'request error');
    if (error.validation) {
      return reply.status(400).send({ error: 'validation_error', issues: error.validation });
    }
    const statusCode = error.statusCode ?? 500;
    return reply.status(statusCode).send({
      error: error.name ?? 'internal_error',
      message: statusCode >= 500 ? 'Internal server error' : error.message,
    });
  });

  return app;
}
