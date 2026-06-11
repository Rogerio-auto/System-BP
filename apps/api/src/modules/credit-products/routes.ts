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

import { featureGate } from '../../plugins/featureGate.js';
import { authenticate } from '../auth/middlewares/authenticate.js';
import { authorize } from '../auth/middlewares/authorize.js';

import {
  activateRuleVersionController,
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
  productRuleVersionParamSchema,
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
        tags: ['Credit Products'],
        summary: 'Listar produtos',
        description: 'Lista produtos de credito ativos.',
        security: [{ bearerAuth: [] }],
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
        tags: ['Credit Products'],
        summary: 'Criar produto',
        description: 'Cria um novo produto de credito.',
        security: [{ bearerAuth: [] }],
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
        tags: ['Credit Products'],
        summary: 'Obter produto',
        description: 'Retorna detalhes de um produto pelo ID.',
        security: [{ bearerAuth: [] }],
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
        tags: ['Credit Products'],
        summary: 'Atualizar produto',
        description: 'Atualiza dados de um produto de credito.',
        security: [{ bearerAuth: [] }],
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
        tags: ['Credit Products'],
        summary: 'Remover produto',
        description: 'Remove (soft-delete) um produto de credito.',
        security: [{ bearerAuth: [] }],
        params: productIdParamSchema,
        response: { 204: { description: 'Sem conteúdo.' } },
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
        tags: ['Credit Products'],
        summary: 'Criar regra',
        description: 'Adiciona uma nova versao de regra a um produto.',
        security: [{ bearerAuth: [] }],
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
  // POST /api/credit-products/:id/rules/:version/activate — usar/ativar versão
  // Clona a versão escolhida como nova versão ativa (D6). Feature flag gate.
  // ---------------------------------------------------------------------------
  app.post(
    '/api/credit-products/:id/rules/:version/activate',
    {
      schema: {
        tags: ['Credit Products'],
        summary: 'Ativar versão de regra',
        description:
          'Define a versão de regra escolhida como vigente, clonando-a numa nova versão ativa.',
        security: [{ bearerAuth: [] }],
        params: productRuleVersionParamSchema,
        response: {
          200: CreditProductRuleResponseSchema,
        },
      },
      preHandler: [
        authorize({ permissions: WRITE_PERMS }),
        featureGate('credit_simulation.enabled'),
      ],
    },
    activateRuleVersionController,
  );

  // ---------------------------------------------------------------------------
  // GET /api/credit-products/:id/rules — timeline de regras
  // Feature flag gate: credit_simulation.enabled
  // ---------------------------------------------------------------------------
  app.get(
    '/api/credit-products/:id/rules',
    {
      schema: {
        tags: ['Credit Products'],
        summary: 'Listar regras',
        description: 'Lista as regras versionadas de um produto.',
        security: [{ bearerAuth: [] }],
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
