// =============================================================================
// internal/prompts/routes.ts — GET /internal/prompts/active/:key (F9-S09).
//
// Canal M2M: consumido pelo loader de prompts do serviço LangGraph.
// Não usa JWT — autenticação via X-Internal-Token.
//
// Registrado automaticamente pelo plugin agregador internal/index.ts via
// @fastify/autoload. O prefixo /internal/prompts é injetado pelo autoload:
//   modules/internal/prompts/routes.ts → prefix /internal/prompts
//
// Endpoint:
//   GET /active/:key → GET /internal/prompts/active/:key (path final)
//
// Comportamento:
//   - 200 + payload completo (7 campos) se versão ativa existe.
//   - 404 se não houver versão ativa para a key.
//   - 401 se X-Internal-Token ausente ou inválido.
//   - Cache-Control: max-age=60 para reduzir round-trips no LangGraph.
//     O LangGraph também mantém TTLCache local de 60s.
//
// LGPD: nenhum dado sensível. Prompts são conteúdo estático interno.
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { env } from '../../../config/env.js';
import { verifyInternalToken } from '../../../lib/auth/internal-token.js';
import { NotFoundError, UnauthorizedError } from '../../../shared/errors.js';

import { findActivePromptByKey } from './repository.js';
import { InternalActivePromptResponseSchema, InternalPromptParamsSchema } from './schemas.js';

// ---------------------------------------------------------------------------
// Plugin — registrado via autoload em internal/index.ts
// ---------------------------------------------------------------------------
// Exportação DEFAULT obrigatória para @fastify/autoload v6 (ESM).
// ---------------------------------------------------------------------------

const internalPromptsRoutes: FastifyPluginAsyncZod = async (app) => {
  // -------------------------------------------------------------------------
  // GET /active/:key
  //
  // Path final (com prefixo do autoload): GET /internal/prompts/active/:key
  //
  // Pipeline:
  //   1. Verificar X-Internal-Token → 401 se ausente/inválido.
  //   2. Validar :key via Zod (Fastify aplica automaticamente).
  //   3. Buscar versão ativa no DB via findActivePromptByKey().
  //   4. 404 se não encontrada.
  //   5. Compor prompt_version = "${key}@v${version}".
  //   6. Retornar 200 com payload completo + Cache-Control: max-age=60.
  //
  // Cache:
  //   max-age=60 é hint HTTP. O LangGraph mantém TTLCache local de 60s
  //   adicionalmente. Sem cache stateful no servidor — simples e correto.
  // -------------------------------------------------------------------------
  app.get(
    '/active/:key',
    {
      schema: {
        hide: true,
        params: InternalPromptParamsSchema,
        response: {
          200: InternalActivePromptResponseSchema,
        },
      },
    },
    async (request, reply) => {
      // 1. Verificar X-Internal-Token (timing-safe — previne timing oracle, doc 10 §2.3).
      if (!verifyInternalToken(request.headers['x-internal-token'], env.LANGGRAPH_INTERNAL_TOKEN)) {
        throw new UnauthorizedError('Token interno inválido ou ausente');
      }

      const { key } = request.params;

      // 2. Buscar versão ativa no DB
      const row = await findActivePromptByKey(key);

      // 3. 404 se não encontrada
      if (row === null) {
        throw new NotFoundError(`Nenhuma versão ativa encontrada para prompt key="${key}"`);
      }

      // 4. Compor prompt_version para logging no LangGraph
      const promptVersion = `${row.key}@v${row.version}`;

      // 5. Cache-Control: permite que o LangGraph não chame a cada turno
      void reply.header('Cache-Control', 'max-age=60, private');

      return reply.status(200).send({
        key: row.key,
        version: row.version,
        body: row.body,
        content_hash: row.contentHash,
        model_recommended: row.modelRecommended,
        temperature: row.temperature,
        max_tokens: row.maxTokens,
        top_p: row.topP,
        prompt_version: promptVersion,
      });
    },
  );
};

export default internalPromptsRoutes;
