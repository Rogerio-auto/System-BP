// =============================================================================
// modules/imports/routes.ts — Rotas de importação CSV/XLSX (F1-S17).
//
// Todas as rotas exigem:
//   - authenticate(): valida JWT e popula request.user
//   - featureGate('crm.import.enabled'): bloqueia se flag off
//   - authorize(opts): verifica permissão RBAC por rota
//
// Permissões:
//   - leads:write  — upload de leads
//   - leads:read   — preview, detalhe
//
// Storage: MVP usa filesystem local (tmp/imports/).
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { featureGate } from '../../plugins/featureGate.js';
import { authenticate } from '../auth/middlewares/authenticate.js';
import { authorize } from '../auth/middlewares/authorize.js';

import {
  cancelBatchController,
  confirmBatchController,
  getBatchController,
  previewBatchController,
  uploadLeadsController,
} from './controller.js';
import {
  BatchIdParamSchema,
  ImportBatchResponseSchema,
  PreviewQuerySchema,
  PreviewResponseSchema,
  UploadResponseSchema,
} from './schemas.js';

export const importsRoutes: FastifyPluginAsyncZod = async (app) => {
  // Autenticação obrigatória em todas as rotas deste plugin
  app.addHook('preHandler', authenticate());

  // ---------------------------------------------------------------------------
  // POST /api/imports/leads — upload de arquivo CSV/XLSX de leads
  // ---------------------------------------------------------------------------
  app.post(
    '/api/imports/leads',
    {
      schema: {
        response: {
          201: UploadResponseSchema,
          200: UploadResponseSchema,
        },
      },
      preHandler: [featureGate('crm.import.enabled'), authorize({ permissions: ['leads:write'] })],
    },
    uploadLeadsController,
  );

  // ---------------------------------------------------------------------------
  // GET /api/imports/:id — status do batch
  // ---------------------------------------------------------------------------
  app.get(
    '/api/imports/:id',
    {
      schema: {
        params: BatchIdParamSchema,
        response: {
          200: ImportBatchResponseSchema,
        },
      },
      preHandler: [featureGate('crm.import.enabled'), authorize({ permissions: ['leads:read'] })],
    },
    getBatchController,
  );

  // ---------------------------------------------------------------------------
  // GET /api/imports/:id/preview — linhas com paginação
  // ---------------------------------------------------------------------------
  app.get(
    '/api/imports/:id/preview',
    {
      schema: {
        params: BatchIdParamSchema,
        querystring: PreviewQuerySchema,
        response: {
          200: PreviewResponseSchema,
        },
      },
      preHandler: [featureGate('crm.import.enabled'), authorize({ permissions: ['leads:read'] })],
    },
    previewBatchController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/imports/:id/confirm — confirmar batch para processamento
  // ---------------------------------------------------------------------------
  app.post(
    '/api/imports/:id/confirm',
    {
      schema: {
        params: BatchIdParamSchema,
        response: {
          200: z.object({ id: z.string().uuid(), status: z.string(), message: z.string() }),
        },
      },
      preHandler: [featureGate('crm.import.enabled'), authorize({ permissions: ['leads:write'] })],
    },
    confirmBatchController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/imports/:id/cancel — cancelar batch antes de confirmar
  // ---------------------------------------------------------------------------
  app.post(
    '/api/imports/:id/cancel',
    {
      schema: {
        params: BatchIdParamSchema,
        response: {
          200: z.object({ id: z.string().uuid(), status: z.string(), message: z.string() }),
        },
      },
      preHandler: [featureGate('crm.import.enabled'), authorize({ permissions: ['leads:write'] })],
    },
    cancelBatchController,
  );
};
