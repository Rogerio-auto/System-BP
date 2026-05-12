// =============================================================================
// routes/data-subject.routes.ts — LGPD direitos do titular (F1-S25).
//
// Rotas (base /api/v1/data-subject):
//   POST /confirm
//   POST /access-request
//   POST /portability-request
//   POST /consent/revoke
//   POST /anonymize-request
//   POST /delete-request
//   POST /review-decision/:analysis_id
//
// Segurança:
//   - Rate-limit 3/h por CPF hash: chave customizada ${ip}:${cpf_hash}.
//   - Sem authenticate() (o titular se autentica via desafio OTP próprio).
//   - Zod em todas as bordas via ZodTypeProvider.
//   - LGPD §14.2: cpf_hash nunca é logado (pino.redact).
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
  accessRequestController,
  anonymizeRequestController,
  confirmController,
  consentRevokeController,
  deleteRequestController,
  portabilityRequestController,
  reviewDecisionController,
} from '../controllers/data-subject.controller.js';

// ---------------------------------------------------------------------------
// Schemas compartilhados
// ---------------------------------------------------------------------------

/** Body base para todos os endpoints do titular. */
const dataSubjectBaseSchema = z.object({
  /** UUID da organização a que pertence o titular. */
  organization_id: z.string().uuid({ message: 'organization_id deve ser um UUID válido' }),
  /**
   * HMAC-SHA256 do CPF normalizado (sem pontos/traços).
   * NUNCA enviar o CPF em claro — o hash é derivado no cliente ou no canal verificado.
   * LGPD doc 17 §8.1.
   */
  cpf_hash: z.string().min(1, 'cpf_hash é obrigatório').max(256),
  /**
   * OTP de 6 dígitos enviado ao canal verificado (WhatsApp ou email).
   * TTL: 10 minutos. Single-use.
   */
  otp: z
    .string()
    .length(6, 'OTP deve ter exatamente 6 dígitos')
    .regex(/^\d{6}$/, 'OTP deve conter apenas dígitos'),
  /**
   * Chave de idempotência fornecida pelo cliente.
   * Permite reenvios seguros sem duplicar a solicitação.
   * Recomendação: UUID v4 gerado pelo cliente.
   */
  request_id: z.string().uuid({ message: 'request_id deve ser um UUID válido' }),
});

/** Resposta padrão de solicitação registrada. */
const requestResponseSchema = z.object({
  request_id: z.string(),
  status: z.string(),
  message: z.string(),
});

// ---------------------------------------------------------------------------
// Plugin de rotas
// ---------------------------------------------------------------------------

export const dataSubjectRoutes: FastifyPluginAsyncZod = async (app) => {
  // -------------------------------------------------------------------------
  // POST /api/v1/data-subject/confirm
  // -------------------------------------------------------------------------
  app.post(
    '/api/v1/data-subject/confirm',
    {
      config: {
        // Rate-limit custom: 3/h por combinação ip:cpf_hash
        rateLimit: {
          max: 3,
          timeWindow: '1 hour',
          keyGenerator: (request) => {
            const body = request.body as { cpf_hash?: string } | undefined;
            return `${request.ip}:${body?.cpf_hash ?? 'unknown'}`;
          },
        },
      },
      schema: {
        body: dataSubjectBaseSchema,
        response: {
          200: requestResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await confirmController(request.body, request.ip);
      await reply.status(200).send(result);
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/v1/data-subject/access-request
  // -------------------------------------------------------------------------
  app.post(
    '/api/v1/data-subject/access-request',
    {
      config: {
        rateLimit: {
          max: 3,
          timeWindow: '1 hour',
          keyGenerator: (request) => {
            const body = request.body as { cpf_hash?: string } | undefined;
            return `${request.ip}:${body?.cpf_hash ?? 'unknown'}`;
          },
        },
      },
      schema: {
        body: dataSubjectBaseSchema,
        response: {
          200: requestResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await accessRequestController(request.body, request.ip);
      await reply.status(200).send(result);
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/v1/data-subject/portability-request
  // -------------------------------------------------------------------------
  app.post(
    '/api/v1/data-subject/portability-request',
    {
      config: {
        rateLimit: {
          max: 3,
          timeWindow: '1 hour',
          keyGenerator: (request) => {
            const body = request.body as { cpf_hash?: string } | undefined;
            return `${request.ip}:${body?.cpf_hash ?? 'unknown'}`;
          },
        },
      },
      schema: {
        body: dataSubjectBaseSchema,
        response: {
          200: requestResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await portabilityRequestController(request.body, request.ip);
      await reply.status(200).send(result);
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/v1/data-subject/consent/revoke
  // -------------------------------------------------------------------------
  app.post(
    '/api/v1/data-subject/consent/revoke',
    {
      config: {
        rateLimit: {
          max: 3,
          timeWindow: '1 hour',
          keyGenerator: (request) => {
            const body = request.body as { cpf_hash?: string } | undefined;
            return `${request.ip}:${body?.cpf_hash ?? 'unknown'}`;
          },
        },
      },
      schema: {
        body: dataSubjectBaseSchema,
        response: {
          200: z.object({
            request_id: z.string(),
            status: z.string(),
            revoked_at: z.string(),
          }),
        },
      },
    },
    async (request, reply) => {
      const result = await consentRevokeController(request.body, request.ip);
      await reply.status(200).send(result);
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/v1/data-subject/anonymize-request
  // -------------------------------------------------------------------------
  app.post(
    '/api/v1/data-subject/anonymize-request',
    {
      config: {
        rateLimit: {
          max: 3,
          timeWindow: '1 hour',
          keyGenerator: (request) => {
            const body = request.body as { cpf_hash?: string } | undefined;
            return `${request.ip}:${body?.cpf_hash ?? 'unknown'}`;
          },
        },
      },
      schema: {
        body: dataSubjectBaseSchema,
        response: {
          200: requestResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await anonymizeRequestController(request.body, request.ip);
      await reply.status(200).send(result);
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/v1/data-subject/delete-request
  // -------------------------------------------------------------------------
  app.post(
    '/api/v1/data-subject/delete-request',
    {
      config: {
        rateLimit: {
          max: 3,
          timeWindow: '1 hour',
          keyGenerator: (request) => {
            const body = request.body as { cpf_hash?: string } | undefined;
            return `${request.ip}:${body?.cpf_hash ?? 'unknown'}`;
          },
        },
      },
      schema: {
        body: dataSubjectBaseSchema,
        response: {
          200: requestResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await deleteRequestController(request.body, request.ip);
      await reply.status(200).send(result);
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/v1/data-subject/review-decision/:analysis_id
  // -------------------------------------------------------------------------
  app.post(
    '/api/v1/data-subject/review-decision/:analysis_id',
    {
      config: {
        rateLimit: {
          max: 3,
          timeWindow: '1 hour',
          keyGenerator: (request) => {
            const body = request.body as { cpf_hash?: string } | undefined;
            return `${request.ip}:${body?.cpf_hash ?? 'unknown'}`;
          },
        },
      },
      schema: {
        params: z.object({
          analysis_id: z.string().uuid({ message: 'analysis_id deve ser um UUID válido' }),
        }),
        body: dataSubjectBaseSchema,
        response: {
          200: z.object({
            request_id: z.string(),
            status: z.string(),
            analysis_id: z.string(),
            message: z.string(),
          }),
        },
      },
    },
    async (request, reply) => {
      const result = await reviewDecisionController(
        request.params.analysis_id,
        request.body,
        request.ip,
      );
      await reply.status(200).send(result);
    },
  );
};
