// =============================================================================
// internal/chatwoot/routes.ts — Endpoint POST /internal/chatwoot/notes (F3-S08).
//
// Canal M2M: consumido pela tool `create_chatwoot_note` (F3-S18, LangGraph) para
// registrar notas internas em conversas do Chatwoot.
//
// Regra inviolável (doc 02, CLAUDE.md §1):
//   LangGraph NUNCA toca o Chatwoot diretamente — acesso exclusivo via este
//   endpoint com header X-Internal-Token.
//
// Registrado automaticamente pelo plugin agregador internal/index.ts via
// @fastify/autoload (F3-S04). O prefixo /internal/chatwoot é injetado pelo
// autoload com base na estrutura de diretórios:
//   modules/internal/chatwoot/routes.ts → subdir 'chatwoot' → /internal/chatwoot.
//   Logo: POST /notes → POST /internal/chatwoot/notes (path final).
// NÃO edite internal/index.ts nem app.ts.
//
// Endpoints registrados neste plugin (prefixo /chatwoot via autoload):
//   POST /notes → POST /internal/chatwoot/notes
//
// Autenticação:
//   Header X-Internal-Token = env.LANGGRAPH_INTERNAL_TOKEN. 401 se ausente/inválido.
//   Sem JWT — token rotacionável armazenado em secrets manager (doc 10 §2.3).
//
// Pipeline:
//   1. X-Internal-Token → 401 se ausente/inválido.
//   2. Validar body via Zod (Fastify aplica automaticamente).
//   3. Chamar ChatwootClient.createNote() com chatwootConversationId e body.
//   4. Retornar 200 com { note_id }.
//
// Cliente Chatwoot:
//   Reutiliza ChatwootClient de F1-S20 (integrations/chatwoot/client.ts).
//   Criado por request para permitir injeção em testes via módulo mockado.
//
// LGPD (doc 17 §8.3):
//   - `body` pode conter resumo de atendimento com PII interna (nome, orientações).
//   - Nota interna = dado interno de atendimento, não visível ao cliente.
//   - request.log tem redact de 'body' configurado em app.ts → não logar body.
//   - Resposta retorna apenas note_id opaco — minimização de dados (doc 17 §3.4).
//   - ChatwootClient não loga content (LGPD §8.3 do client — caller é responsável).
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { env } from '../../../config/env.js';
import { ChatwootClient } from '../../../integrations/chatwoot/client.js';
import { verifyInternalToken } from '../../../lib/auth/internal-token.js';
import { UnauthorizedError } from '../../../shared/errors.js';

import { CreateChatwootNoteBodySchema, CreateChatwootNoteResponseSchema } from './schemas.js';

// ---------------------------------------------------------------------------
// Plugin — registrado via autoload em internal/index.ts
// ---------------------------------------------------------------------------
// Exportação DEFAULT obrigatória para @fastify/autoload v6 (ESM).
// ---------------------------------------------------------------------------

const internalChatwootRoutes: FastifyPluginAsyncZod = async (app) => {
  // -------------------------------------------------------------------------
  // POST /notes
  //
  // Path final (com prefixos do autoload + app.ts): POST /internal/chatwoot/notes
  //
  // Pipeline:
  //   1. Verificar X-Internal-Token → 401 se ausente/inválido.
  //   2. Validar body via Zod (Fastify aplica automaticamente).
  //   3. Instanciar ChatwootClient e chamar createNote().
  //   4. Retornar { note_id } com status 200.
  //
  // Não há Idempotency-Key aqui: criar notas duplicadas é aceitável em retry
  // (a IA pode reenviar — múltiplas notas idênticas são inofensivas).
  // Se idempotência for necessária no futuro, F3-S18 (caller) gerencia.
  // -------------------------------------------------------------------------
  app.post(
    '/notes',
    {
      schema: {
        hide: true,
        body: CreateChatwootNoteBodySchema,
        response: {
          200: CreateChatwootNoteResponseSchema,
        },
      },
    },
    async (request, reply) => {
      // 1. Verificar X-Internal-Token (timing-safe — previne timing oracle, doc 10 §2.3).
      //    Lançamos UnauthorizedError (tratado pelo error handler central) em vez de
      //    reply.status(401).send() para manter consistência com demais rotas internas.
      if (!verifyInternalToken(request.headers['x-internal-token'], env.LANGGRAPH_INTERNAL_TOKEN)) {
        throw new UnauthorizedError('Token interno inválido ou ausente');
      }

      const { chatwootConversationId, body: noteBody } = request.body;

      // 2. Criar nota interna via ChatwootClient (F1-S20).
      //    createNote() é atalho para createMessage(..., isPrivate=true).
      //
      //    LGPD: noteBody pode conter PII interna — não logar em nível info.
      //    O ChatwootClient não loga `content` (doc client §LGPD §8.3).
      //    request.log tem redact de 'body' configurado em app.ts.
      const chatwootClient = new ChatwootClient();
      const noteResponse = await chatwootClient.createNote(chatwootConversationId, noteBody);

      // 3. Retornar apenas o ID opaco — minimização de dados (doc 17 §3.4).
      return reply.status(200).send({ note_id: noteResponse.id });
    },
  );
};

export default internalChatwootRoutes;
