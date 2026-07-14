// =============================================================================
// assistant-escalation/routes.ts — Rota de POST /api/assistant/escalate (F6-S30).
//
// Permissão (migration 0088): assistant:escalate — concedida a todos os 6
// roles operacionais (admin, gestor_geral, gestor_regional, agente, operador,
// leitura). Qualquer operador com acesso ao lead pode escalar; o gate real é
// a combinação permissão + escopo de cidade do lead (404 fora do escopo,
// aplicado na service layer).
//
// Human-in-the-loop (doc 22): endpoint chamado apenas por usuário humano
// autenticado — a IA nunca invoca esta rota diretamente.
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { authenticate } from '../auth/middlewares/authenticate.js';
import { authorize } from '../auth/middlewares/authorize.js';

import { escalateLeadController } from './controller.js';
import { EscalateLeadRequestSchema, EscalateLeadResponseSchema } from './schemas.js';

const ESCALATE_PERMS: [string, ...string[]] = ['assistant:escalate'];

export const assistantEscalationRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', authenticate());

  // ---------------------------------------------------------------------------
  // POST /api/assistant/escalate — escalar lead ao Departamento de Crédito
  // ---------------------------------------------------------------------------
  app.post(
    '/api/assistant/escalate',
    {
      schema: {
        tags: ['Assistant'],
        summary: 'Escala um lead ao Departamento de Crédito',
        description:
          'Permite que um operador, a partir do copiloto interno, notifique os analistas de ' +
          'crédito responsáveis sobre um lead — fluxo human-in-the-loop: a IA nunca escala ' +
          'sozinha, apenas oferece a ação; a confirmação é sempre de um usuário humano ' +
          'autenticado. Os destinatários são resolvidos via ' +
          '`organizations.settings.credit_escalation` (cidade + roles configurados), com ' +
          'fallback para os roles que detêm `credit_analyses:decide` quando a organização não ' +
          'tem essa configuração. O lead deve estar dentro do escopo de cidade do usuário — ' +
          'fora do escopo retorna 404, sem vazar a existência do recurso. Idempotente: repetir ' +
          'a chamada para o mesmo lead dentro de 1 hora retorna a mesma escalação ' +
          '(`already_escalated: true`), sem duplicar notificações ou auditoria. Cada ' +
          'destinatário é notificado in-app e por email (quando o canal de email estiver ' +
          'habilitado). Sem nenhum destinatário configurado, retorna 409.',
        security: [{ bearerAuth: [] }],
        body: EscalateLeadRequestSchema,
        response: { 200: EscalateLeadResponseSchema },
      },
      preHandler: [authorize({ permissions: ESCALATE_PERMS })],
    },
    escalateLeadController,
  );
};
