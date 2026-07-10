// =============================================================================
// ai-actions/routes.ts — Rotas do painel "IA nas últimas 24h" (F25-S06).
//
// Doc normativo: docs/22-agente-interno-acoes.md §8.B/§11.
//
// Permissões (seed.ts — F25-S02):
//   - ai_actions:read   → ver o painel de ações do agente de IA no funil.
//   - ai_actions:revert → reverter uma ação autônoma da IA.
//
// City-scope: applyCityScope aplicado no repository — gestor_regional só
// vê/reverte ações de leads das cidades sob seu escopo (doc 10 §3.4).
//
// Sem feature flag: são ferramentas de supervisão humana — devem funcionar
// mesmo com internal_assistant.actions.enabled desligado (kill-switch da IA
// não deve impedir o gestor de revisar o que já aconteceu).
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { authenticate } from '../auth/middlewares/authenticate.js';
import { authorize } from '../auth/middlewares/authorize.js';

import { listAiActionsController, revertAiActionController } from './controller.js';
import {
  AiActionIdParamSchema,
  AiActionRevertResponseSchema,
  AiActionsListQuerySchema,
  AiActionsListResponseSchema,
} from './schemas.js';

const READ_PERMS: [string, ...string[]] = ['ai_actions:read'];
const REVERT_PERMS: [string, ...string[]] = ['ai_actions:revert'];

export const aiActionsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', authenticate());

  // ---------------------------------------------------------------------------
  // GET /api/ai-actions — painel "IA nas últimas 24h"
  // ---------------------------------------------------------------------------
  app.get(
    '/api/ai-actions',
    {
      schema: {
        tags: ['AI Actions'],
        summary: 'Ações da IA no funil (painel "IA nas últimas 24h")',
        description:
          'Lista as ações autônomas do agente de IA (qualificações, estagnações e abandonos) ' +
          'registradas no funil dentro da janela informada (24h, 7d ou 30d). City-scoped: cada ' +
          'gestor só vê ações de leads das cidades sob seu escopo. Nomes de lead são exibidos ' +
          'mascarados (LGPD). Ações de qualificação e abandono podem ser revertidas via ' +
          'POST /api/ai-actions/:id/revert.',
        security: [{ bearerAuth: [] }],
        querystring: AiActionsListQuerySchema,
        response: { 200: AiActionsListResponseSchema },
      },
      preHandler: [authorize({ permissions: READ_PERMS })],
    },
    listAiActionsController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/ai-actions/:id/revert — reversão em 1 clique
  // ---------------------------------------------------------------------------
  app.post(
    '/api/ai-actions/:id/revert',
    {
      schema: {
        tags: ['AI Actions'],
        summary: 'Reverte uma ação autônoma da IA',
        description:
          'Reverte uma qualificação ou um abandono automático realizado pela IA, devolvendo o ' +
          'lead a um estado não-terminal coerente (doc 22 §11). Idempotente: repetir a chamada ' +
          'após uma reversão bem-sucedida retorna o mesmo resultado, sem duplicar auditoria ou ' +
          'eventos. O histórico da ação original é preservado (append-only) — a reversão é ' +
          'registrada como um novo evento, nunca apaga o anterior. City-scoped.',
        security: [{ bearerAuth: [] }],
        params: AiActionIdParamSchema,
        response: { 200: AiActionRevertResponseSchema },
      },
      preHandler: [authorize({ permissions: REVERT_PERMS })],
    },
    revertAiActionController,
  );
};
