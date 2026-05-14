// =============================================================================
// credit-products/routes.ts — Rotas do módulo de produtos de crédito (F2-S03).
//
// Todos os endpoints exigem authenticate() + authorize().
//
// Permissões:
//   - Leitura: credit_products:read
//   - Escrita: credit_products:write
//
// Feature flag:
//   - Endpoints de regra (POST/GET /rules) exigem credit_simulation.enabled.
//   - Endpoints de produto (CRUD) funcionam independente da flag.
//
// Prefixo: /api/credit-products
//
// LGPD: nenhum campo sensível neste módulo.
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { featureGate } from '../../plugins/featureGate.js';
import { authenticate } from '../auth/middlewares/authenticate.js';
import { authorize } from '../auth/middlewares/authorize.js';

import {
  createProductController,
  deleteProductController,
  getProductController,
  listProductsController,
  listRulesController,
  publishRuleController,
  updateProductController,
} from './controller.js';
import {
  CreditProductCreateSchema,
  CreditProductDetailResponseSchema,
  CreditProductListQuerySchema,
  CreditProductListResponseSchema,
  CreditProductResponseSchema,
  CreditProductRuleCreateSchema,
  CreditProductRuleResponseSchema,
  CreditProductRulesListResponseSchema,
  CreditProductUpdateSchema,
  productIdParamSchema,
} from './schemas.js';

const READ_PERMS: [string, ...string[]] = ['credit_products:read'];
const WRITE_PERMS: [string, ...string[]] = ['credit_products:write'];

export const creditProductsRoutes: FastifyPluginAsyncZod = async (app) => {
  // Autenticação obrigatória em todas as rotas deste plugin
  app.addHook('preHandler', authenticate());

  // ---------------------------------------------------------------------------
  // GET /api/credit-products — lista com última regra ativa
  // ---------------------------------------------------------------------------
  app.get(
    '/api/credit-products',
    {
      schema: {
        querystring: CreditProductListQuerySchema,
        response: {
          200: CreditProductListResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: READ_PERMS })],
    },
    listProductsController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/credit-products — cria produto
  // ---------------------------------------------------------------------------
  app.post(
    '/api/credit-products',
    {
      schema: {
        body: CreditProductCreateSchema,
        response: {
          201: CreditProductResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: WRITE_PERMS })],
    },
    createProductController,
  );

  // ---------------------------------------------------------------------------
  // GET /api/credit-products/:id — detalhe + timeline de regras
  // ---------------------------------------------------------------------------
  app.get(
    '/api/credit-products/:id',
    {
      schema: {
        params: productIdParamSchema,
        response: {
          200: CreditProductDetailResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: READ_PERMS })],
    },
    getProductController,
  );

  // ---------------------------------------------------------------------------
  // PATCH /api/credit-products/:id — atualiza name/description/is_active
  // ---------------------------------------------------------------------------
  app.patch(
    '/api/credit-products/:id',
    {
      schema: {
        params: productIdParamSchema,
        body: CreditProductUpdateSchema,
        response: {
          200: CreditProductResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: WRITE_PERMS })],
    },
    updateProductController,
  );

  // ---------------------------------------------------------------------------
  // DELETE /api/credit-products/:id — soft-delete (bloqueado se simulações <90d)
  // ---------------------------------------------------------------------------
  app.delete(
    '/api/credit-products/:id',
    {
      schema: {
        params: productIdParamSchema,
        response: {
          204: z.void(),
        },
      },
      preHandler: [authorize({ permissions: WRITE_PERMS })],
    },
    deleteProductController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/credit-products/:id/rules — publica nova versão de regra
  // Feature flag gate: credit_simulation.enabled
  // ---------------------------------------------------------------------------
  app.post(
    '/api/credit-products/:id/rules',
    {
      schema: {
        params: productIdParamSchema,
        body: CreditProductRuleCreateSchema,
        response: {
          201: CreditProductRuleResponseSchema,
        },
      },
      preHandler: [
        authorize({ permissions: WRITE_PERMS }),
        featureGate('credit_simulation.enabled'),
      ],
    },
    publishRuleController,
  );

  // ---------------------------------------------------------------------------
  // GET /api/credit-products/:id/rules — timeline de regras
  // Feature flag gate: credit_simulation.enabled
  // ---------------------------------------------------------------------------
  app.get(
    '/api/credit-products/:id/rules',
    {
      schema: {
        params: productIdParamSchema,
        response: {
          200: CreditProductRulesListResponseSchema,
        },
      },
      preHandler: [
        authorize({ permissions: READ_PERMS }),
        featureGate('credit_simulation.enabled'),
      ],
    },
    listRulesController,
  );
};
