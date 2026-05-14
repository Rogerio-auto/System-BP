// =============================================================================
// simulations/routes.ts — Rotas do módulo de simulações de crédito (F2-S04).
//
// Endpoint:
//   POST /api/simulations — cria simulação para um lead via UI.
//
// Segurança:
//   - authenticate(): JWT obrigatório.
//   - authorize({ permissions: ['simulations:create'] }): RBAC.
//   - featureGate('credit_simulation.enabled'): feature flag.
//   - City scope do lead validado na service layer.
//
// Prefixo: /api/simulations
//
// LGPD: body contém apenas IDs + números (sem PII bruta).
//   pino.redact cobre body.* como medida extra no app.ts.
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { featureGate } from '../../plugins/featureGate.js';
import { authenticate } from '../auth/middlewares/authenticate.js';
import { authorize } from '../auth/middlewares/authorize.js';

import { createSimulationController } from './controller.js';
import { SimulationCreateSchema, SimulationResponseSchema } from './schemas.js';

const CREATE_PERMS: [string, ...string[]] = ['simulations:create'];

export const simulationsRoutes: FastifyPluginAsyncZod = async (app) => {
  // Autenticação obrigatória em todas as rotas deste plugin
  app.addHook('preHandler', authenticate());

  // ---------------------------------------------------------------------------
  // POST /api/simulations — cria simulação via UI
  //
  // Fluxo:
  //   1. authenticate() valida JWT → popula request.user.
  //   2. authorize() verifica simulations:create.
  //   3. featureGate() bloqueia se credit_simulation.enabled=false → 403.
  //   4. Controller → service:
  //      a. city scope check (403 se fora).
  //      b. produto ativo (404 se inexistente/inativo).
  //      c. regra ativa para cidade (409 se nenhuma).
  //      d. validação amount/termMonths (422 se fora dos limites).
  //      e. cálculo Price ou SAC.
  //      f. transação: INSERT + UPDATE leads/cards + outbox + audit.
  //   5. Retorna 201 com simulação completa.
  // ---------------------------------------------------------------------------
  app.post(
    '/api/simulations',
    {
      schema: {
        body: SimulationCreateSchema,
        response: {
          201: SimulationResponseSchema,
        },
      },
      preHandler: [
        authorize({ permissions: CREATE_PERMS }),
        featureGate('credit_simulation.enabled'),
      ],
    },
    createSimulationController,
  );
};
