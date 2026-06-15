// =============================================================================
// billing/routes.ts — Rotas do módulo de cobrança (F5-S08, F5-S13).
//
// Rotas:
//   GET    /api/billing/payment-dues                (billing:read)
//   POST   /api/billing/payment-dues/:id/mark-paid  (billing:mark_paid)
//   POST   /api/billing/payment-dues/:id/renegotiate (billing:mark_paid)
//   POST   /api/billing/payment-dues/:id/boleto      (billing:boleto:write) — F5-S13
//   DELETE /api/billing/payment-dues/:id/boleto      (billing:boleto:write) — F5-S13
//   GET    /api/billing/rules                       (billing:read)
//   POST   /api/billing/rules                       (billing:write)
//   PATCH  /api/billing/rules/:id                   (billing:write)
//   GET    /api/billing/jobs                        (billing:read)
//   POST   /api/billing/jobs/:id/cancel             (billing:cancel_job)
//
// RBAC:
//   - billing:read          → listagem de dues + rules + jobs.
//   - billing:write         → criação e edição de rules.
//   - billing:mark_paid     → marcar pago/renegociado.
//   - billing:cancel_job    → cancelamento manual de job agendado.
//   - billing:boleto:write  → anexar/remover boleto (upload + referência).
//
// Gate: billing.boleto.enabled (feature flag — disabled por default).
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { featureGate } from '../../plugins/featureGate.js';
import { authenticate } from '../auth/middlewares/authenticate.js';
import { authorize } from '../auth/middlewares/authorize.js';

import {
  attachBoletoController,
  cancelJobController,
  createRuleController,
  listDuesController,
  listJobsController,
  listRulesController,
  markPaidController,
  removeBoletoController,
  renegotiateController,
  updateRuleController,
} from './controller.js';
import {
  BoletoResponseSchema,
  CollectionJobResponseSchema,
  CollectionJobsListQuerySchema,
  CollectionJobsListResponseSchema,
  CollectionRuleCreateSchema,
  CollectionRuleResponseSchema,
  CollectionRulesListResponseSchema,
  CollectionRuleUpdateSchema,
  MarkPaidBodySchema,
  PaymentDueResponseSchema,
  PaymentDuesListQuerySchema,
  PaymentDuesListResponseSchema,
  RenegotiateBodySchema,
  dueIdParamSchema,
  jobIdParamSchema,
  ruleIdParamSchema,
} from './schemas.js';

export const billingRoutes: FastifyPluginAsyncZod = async (app) => {
  // Autenticação obrigatória em todas as rotas deste plugin
  app.addHook('preHandler', authenticate());

  // ---------------------------------------------------------------------------
  // GET /api/billing/payment-dues
  // ---------------------------------------------------------------------------
  app.get(
    '/api/billing/payment-dues',
    {
      schema: {
        tags: ['Billing'],
        summary: 'Listar parcelas',
        description: 'Lista parcelas.',
        security: [{ bearerAuth: [] }],
        querystring: PaymentDuesListQuerySchema,
        response: {
          200: PaymentDuesListResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['billing:read'] })],
    },
    listDuesController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/billing/payment-dues/:id/mark-paid
  // ---------------------------------------------------------------------------
  app.post(
    '/api/billing/payment-dues/:id/mark-paid',
    {
      schema: {
        tags: ['Billing'],
        summary: 'Marcar parcela como paga',
        description: 'Marca uma parcela como paga.',
        security: [{ bearerAuth: [] }],
        params: dueIdParamSchema,
        body: MarkPaidBodySchema,
        response: {
          200: PaymentDueResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['billing:mark_paid'] })],
    },
    markPaidController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/billing/payment-dues/:id/renegotiate
  // ---------------------------------------------------------------------------
  app.post(
    '/api/billing/payment-dues/:id/renegotiate',
    {
      schema: {
        tags: ['Billing'],
        summary: 'Renegociar parcela',
        description: 'Cria uma renegociacao para uma parcela em atraso.',
        security: [{ bearerAuth: [] }],
        params: dueIdParamSchema,
        body: RenegotiateBodySchema,
        response: {
          200: PaymentDueResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['billing:mark_paid'] })],
    },
    renegotiateController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/billing/payment-dues/:id/boleto (F5-S13)
  //
  // Aceita dois modos de body:
  //   - multipart/form-data: campo 'file' (PDF/JPG/PNG, máx 10 MB).
  //   - application/json: { boletoUrl?, digitableLine?, pixCopiaCola?, filename? }.
  //
  // Idempotency-Key obrigatório no header.
  // Gate: billing.boleto.enabled (disabled por default — habilitar após sign-off).
  // RBAC: billing:boleto:write + city scope (gestor_regional só acessa sua cidade).
  //
  // LGPD §14.2: o boleto contém PII (nome, CPF, endereço do devedor).
  //   - Modo upload: bytes não persistem (apenas boleto_media_id + filename).
  //   - Modo referência: boleto_url deve ser host da allowlist (BOLETO_ALLOWED_HOSTS).
  //   - auditLog sem PII; outbox sem PII; pino.redact cobre boleto_url/linha/PIX.
  // ---------------------------------------------------------------------------
  app.post(
    '/api/billing/payment-dues/:id/boleto',
    {
      schema: {
        tags: ['Billing'],
        summary: 'Anexar boleto à parcela',
        description:
          'Anexa ou substitui o boleto de uma parcela de cobrança. ' +
          'Aceita dois modos:\n\n' +
          '**Modo upload** (`multipart/form-data`): enviar campo `file` (PDF, JPG ou PNG, máx 10 MB). ' +
          'O arquivo é enviado para a Meta WhatsApp Cloud API via `POST /{phone_number_id}/media` ' +
          'e o `media_id` retornado é persistido na parcela. Os bytes **não são armazenados** no banco (LGPD §14.2).\n\n' +
          '**Modo referência** (`application/json`): enviar `boletoUrl` (URL controlada/assinada ' +
          'do host cadastrado em `BOLETO_ALLOWED_HOSTS`), `digitableLine` e/ou `pixCopiaCola`.\n\n' +
          'Requer header `Idempotency-Key` (UUID). ' +
          'Gate: `billing.boleto.enabled` deve estar habilitado.',
        security: [{ bearerAuth: [] }],
        params: dueIdParamSchema,
        response: {
          200: BoletoResponseSchema,
        },
      },
      preHandler: [
        authorize({ permissions: ['billing:boleto:write'] }),
        featureGate('billing.boleto.enabled'),
      ],
    },
    attachBoletoController,
  );

  // ---------------------------------------------------------------------------
  // DELETE /api/billing/payment-dues/:id/boleto (F5-S13)
  //
  // Remove o boleto da parcela (todos os campos de boleto → null).
  // Idempotente: parcela sem boleto retorna estado atual sem erro.
  // Gate: billing.boleto.enabled.
  // RBAC: billing:boleto:write + city scope.
  //
  // LGPD §14.2: auditLog registra a remoção sem expor PII.
  //   Não emite outbox (remoção não tem downstream relevante em F5-S14).
  // ---------------------------------------------------------------------------
  app.delete(
    '/api/billing/payment-dues/:id/boleto',
    {
      schema: {
        tags: ['Billing'],
        summary: 'Remover boleto da parcela',
        description:
          'Remove o boleto anexado a uma parcela, limpando todos os campos de boleto. ' +
          'Operação idempotente: parcela sem boleto retorna o estado atual sem erro. ' +
          'Gate: `billing.boleto.enabled` deve estar habilitado.',
        security: [{ bearerAuth: [] }],
        params: dueIdParamSchema,
        response: {
          200: BoletoResponseSchema,
        },
      },
      preHandler: [
        authorize({ permissions: ['billing:boleto:write'] }),
        featureGate('billing.boleto.enabled'),
      ],
    },
    removeBoletoController,
  );

  // ---------------------------------------------------------------------------
  // GET /api/billing/rules
  // ---------------------------------------------------------------------------
  app.get(
    '/api/billing/rules',
    {
      schema: {
        tags: ['Billing'],
        summary: 'Listar regras de cobranca',
        description: 'Lista as regras de escalonamento da organizacao.',
        security: [{ bearerAuth: [] }],
        response: {
          200: CollectionRulesListResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['billing:read'] })],
    },
    listRulesController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/billing/rules
  // ---------------------------------------------------------------------------
  app.post(
    '/api/billing/rules',
    {
      schema: {
        tags: ['Billing'],
        summary: 'Criar regra de cobranca',
        description: 'Cria uma nova regra de cobranca.',
        security: [{ bearerAuth: [] }],
        body: CollectionRuleCreateSchema,
        response: {
          201: CollectionRuleResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['billing:write'] })],
    },
    createRuleController,
  );

  // ---------------------------------------------------------------------------
  // PATCH /api/billing/rules/:id
  // ---------------------------------------------------------------------------
  app.patch(
    '/api/billing/rules/:id',
    {
      schema: {
        tags: ['Billing'],
        summary: 'Atualizar regra de cobranca',
        description: 'Atualiza uma regra de cobranca existente.',
        security: [{ bearerAuth: [] }],
        params: ruleIdParamSchema,
        body: CollectionRuleUpdateSchema,
        response: {
          200: CollectionRuleResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['billing:write'] })],
    },
    updateRuleController,
  );

  // ---------------------------------------------------------------------------
  // GET /api/billing/jobs
  // ---------------------------------------------------------------------------
  app.get(
    '/api/billing/jobs',
    {
      schema: {
        tags: ['Billing'],
        summary: 'Listar jobs de cobranca',
        description: 'Lista os jobs de cobranca com seu status.',
        security: [{ bearerAuth: [] }],
        querystring: CollectionJobsListQuerySchema,
        response: {
          200: CollectionJobsListResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['billing:read'] })],
    },
    listJobsController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/billing/jobs/:id/cancel
  // ---------------------------------------------------------------------------
  app.post(
    '/api/billing/jobs/:id/cancel',
    {
      schema: {
        tags: ['Billing'],
        summary: 'Cancelar job de cobranca',
        description: 'Cancela um job de cobranca pendente.',
        security: [{ bearerAuth: [] }],
        params: jobIdParamSchema,
        response: {
          200: CollectionJobResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['billing:cancel_job'] })],
    },
    cancelJobController,
  );
};
