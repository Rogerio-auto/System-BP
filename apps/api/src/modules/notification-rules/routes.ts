// =============================================================================
// notification-rules/routes.ts — Rotas do módulo de regras de notificação (F24-S05).
//
// Endpoints:
//   GET    /api/notification-rules         — lista paginada (+ filtros)
//   POST   /api/notification-rules         — cria regra (idempotente via Idempotency-Key)
//   GET    /api/notification-rules/catalog — expõe TRIGGER_CATALOG para dropdown
//   GET    /api/notification-rules/:id     — detalhe
//   PATCH  /api/notification-rules/:id     — atualização parcial
//   DELETE /api/notification-rules/:id     — remoção
//   POST   /api/notification-rules/:id/test — preview de destinatários + render (sem enviar)
//
// RBAC: notifications:manage em todas as rotas.
// Feature flag: notifications.rules.enabled.
// Autenticação: authenticate() via addHook preHandler no plugin.
//
// Idempotência no POST via header Idempotency-Key (UUID).
//
// LGPD §14.2: nenhum PII bruto exposto neste módulo — templates são config operacional.
// =============================================================================
import {
  notificationRuleCreateSchema,
  notificationRuleListResponseSchema,
  notificationRuleResponseSchema,
  notificationRuleTestResponseSchema,
  notificationRuleUpdateSchema,
  TRIGGER_CATALOG,
} from '@elemento/shared-schemas';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { featureGate } from '../../plugins/featureGate.js';
import { authenticate } from '../auth/middlewares/authenticate.js';
import { authorize } from '../auth/middlewares/authorize.js';

import {
  createRuleController,
  deleteRuleController,
  getCatalogController,
  getRuleController,
  listRulesController,
  testRuleController,
  updateRuleController,
} from './controller.js';

// ---------------------------------------------------------------------------
// Schemas locais de params/query
// ---------------------------------------------------------------------------

export const ruleIdParamSchema = z.object({
  id: z.string().uuid().describe('UUID da regra de notificação'),
});

export type RuleIdParam = z.infer<typeof ruleIdParamSchema>;

export const listRulesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  per_page: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional().describe('Filtro por nome ou trigger_key'),
  enabled: z
    .string()
    .optional()
    .transform((v) => {
      if (v === 'true') return true;
      if (v === 'false') return false;
      return undefined;
    })
    .describe('Filtrar por enabled (true|false)'),
});

export type ListRulesQuery = z.infer<typeof listRulesQuerySchema>;

export type CreateRuleBody = z.infer<typeof notificationRuleCreateSchema>;
export type UpdateRuleBody = z.infer<typeof notificationRuleUpdateSchema>;

// ---------------------------------------------------------------------------
// Schema de resposta do catálogo
// ---------------------------------------------------------------------------

const catalogResponseSchema = z.object({
  data: z.array(
    z.object({
      key: z.string(),
      kind: z.enum(['event', 'stage_inactivity']),
      category: z.string(),
      entityType: z.string(),
      placeholders: z.array(z.string()),
      timestampSource: z.string().optional(),
    }),
  ),
});

// ---------------------------------------------------------------------------
// Permissão canônica
// ---------------------------------------------------------------------------

const MANAGE_PERMS: [string, ...string[]] = ['notifications:manage'];

// ---------------------------------------------------------------------------
// Plugin de rotas
// ---------------------------------------------------------------------------

export const notificationRulesRoutes: FastifyPluginAsyncZod = async (app) => {
  // Autenticação obrigatória em todas as rotas
  app.addHook('preHandler', authenticate());

  // ---------------------------------------------------------------------------
  // GET /api/notification-rules/catalog
  // Deve ser registrado ANTES de /:id para não capturar "catalog" como UUID.
  // ---------------------------------------------------------------------------
  app.get(
    '/api/notification-rules/catalog',
    {
      schema: {
        tags: ['Notification Rules'],
        summary: 'Catálogo de gatilhos',
        description:
          'Retorna o catálogo completo de gatilhos de notificação disponíveis para configuração de regras. ' +
          'Cada entrada declara a chave do gatilho, tipo (event | stage_inactivity), categoria, ' +
          'tipo de entidade e placeholders disponíveis para templates. ' +
          'Use este endpoint para popular dropdowns de criação e edição de regras.',
        security: [{ bearerAuth: [] }],
        response: {
          200: catalogResponseSchema,
        },
      },
      preHandler: [
        authorize({ permissions: MANAGE_PERMS }),
        featureGate('notifications.rules.enabled'),
      ],
    },
    getCatalogController,
  );

  // ---------------------------------------------------------------------------
  // GET /api/notification-rules
  // ---------------------------------------------------------------------------
  app.get(
    '/api/notification-rules',
    {
      schema: {
        tags: ['Notification Rules'],
        summary: 'Listar regras de notificação',
        description:
          'Lista as regras de notificação configuradas para a organização, com paginação e filtros. ' +
          'Cada regra define quando e para quem gerar notificações com base em gatilhos de domínio. ' +
          'Restrito a usuários com permissão `notifications:manage`.',
        security: [{ bearerAuth: [] }],
        querystring: listRulesQuerySchema,
        response: {
          200: notificationRuleListResponseSchema,
        },
      },
      preHandler: [
        authorize({ permissions: MANAGE_PERMS }),
        featureGate('notifications.rules.enabled'),
      ],
    },
    listRulesController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/notification-rules
  // ---------------------------------------------------------------------------
  app.post(
    '/api/notification-rules',
    {
      schema: {
        tags: ['Notification Rules'],
        summary: 'Criar regra de notificação',
        description:
          'Cria uma nova regra de notificação para a organização. ' +
          'A regra nasce desabilitada (`enabled: false`) e deve ser ativada explicitamente. ' +
          'A `category` é derivada automaticamente do catálogo de gatilhos — não enviar no body. ' +
          'Suporta header `Idempotency-Key` (UUID) para evitar criação duplicada em retry.',
        security: [{ bearerAuth: [] }],
        body: notificationRuleCreateSchema,
        response: {
          201: notificationRuleResponseSchema,
        },
      },
      preHandler: [
        authorize({ permissions: MANAGE_PERMS }),
        featureGate('notifications.rules.enabled'),
      ],
    },
    createRuleController,
  );

  // ---------------------------------------------------------------------------
  // GET /api/notification-rules/:id
  // ---------------------------------------------------------------------------
  app.get(
    '/api/notification-rules/:id',
    {
      schema: {
        tags: ['Notification Rules'],
        summary: 'Obter regra de notificação',
        description:
          'Retorna os detalhes de uma regra de notificação pelo ID. ' +
          'Os campos `trigger_kind`, `category` e `entity_type` são denormalizados do ' +
          'catálogo de gatilhos no momento da leitura. ' +
          '`city_scope` é extraído de `filters` jsonb (persistência interna).',
        security: [{ bearerAuth: [] }],
        params: ruleIdParamSchema,
        response: {
          200: notificationRuleResponseSchema,
        },
      },
      preHandler: [
        authorize({ permissions: MANAGE_PERMS }),
        featureGate('notifications.rules.enabled'),
      ],
    },
    getRuleController,
  );

  // ---------------------------------------------------------------------------
  // PATCH /api/notification-rules/:id
  // ---------------------------------------------------------------------------
  app.patch(
    '/api/notification-rules/:id',
    {
      schema: {
        tags: ['Notification Rules'],
        summary: 'Atualizar regra de notificação',
        description:
          'Atualiza parcialmente uma regra de notificação. Todos os campos são opcionais. ' +
          'Se `title_template` ou `body_template` forem atualizados sem `trigger_key`, ' +
          'os placeholders são validados contra o gatilho atual da regra (B-06). ' +
          'Se `trigger_key` for alterado, `category` é re-derivada do catálogo automaticamente.',
        security: [{ bearerAuth: [] }],
        params: ruleIdParamSchema,
        body: notificationRuleUpdateSchema,
        response: {
          200: notificationRuleResponseSchema,
        },
      },
      preHandler: [
        authorize({ permissions: MANAGE_PERMS }),
        featureGate('notifications.rules.enabled'),
      ],
    },
    updateRuleController,
  );

  // ---------------------------------------------------------------------------
  // DELETE /api/notification-rules/:id
  // ---------------------------------------------------------------------------
  app.delete(
    '/api/notification-rules/:id',
    {
      schema: {
        tags: ['Notification Rules'],
        summary: 'Remover regra de notificação',
        description:
          'Remove permanentemente uma regra de notificação. ' +
          'A operação é auditada. Regras em uso por workers em andamento ' +
          'serão ignoradas no próximo ciclo de avaliação.',
        security: [{ bearerAuth: [] }],
        params: ruleIdParamSchema,
        response: {
          204: { description: 'Regra removida com sucesso.' },
        },
      },
      preHandler: [
        authorize({ permissions: MANAGE_PERMS }),
        featureGate('notifications.rules.enabled'),
      ],
    },
    deleteRuleController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/notification-rules/:id/test
  // ---------------------------------------------------------------------------
  app.post(
    '/api/notification-rules/:id/test',
    {
      schema: {
        tags: ['Notification Rules'],
        summary: 'Preview de destinatários e template',
        description:
          'Resolve os destinatários reais da regra e renderiza os templates com dados de exemplo, ' +
          'sem disparar notificações reais. ' +
          'Útil para validar a configuração antes de ativar a regra. ' +
          'O contexto de cidade é global (preview sem evento específico). ' +
          'Os `display_name` dos destinatários são dados de colaborador (Art. 7°, IX LGPD).',
        security: [{ bearerAuth: [] }],
        params: ruleIdParamSchema,
        response: {
          200: notificationRuleTestResponseSchema,
        },
      },
      preHandler: [
        authorize({ permissions: MANAGE_PERMS }),
        featureGate('notifications.rules.enabled'),
      ],
    },
    testRuleController,
  );
};

// Re-exportar TRIGGER_CATALOG para uso no getCatalogController
export { TRIGGER_CATALOG };
