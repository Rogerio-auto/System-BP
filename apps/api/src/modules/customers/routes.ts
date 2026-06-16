// =============================================================================
// customers/routes.ts — Rotas do módulo customers (F17-S07 + F19-S03).
//
// Rotas:
//   GET  /api/customers/:id/overview           (contracts:read)
//   POST /api/customers/:id/law-firm-referral  (law_firms:referral)
//
// RBAC:
//   - contracts:read        → visão consolidada do cliente (contratos, parcelas, SPC).
//   - law_firms:referral    → encaminhar cliente a escritório de advocacia.
//
// City-scope: filtrado via customers → leads (primary_lead_id → city_id).
//   gestor_regional só acessa clientes de sua(s) cidade(s).
//
// LGPD (doc 17 §8.1 + §12):
//   - name do cliente é PII (vem do lead). Exposto apenas a usuários autenticados
//     com permissão contracts:read — base legal: execução de contrato (Art. 7º V LGPD).
//   - Nenhum CPF/document_number é retornado neste endpoint.
//   - spc_status é dado operacional de crédito; não é PII estrito.
//   - Encaminhamento advocacia (§12): base legal execução de contrato/cobrança judicial.
//     Evento outbox sem PII bruta do customer.
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { authenticate } from '../auth/middlewares/authenticate.js';
import { authorize } from '../auth/middlewares/authorize.js';

import { getCustomerOverviewController } from './controller.js';
import { postCreateReferralController } from './law-firm-referral.controller.js';
import {
  CreateReferralBodySchema,
  CreateReferralResponseSchema,
  CustomerReferralParamsSchema,
} from './law-firm-referral.schemas.js';
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

  // ---------------------------------------------------------------------------
  // POST /api/customers/:id/law-firm-referral (F19-S03)
  //
  // Encaminha um cliente a um escritório de advocacia parceiro (canal humano).
  //
  // Regras de negócio:
  //   - Feature flag law_firm.referral.enabled → 403 FEATURE_DISABLED se off.
  //   - Cooldown de 7 dias → 409 LAW_FIRM_COOLDOWN se bloqueado.
  //   - Customer e law_firm devem pertencer à org → 404 se não encontrado.
  //   - Emite evento outbox 'customer.law_firm_referred' (sem PII do customer).
  //   - Registra em audit_logs.
  //
  // LGPD (doc 17 §12):
  //   Compartilhamento com escritório de advocacia = base legal execução de contrato
  //   (cobrança judicial). Evento outbox carrega apenas IDs opacos.
  // ---------------------------------------------------------------------------
  app.post(
    '/api/customers/:id/law-firm-referral',
    {
      schema: {
        tags: ['Customers'],
        summary: 'Encaminhar cliente a escritório de advocacia',
        description:
          'Registra o encaminhamento de um cliente inadimplente a um escritório de advocacia ' +
          'parceiro para cobrança judicial.\n\n' +
          'Aplica cooldown de 7 dias: novo encaminhamento do mesmo cliente antes do prazo ' +
          'retorna 409 `LAW_FIRM_COOLDOWN` com `cooldown_until`.\n\n' +
          'A feature flag `law_firm.referral.enabled` deve estar habilitada — ' +
          '403 `FEATURE_DISABLED` se desligada.\n\n' +
          'Emite evento `customer.law_firm_referred` no outbox para que o worker de ' +
          'notificação envie WhatsApp ao escritório (sem PII do cliente no payload).\n\n' +
          'Requer permissão `law_firms:referral`.\n\n' +
          'Base legal LGPD: Art. 7º V — execução de contrato (cobrança judicial).',
        security: [{ bearerAuth: [] }],
        params: CustomerReferralParamsSchema,
        body: CreateReferralBodySchema,
        response: {
          201: CreateReferralResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['law_firms:referral'] })],
    },
    postCreateReferralController,
  );
};
