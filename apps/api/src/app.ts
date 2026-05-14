// =============================================================================
// Fábrica do app Fastify. Permite testar sem subir porta.
// =============================================================================
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';

import { env } from './config/env.js';
import { adminDlqRoutes } from './modules/admin/dlq.routes.js';
import { authRoutes } from './modules/auth/routes.js';
import { chatwootWebhookRoutes } from './modules/chatwoot/routes.js';
import { citiesPublicRoutes, citiesRoutes } from './modules/cities/routes.js';
import { creditProductsRoutes } from './modules/credit-products/routes.js';
import { featureFlagsRoutes } from './modules/featureFlags/routes.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { importsRoutes } from './modules/imports/routes.js';
import { internalFeatureFlagsRoutes } from './modules/internal/featureFlags/routes.js';
import { kanbanRoutes } from './modules/kanban/routes.js';
import { leadsRoutes } from './modules/leads/routes.js';
import { internalSimulationsRoutes } from './modules/simulations/internal-routes.js';
import { simulationsRoutes } from './modules/simulations/routes.js';
import { usersRoutes } from './modules/users/routes.js';
import { whatsappRoutes } from './modules/whatsapp/routes.js';
import { dataSubjectRoutes } from './routes/data-subject.routes.js';
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
          // WhatsApp PII (F1-S19) — LGPD §8.3
          // payload.text.body pode conter mensagem livre do cidadão (CPF, endereço, etc.)
          '*.text.body',
          '*.from',
          'req.body.entry[*].changes[*].value.messages[*].text.body',
          'req.body.entry[*].changes[*].value.messages[*].from',
          '*.messages[*].text.body',
          '*.messages[*].from',
          // Chatwoot PII (F1-S20) — LGPD §8.3
          // *.content pode conter texto livre do cidadão (mensagens, notas internas)
          '*.content',
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
  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  });

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(featureFlagsRoutes);
  // Admin CRUD de cidades (F1-S06)
  await app.register(citiesRoutes);
  // Lista publica de cidades para popular selects (qualquer user autenticado)
  await app.register(citiesPublicRoutes);
  await app.register(internalFeatureFlagsRoutes);
  await app.register(kanbanRoutes);
  await app.register(leadsRoutes);
  await app.register(whatsappRoutes);
  // Webhook Chatwoot (F1-S21) — entrada + idempotência + outbox
  await app.register(chatwootWebhookRoutes);
  await app.register(usersRoutes);
  // LGPD — direitos do titular (F1-S25)
  await app.register(dataSubjectRoutes);
  // Importações pipeline (F1-S17)
  await app.register(importsRoutes);
  // Admin — Dead-Letter Queue (F1-S22)
  await app.register(adminDlqRoutes);
  // Produtos de crédito + regras versionadas (F2-S03)
  await app.register(creditProductsRoutes);
  // Simulações de crédito via UI (F2-S04)
  await app.register(simulationsRoutes);
  // Simulações de crédito via IA (F2-S05) — canal M2M, X-Internal-Token, idempotente
  await app.register(internalSimulationsRoutes);

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
