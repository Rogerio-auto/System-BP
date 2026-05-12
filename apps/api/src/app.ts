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
import { isAppError } from './shared/errors.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport:
        env.NODE_ENV === 'development'
          ? {
              target: 'pino-pretty',
              options: { translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
            }
          : undefined,
      // -----------------------------------------------------------------------
      // pino.redact — lista canônica de PII (doc 17).
      // Garante que nenhum campo sensível apareça em logs estruturados,
      // independente de qual camada o loga (request body, resposta, contexto).
      // -----------------------------------------------------------------------
      redact: {
        paths: [
          'req.body.cpf',
          'req.body.cpf_hash',
          '*.cpf',
          'req.body.email',
          '*.email',
          'req.body.telefone',
          'req.body.phone',
          '*.telefone',
          '*.phone',
          'req.body.senha',
          'req.body.password',
          '*.senha',
          '*.password',
          'req.body.password_hash',
          '*.password_hash',
          'req.headers.authorization',
          '*.token',
          '*.refresh_token',
          '*.access_token',
        ],
        censor: '[REDACTED]',
      },
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

  // ---------------------------------------------------------------------------
  // Error handler centralizado.
  //
  // Prioridade de tratamento:
  //   1. AppError (domínio) → status + code + message + details opcionais
  //   2. Fastify validation (Zod via fastify-type-provider-zod) → 400 VALIDATION_ERROR
  //   3. Desconhecido → 500 sem vazar stack no body (stack logado pelo Pino)
  // ---------------------------------------------------------------------------
  app.setErrorHandler((error, request, reply) => {
    if (isAppError(error)) {
      // Log de nível warn para erros de domínio (4xx), error para 5xx
      if (error.statusCode >= 500) {
        request.log.error({ err: error }, 'application error');
      } else {
        request.log.warn({ err: error }, 'request error');
      }

      const body: Record<string, unknown> = {
        error: error.code,
        message: error.message,
      };
      if (error.details !== undefined) {
        body['details'] = error.details;
      }
      return reply.status(error.statusCode).send(body);
    }

    // Erros de validação gerados pelo Fastify (fastify-type-provider-zod)
    if (error.validation !== undefined) {
      request.log.warn({ err: error }, 'validation error');
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: error.validation,
      });
    }

    // Erros desconhecidos — logar completo, nunca vazar stack no body
    request.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send({
      error: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
  });

  return app;
}
