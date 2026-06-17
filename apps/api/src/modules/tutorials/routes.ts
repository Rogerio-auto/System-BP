// =============================================================================
// tutorials/routes.ts — Rotas do módulo de tutoriais em vídeo (F12-S02).
//
// Norma de referência: docs/21-tutoriais-em-video.md §9 e §12.
//
// Rotas registradas:
//   GET  /api/help/tutorials              — lista de ativos (qualquer autenticado)
//   GET  /api/admin/tutorials             — lista completa (tutorials:manage)
//   POST /api/admin/tutorials             — criar (tutorials:manage, idempotente, auditado)
//   PATCH /api/admin/tutorials/:id        — editar (tutorials:manage, auditado)
//   DELETE /api/admin/tutorials/:id       — soft-delete (tutorials:manage, auditado)
//   GET  /api/admin/feature-keys          — catálogo (tutorials:manage)
//
// Feature flag:
//   Todas as rotas exigem que tutorials.enabled esteja ativa.
//   Usa featureGate() do plugins/featureGate.ts (padrão do projeto).
//
// RBAC:
//   Rotas /api/help/* requerem apenas authenticate() + featureGate().
//   Rotas /api/admin/tutorials* adicionam authorize({ permissions: ['tutorials:manage'] }).
//
// Idempotência (POST):
//   Feature_key é unique entre registros ativos. Se já existe tutorial ativo
//   com a mesma feature_key, a rota retorna 200 com o existente (idempotente).
//   O campo idempotencyKey do body é documentado como chave de controle do cliente.
//
// Auditoria:
//   POST/PATCH/DELETE registram em audit_logs dentro da mesma transação.
//   Tutorial é metadado de produto (sem PII) — before/after são seguros.
//
// LGPD:
//   Tutorials não contêm PII (ver norma §11). Respostas não expõem dados pessoais.
//   Respostas da rota pública omitem campos de auditoria interna.
// =============================================================================

import { FEATURE_KEYS } from '@elemento/shared-types';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { db } from '../../db/client.js';
import { auditLog } from '../../lib/audit.js';
import { featureGate } from '../../plugins/featureGate.js';
import { NotFoundError } from '../../shared/errors.js';
import { authenticate } from '../auth/middlewares/authenticate.js';
import { authorize } from '../auth/middlewares/authorize.js';

import {
  createTutorial,
  findActiveByFeatureKey,
  findTutorialById,
  listActiveTutorials,
  listAllTutorials,
  recordTutorialEvent,
  softDeleteTutorial,
  updateTutorial,
} from './repository.js';
import {
  CreateTutorialBodySchema,
  FeatureKeysResponseSchema,
  PatchTutorialBodySchema,
  RecordTutorialEventBodySchema,
  TutorialAdminItemSchema,
  TutorialIdParamSchema,
  TutorialsAdminListResponseSchema,
  TutorialsPublicListResponseSchema,
} from './schemas.js';

// ---------------------------------------------------------------------------
// Flag key canônica (norma §12)
// ---------------------------------------------------------------------------

const FLAG_KEY = 'tutorials.enabled';

// ---------------------------------------------------------------------------
// Rate-limit in-memory para POST /api/help/tutorial-events (F12-S07)
//
// Evita ingestão duplicada do mesmo evento (tutorialId:userId:eventType)
// em janela de 30 segundos. Mesmo padrão de help/routes.ts (doc_views).
//
// Limitação: single-instance. Migração futura: Redis SETNX.
// ---------------------------------------------------------------------------

const EVENT_RATE_LIMIT_MS = 30_000;
const EVENT_GC_INTERVAL = 1_000;
const EVENT_GC_STALE_MS = 60_000;

const eventRateMap = new Map<string, number>();
let eventInsertsSinceLastGc = 0;

/**
 * Verifica e aplica rate-limit para um evento de telemetria.
 * Retorna false se o evento já foi registrado nos últimos 30s (duplicata).
 * Retorna true se o evento deve ser persistido.
 */
function checkAndSetEventRateLimit(userId: string, tutorialId: string, eventType: string): boolean {
  const key = `${userId}:${tutorialId}:${eventType}`;
  const now = Date.now();
  const lastAt = eventRateMap.get(key);

  if (lastAt !== undefined && now - lastAt < EVENT_RATE_LIMIT_MS) {
    return false; // duplicata dentro da janela
  }

  eventRateMap.set(key, now);

  eventInsertsSinceLastGc++;
  if (eventInsertsSinceLastGc >= EVENT_GC_INTERVAL) {
    eventInsertsSinceLastGc = 0;
    const cutoff = now - EVENT_GC_STALE_MS;
    for (const [k, t] of eventRateMap.entries()) {
      if (t < cutoff) eventRateMap.delete(k);
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Plugin de rotas
// ---------------------------------------------------------------------------

export const tutorialsRoutes: FastifyPluginAsyncZod = async (app) => {
  // =========================================================================
  // GET /api/help/tutorials — Lista de tutoriais ativos (qualquer autenticado)
  // =========================================================================
  app.get(
    '/api/help/tutorials',
    {
      schema: {
        tags: ['Tutorials'],
        summary: 'Listar tutoriais ativos',
        description:
          'Retorna a lista de tutoriais em vídeo com status ativo (`is_active = true`).' +
          ' Usado pelo componente `<ContextualHelp>` para exibir o ⓘ ao lado das' +
          ' funcionalidades que possuem tutorial associado.\n\n' +
          'O resultado é cacheável pelo cliente (TanStack Query staleTime recomendado:' +
          ' 5 minutos). Não contém PII nem campos de auditoria interna.',
        security: [{ bearerAuth: [] }],
        response: {
          200: TutorialsPublicListResponseSchema,
        },
      },
      preHandler: [authenticate(), featureGate(FLAG_KEY)],
    },
    async (_request, reply) => {
      const data = await listActiveTutorials(db);
      return reply.status(200).send({ data });
    },
  );

  // =========================================================================
  // GET /api/admin/tutorials — Lista completa (inclui inativos)
  // =========================================================================
  app.get(
    '/api/admin/tutorials',
    {
      schema: {
        tags: ['Tutorials'],
        summary: 'Listar todos os tutoriais (admin)',
        description:
          'Retorna todos os tutoriais não-deletados, incluindo inativos (`is_active = false`).' +
          ' Usado pela tela administrativa `/admin/tutoriais` para gerenciar o catálogo.\n\n' +
          'Requer permissão `tutorials:manage`. Inclui campos de auditoria (created_at,' +
          ' updated_at, created_by) e o campo deleted_at (sempre null aqui, pois' +
          ' registros soft-deletados são filtrados).',
        security: [{ bearerAuth: [] }],
        response: {
          200: TutorialsAdminListResponseSchema,
        },
      },
      preHandler: [
        authenticate(),
        featureGate(FLAG_KEY),
        authorize({ permissions: ['tutorials:manage'] }),
      ],
    },
    async (_request, reply) => {
      const data = await listAllTutorials(db);
      return reply.status(200).send({ data });
    },
  );

  // =========================================================================
  // POST /api/admin/tutorials — Criar tutorial (idempotente)
  // =========================================================================
  app.post(
    '/api/admin/tutorials',
    {
      schema: {
        tags: ['Tutorials'],
        summary: 'Criar tutorial',
        description:
          'Cria um novo tutorial em vídeo vinculado a uma `feature_key` do catálogo.\n\n' +
          '**Idempotência:** se já existir um tutorial ativo com a mesma `feature_key`,' +
          ' a rota retorna `200` com o registro existente (sem criar duplicata).\n\n' +
          '**Validação de `feature_key`:** deve pertencer ao catálogo fechado em' +
          ' `@elemento/shared-types` — valores fora do catálogo retornam `422`.\n\n' +
          '**Auditoria:** a ação `tutorial.created` é registrada em `audit_logs`' +
          ' na mesma transação.\n\n' +
          'Requer permissão `tutorials:manage`.',
        security: [{ bearerAuth: [] }],
        body: CreateTutorialBodySchema,
        response: {
          200: TutorialAdminItemSchema,
          201: TutorialAdminItemSchema,
        },
      },
      preHandler: [
        authenticate(),
        featureGate(FLAG_KEY),
        authorize({ permissions: ['tutorials:manage'] }),
      ],
    },
    async (request, reply) => {
      if (!request.user) throw new NotFoundError('Usuário não encontrado no contexto');
      const user = request.user;
      const body = request.body;

      // Idempotência: verifica se já existe tutorial ativo para esta feature_key.
      // O unique index parcial no DB garante que não existam duplicatas,
      // mas verificamos antes para retornar o existente sem erro 409.
      const existing = await findActiveByFeatureKey(db, body.featureKey);
      if (existing !== null) {
        request.log.info(
          {
            event: 'tutorial.post_idempotent',
            feature_key: body.featureKey,
            existing_id: existing.id,
            user_id: user.id,
          },
          'POST idempotente: tutorial ativo já existe para esta feature_key',
        );
        return reply.status(200).send(existing);
      }

      // Criação dentro de transação com auditoria
      const created = await db.transaction(async (tx) => {
        // `as` justificado: db.transaction fornece uma transação Drizzle que é
        // estruturalmente compatível com AuditTx (tem insert().values()).
        const txAsDb = tx as unknown as typeof db;

        const tutorial = await createTutorial(txAsDb, body, user.id);

        await auditLog(
          // `as` justificado: tx é NodePgTransaction que satisfaz AuditTx estruturalmente.
          tx as Parameters<typeof auditLog>[0],
          {
            organizationId: user.organizationId,
            actor: {
              userId: user.id,
              role: 'user',
              ip: request.ip ?? null,
              userAgent: request.headers['user-agent'] ?? null,
            },
            action: 'tutorial.created',
            resource: { type: 'feature_tutorial', id: tutorial.id },
            after: {
              featureKey: tutorial.featureKey,
              title: tutorial.title,
              provider: tutorial.provider,
              isActive: tutorial.isActive,
            },
            correlationId: request.id,
          },
        );

        return tutorial;
      });

      return reply.status(201).send(created);
    },
  );

  // =========================================================================
  // PATCH /api/admin/tutorials/:id — Editar tutorial
  // =========================================================================
  app.patch(
    '/api/admin/tutorials/:id',
    {
      schema: {
        tags: ['Tutorials'],
        summary: 'Editar tutorial',
        description:
          'Atualiza campos de um tutorial existente. Apenas os campos enviados' +
          ' no body são alterados (PATCH parcial).\n\n' +
          'Para campos opcionalmente nulos (`videoHash`, `articleSlug`), enviar' +
          ' `null` remove o valor; omitir o campo mantém o valor atual.\n\n' +
          '**Auditoria:** a ação `tutorial.updated` é registrada em `audit_logs`' +
          ' na mesma transação com snapshot before/after.\n\n' +
          'Requer permissão `tutorials:manage`.',
        security: [{ bearerAuth: [] }],
        params: TutorialIdParamSchema,
        body: PatchTutorialBodySchema,
        response: {
          200: TutorialAdminItemSchema,
        },
      },
      preHandler: [
        authenticate(),
        featureGate(FLAG_KEY),
        authorize({ permissions: ['tutorials:manage'] }),
      ],
    },
    async (request, reply) => {
      if (!request.user) throw new NotFoundError('Usuário não encontrado no contexto');
      const user = request.user;
      const { id } = request.params;
      const body = request.body;

      // Busca o estado anterior para auditoria (before)
      const before = await findTutorialById(db, id);
      if (before === null) {
        throw new NotFoundError(`Tutorial ${id} não encontrado`);
      }

      // Atualização dentro de transação com auditoria
      const updated = await db.transaction(async (tx) => {
        const txAsDb = tx as unknown as typeof db;

        const result = await updateTutorial(txAsDb, id, body);
        if (result === null) {
          // Race condition: deletado entre o findTutorialById e o update
          throw new NotFoundError(`Tutorial ${id} não encontrado`);
        }

        await auditLog(tx as Parameters<typeof auditLog>[0], {
          organizationId: user.organizationId,
          actor: {
            userId: user.id,
            role: 'user',
            ip: request.ip ?? null,
            userAgent: request.headers['user-agent'] ?? null,
          },
          action: 'tutorial.updated',
          resource: { type: 'feature_tutorial', id },
          before: {
            featureKey: before.featureKey,
            title: before.title,
            provider: before.provider,
            isActive: before.isActive,
          },
          after: {
            featureKey: result.featureKey,
            title: result.title,
            provider: result.provider,
            isActive: result.isActive,
          },
          correlationId: request.id,
        });

        return result;
      });

      return reply.status(200).send(updated);
    },
  );

  // =========================================================================
  // DELETE /api/admin/tutorials/:id — Soft-delete
  // =========================================================================
  app.delete(
    '/api/admin/tutorials/:id',
    {
      schema: {
        tags: ['Tutorials'],
        summary: 'Remover tutorial (soft-delete)',
        description:
          'Realiza soft-delete do tutorial: preenche `deleted_at` e remove da listagem' +
          ' pública. O registro permanece na tabela para preservar histórico de auditoria.\n\n' +
          'Após a remoção, o componente `<ContextualHelp>` deixa de exibir o ⓘ para' +
          ' a `feature_key` correspondente. Um novo tutorial pode ser criado para a' +
          ' mesma `feature_key` posteriormente.\n\n' +
          '**Auditoria:** a ação `tutorial.deleted` é registrada em `audit_logs`.\n\n' +
          'Requer permissão `tutorials:manage`.',
        security: [{ bearerAuth: [] }],
        params: TutorialIdParamSchema,
        response: {
          204: { description: 'Tutorial removido com sucesso (soft-delete).' },
        },
      },
      preHandler: [
        authenticate(),
        featureGate(FLAG_KEY),
        authorize({ permissions: ['tutorials:manage'] }),
      ],
    },
    async (request, reply) => {
      if (!request.user) throw new NotFoundError('Usuário não encontrado no contexto');
      const user = request.user;
      const { id } = request.params;

      // Busca estado antes do delete para auditoria
      const before = await findTutorialById(db, id);
      if (before === null) {
        throw new NotFoundError(`Tutorial ${id} não encontrado`);
      }

      // Soft-delete dentro de transação com auditoria
      await db.transaction(async (tx) => {
        const txAsDb = tx as unknown as typeof db;
        const deleted = await softDeleteTutorial(txAsDb, id);

        if (!deleted) {
          // Race condition: já deletado por outro request
          throw new NotFoundError(`Tutorial ${id} não encontrado`);
        }

        await auditLog(tx as Parameters<typeof auditLog>[0], {
          organizationId: user.organizationId,
          actor: {
            userId: user.id,
            role: 'user',
            ip: request.ip ?? null,
            userAgent: request.headers['user-agent'] ?? null,
          },
          action: 'tutorial.deleted',
          resource: { type: 'feature_tutorial', id },
          before: {
            featureKey: before.featureKey,
            title: before.title,
            provider: before.provider,
            isActive: before.isActive,
          },
          correlationId: request.id,
        });
      });

      return reply.status(204).send();
    },
  );

  // =========================================================================
  // GET /api/admin/feature-keys — Catálogo de feature keys
  // =========================================================================
  app.get(
    '/api/admin/feature-keys',
    {
      schema: {
        tags: ['Tutorials'],
        summary: 'Listar feature keys disponíveis',
        description:
          'Retorna o catálogo fechado de `feature_key` válidas para tutoriais.\n\n' +
          'Usado pelo formulário administrativo para popular o dropdown de seleção' +
          ' de funcionalidade — o admin nunca digita a key manualmente.\n\n' +
          'O catálogo é definido em `@elemento/shared-types/featureKeys` e é a' +
          ' única fonte de verdade. Novas keys são adicionadas pelos devs conforme' +
          ' novas funcionalidades são entregues.\n\n' +
          'Requer permissão `tutorials:manage`.',
        security: [{ bearerAuth: [] }],
        response: {
          200: FeatureKeysResponseSchema,
        },
      },
      preHandler: [
        authenticate(),
        featureGate(FLAG_KEY),
        authorize({ permissions: ['tutorials:manage'] }),
      ],
    },
    async (_request, reply) => {
      // FEATURE_KEYS é readonly tuple — o cast para string[] é seguro para serialização.
      return reply.status(200).send({ data: FEATURE_KEYS as unknown as string[] });
    },
  );

  // =========================================================================
  // POST /api/help/tutorial-events — Ingestão de evento de adoção (F12-S07)
  //
  // Registra tutorial_opened (drawer aberto) ou tutorial_completed (>90% via
  // onEnded do player). Fire-and-forget: erros são silenciosos (204 mesmo em
  // rate-limit) para não degradar a UX do usuário.
  //
  // Rate-limit: 30s por (userId, tutorialId, eventType) — mesmo padrão dos
  // doc_views em help/routes.ts. Excedente retorna 204 silenciosamente.
  //
  // LGPD: sem PII — apenas UUID do tutorial e featureKey (não-identificador).
  //   userId é pseudônimo armazenado via FK com ON DELETE SET NULL.
  // =========================================================================
  app.post(
    '/api/help/tutorial-events',
    {
      schema: {
        tags: ['Tutorials'],
        summary: 'Registrar evento de adoção de tutorial',
        description:
          'Ingere um evento de telemetria de tutorial: `tutorial_opened` (drawer de ajuda aberto' +
          ' pelo usuário) ou `tutorial_completed` (vídeo assistido até o fim via `onEnded`' +
          ' do player, convencionalmente >90% do conteúdo).\n\n' +
          'Reusa a infraestrutura de telemetria de docs (F10-S12) com tabela própria' +
          ' `tutorial_events` (sem PII além do UUID do usuário).\n\n' +
          '**Rate-limit:** o mesmo evento `(tutorialId, eventType)` é aceito no máximo' +
          ' 1× a cada 30 segundos por usuário. Excedente retorna `204` silenciosamente' +
          ' (sem erro) para não degradar a UX.\n\n' +
          '**LGPD:** nenhum dado pessoal é armazenado além do `user_id` (pseudônimo).' +
          ' Deleção do usuário anonimiza os eventos via `ON DELETE SET NULL`.\n\n' +
          'Requer autenticação e feature flag `tutorials.enabled` ativa.',
        security: [{ bearerAuth: [] }],
        body: RecordTutorialEventBodySchema,
        response: {
          201: { description: 'Evento registrado com sucesso.' },
          204: {
            description: 'Evento ignorado por rate-limit (duplicata na janela de 30s).',
          },
        },
      },
      preHandler: [authenticate(), featureGate(FLAG_KEY)],
    },
    async (request, reply) => {
      if (!request.user) {
        // Nunca ocorre pois authenticate() garante request.user preenchido,
        // mas satisfaz o contrato TypeScript do módulo strict.
        return reply.status(204).send();
      }

      const userId = request.user.id;
      const body = request.body;

      // Rate-limit: silencia duplicatas na janela de 30s.
      if (!checkAndSetEventRateLimit(userId, body.tutorialId, body.eventType)) {
        return reply.status(204).send();
      }

      // Persistência fire-and-forget — erro não degrada a UX.
      // Lançar erro aqui seria silenciado de qualquer forma pela semântica
      // de telemetria, mas preferimos não ocultar bugs de infra: deixamos
      // propagar para o error handler (500 visível nos logs do servidor).
      await recordTutorialEvent(db, body, userId);

      return reply.status(201).send();
    },
  );
};
