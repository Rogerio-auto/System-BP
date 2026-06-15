// =============================================================================
// customers/routes.ts — Rotas do módulo customers (F17-S07).
//
// Rotas:
//   GET /api/customers/:id/overview  (contracts:read)
//
// RBAC:
//   - contracts:read → visão consolidada do cliente (contratos, parcelas, SPC).
//
// City-scope: filtrado via customers → leads (primary_lead_id → city_id).
//   gestor_regional só acessa clientes de sua(s) cidade(s).
//
// LGPD (doc 17 §8.1):
//   - name do cliente é PII (vem do lead). Exposto apenas a usuários autenticados
//     com permissão contracts:read — base legal: execução de contrato (Art. 7º V LGPD).
//   - Nenhum CPF/document_number é retornado neste endpoint.
//   - spc_status é dado operacional de crédito; não é PII estrito.
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { authenticate } from '../auth/middlewares/authenticate.js';
import { authorize } from '../auth/middlewares/authorize.js';

import { getCustomerOverviewController } from './controller.js';
import { CustomerOverviewParamsSchema, CustomerOverviewResponseSchema } from './schemas.js';

export const customersRoutes: FastifyPluginAsyncZod = async (app) => {
  // Autenticação obrigatória em todas as rotas deste plugin
  app.addHook('preHandler', authenticate());

  // ---------------------------------------------------------------------------
  // GET /api/customers/:id/overview
  //
  // Retorna visão consolidada do cliente: dados do customer, contratos com
  // saúde de boletos e últimas 10 parcelas.
  //
  // City-scope: clientes de outra cidade → 404 (indistinguível de "não encontrado").
  // ---------------------------------------------------------------------------
  app.get(
    '/api/customers/:id/overview',
    {
      schema: {
        tags: ['Customers'],
        summary: 'Visão consolidada do cliente',
        description:
          'Retorna a visão consolidada de um cliente do Banco do Povo: ' +
          'dados cadastrais básicos (sem CPF), lista de contratos com saúde de boletos ' +
          'calculada por SQL agregado (sem N+1), e as últimas 10 parcelas do cliente ' +
          'ordenadas por data de vencimento descendente.\n\n' +
          'O campo `boleto_health` é calculado inline a partir das `payment_dues` de cada ' +
          'contrato — `null` quando o contrato não possui parcelas registradas.\n\n' +
          'Respeita escopo de cidade: gestores regionais só acessam clientes de ' +
          'suas cidades; clientes fora do escopo retornam 404.\n\n' +
          'Requer permissão `contracts:read`.',
        security: [{ bearerAuth: [] }],
        params: CustomerOverviewParamsSchema,
        response: {
          200: CustomerOverviewResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['contracts:read'] })],
    },
    getCustomerOverviewController,
  );
};
