// =============================================================================
// internal/conversations/routes.ts — Endpoints state load/save (F3-S02).
//
// Canal M2M: consumido pelas tools `get_conversation_state` e
// `save_conversation_state` do serviço LangGraph (doc 06 §5.2, §7.2).
//
// Regra inviolável (doc 02, CLAUDE.md §1):
//   LangGraph NUNCA toca o Postgres direto — acesso exclusivo via este endpoint
//   com header X-Internal-Token.
//
// Endpoints registrados (prefixo /conversations via autoload + /internal via app.ts):
//   GET  /internal/conversations/:id/state  → carregar estado
//   PUT  /internal/conversations/:id/state  → salvar estado (upsert idempotente)
//
// Autenticação:
//   Header X-Internal-Token = env.LANGGRAPH_INTERNAL_TOKEN. 401 se ausente/inválido.
//   Sem JWT — token rotacionável armazenado em secrets manager (doc 10 §2.3).
//
// LGPD (doc 17 §8.4, §8.12):
//   - `phone` no body do PUT é PII — coberto por pino.redact em app.ts.
//   - `state` jsonb: DLP aplicado pelo LangGraph antes de chamar PUT.
//     O backend persiste como recebido — responsabilidade do produtor.
//   - GET não retorna `phone` na resposta — minimização (doc 17 §8.12).
//   - Logs de acesso cobertos pelo pino.redact configurado em app.ts.
//
// Descoberta:
//   Registrado automaticamente pelo plugin agregador internal/index.ts via
//   @fastify/autoload (F3-S04). Não edite internal/index.ts nem app.ts.
//   Diretório modules/internal/conversations/routes.ts → prefixo /conversations.
// =============================================================================
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { env } from '../../../config/env.js';
import { db } from '../../../db/client.js';
import { aiConversationStates } from '../../../db/schema/aiConversationStates.js';
import { verifyInternalToken } from '../../../lib/auth/internal-token.js';
import { AppError, NotFoundError, UnauthorizedError } from '../../../shared/errors.js';

import {
  ConversationIdParamSchema,
  ConversationStateResponseSchema,
  UpsertConversationStateBodySchema,
  UpsertConversationStateResponseSchema,
} from './schemas.js';

// ---------------------------------------------------------------------------
// Helpers de serialização
// ---------------------------------------------------------------------------

/**
 * Serializa timestamps de Date para ISO 8601 com offset UTC.
 * Drizzle retorna Date objects — o schema Zod de resposta espera strings ISO.
 */
function toIso(d: Date | null | undefined): string | null {
  if (d === null || d === undefined) return null;
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Plugin — registrado via autoload em internal/index.ts
// ---------------------------------------------------------------------------
// Exportação DEFAULT obrigatória para @fastify/autoload v6 (ESM).
// ---------------------------------------------------------------------------

const internalConversationsRoutes: FastifyPluginAsyncZod = async (app) => {
  // -------------------------------------------------------------------------
  // GET /state
  //
  // Path final (com prefixos do autoload): GET /internal/conversations/:id/state
  //
  // Pipeline:
  //   1. Verificar X-Internal-Token → 401 se ausente/inválido.
  //   2. Validar :id via Zod (UUID).
  //   3. Buscar ai_conversation_states por conversation_id.
  //   4. 404 se não existir. 200 com estado se existir.
  //
  // Nota sobre conversation_id vs id:
  //   O `:id` da URL é o `conversation_id` (UUID do domínio), NÃO o PK interno.
  //   O LangGraph trabalha com conversation_id — é o identificador que ele gera
  //   e usa consistentemente em todas as tools (doc 06 §5.1).
  // -------------------------------------------------------------------------
  app.get(
    '/:id/state',
    {
      schema: {
        hide: true,
        params: ConversationIdParamSchema,
        response: {
          200: ConversationStateResponseSchema,
        },
      },
    },
    async (request, reply) => {
      // 1. Verificar X-Internal-Token (timing-safe — previne timing oracle, doc 10 §2.3).
      if (!verifyInternalToken(request.headers['x-internal-token'], env.LANGGRAPH_INTERNAL_TOKEN)) {
        throw new UnauthorizedError('Token interno inválido ou ausente');
      }

      const { id: conversationId } = request.params;

      // 2. Buscar por conversation_id (UNIQUE — no máximo 1 resultado)
      const rows = await db
        .select()
        .from(aiConversationStates)
        .where(eq(aiConversationStates.conversationId, conversationId))
        .limit(1);

      const row = rows[0];

      // 3. 404 se não existir
      if (row === undefined) {
        throw new NotFoundError(`Conversation state não encontrado: ${conversationId}`);
      }

      // 4. Retornar estado serializado
      return reply.status(200).send({
        id: row.id,
        organization_id: row.organizationId,
        conversation_id: row.conversationId,
        chatwoot_conversation_id: row.chatwootConversationId ?? null,
        lead_id: row.leadId ?? null,
        customer_id: row.customerId ?? null,
        current_node: row.currentNode ?? null,
        graph_version: row.graphVersion ?? null,
        // `state` é jsonb — Drizzle retorna como Record<string, unknown> | null.
        // Default do schema é '{}'::jsonb, mas pode ser null em registros legados.
        // `as` justificado: Drizzle infere jsonb como `unknown`, mas o schema DB
        // garante que state é sempre um objeto JSON após o default ser aplicado.
        state: (row.state as Record<string, unknown>) ?? {},
        last_message_at: toIso(row.lastMessageAt),
        created_at: toIso(row.createdAt) ?? new Date().toISOString(),
        updated_at: toIso(row.updatedAt) ?? new Date().toISOString(),
      });
    },
  );

  // -------------------------------------------------------------------------
  // PUT /state
  //
  // Path final (com prefixos do autoload): PUT /internal/conversations/:id/state
  //
  // Pipeline:
  //   1. Verificar X-Internal-Token → 401 se ausente/inválido.
  //   2. Validar :id (UUID) e body via Zod.
  //   3. Upsert por conversation_id:
  //      - INSERT ... ON CONFLICT (conversation_id) DO UPDATE SET ...
  //      - `updated_at` atualizado a cada PUT.
  //   4. Retornar registro completo + created: true|false.
  //
  // Idempotência:
  //   O LangGraph pode chamar PUT múltiplas vezes para o mesmo conversation_id
  //   (retry após falha, restart do serviço). O último estado vence.
  //   A unique constraint `uq_ai_conv_states_conversation_id` garante atomicidade.
  //
  // LGPD:
  //   `phone` no body é PII — coberto por pino.redact. Não logado em clear-text.
  //   `state` jsonb: DLP obrigatório antes de chamar este endpoint (doc 17 §8.4).
  // -------------------------------------------------------------------------
  app.put(
    '/:id/state',
    {
      schema: {
        hide: true,
        params: ConversationIdParamSchema,
        body: UpsertConversationStateBodySchema,
        response: {
          200: UpsertConversationStateResponseSchema,
        },
      },
    },
    async (request, reply) => {
      // 1. Verificar X-Internal-Token (timing-safe — previne timing oracle, doc 10 §2.3).
      if (!verifyInternalToken(request.headers['x-internal-token'], env.LANGGRAPH_INTERNAL_TOKEN)) {
        throw new UnauthorizedError('Token interno inválido ou ausente');
      }

      const { id: conversationId } = request.params;
      const body = request.body;

      const now = new Date();

      // 2. Upsert por conversation_id
      //    ON CONFLICT: atualiza todos os campos mutáveis, preserva createdAt.
      //    `state` usa o valor do body (sanitizado pelo LangGraph antes do PUT).
      const rows = await db
        .insert(aiConversationStates)
        .values({
          conversationId,
          organizationId: body.organization_id,
          phone: body.phone,
          chatwootConversationId: body.chatwoot_conversation_id ?? null,
          leadId: body.lead_id ?? null,
          customerId: body.customer_id ?? null,
          currentNode: body.current_node ?? null,
          graphVersion: body.graph_version ?? null,
          state: body.state,
          lastMessageAt:
            body.last_message_at !== undefined && body.last_message_at !== null
              ? new Date(body.last_message_at)
              : null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          // Conflict target: unique constraint em conversation_id.
          target: aiConversationStates.conversationId,
          set: {
            // Todos os campos mutáveis são atualizados no update.
            // organization_id e createdAt são preservados do registro original.
            phone: body.phone,
            chatwootConversationId: body.chatwoot_conversation_id ?? null,
            leadId: body.lead_id ?? null,
            customerId: body.customer_id ?? null,
            currentNode: body.current_node ?? null,
            graphVersion: body.graph_version ?? null,
            state: body.state,
            lastMessageAt:
              body.last_message_at !== undefined && body.last_message_at !== null
                ? new Date(body.last_message_at)
                : null,
            updatedAt: now,
          },
        })
        .returning({
          id: aiConversationStates.id,
          organizationId: aiConversationStates.organizationId,
          conversationId: aiConversationStates.conversationId,
          chatwootConversationId: aiConversationStates.chatwootConversationId,
          leadId: aiConversationStates.leadId,
          customerId: aiConversationStates.customerId,
          currentNode: aiConversationStates.currentNode,
          graphVersion: aiConversationStates.graphVersion,
          state: aiConversationStates.state,
          lastMessageAt: aiConversationStates.lastMessageAt,
          createdAt: aiConversationStates.createdAt,
          updatedAt: aiConversationStates.updatedAt,
        });

      // `returning()` sempre retorna exatamente 1 linha após insert/upsert sem DO NOTHING.
      // noUncheckedIndexedAccess: rows[0] é T | undefined — precisamos de guard.
      // Em prática, insert sem DO NOTHING sempre retorna ≥1 linha — o guard abaixo
      // protege o compilador sem custo de runtime (caminho de erro nunca ocorre).
      const row = rows[0];
      if (row === undefined) {
        // Nunca ocorre em prática — Drizzle insert sem DO NOTHING sempre retorna ≥1 linha.
        // Guard obrigatório por noUncheckedIndexedAccess (tsconfig strict).
        throw new AppError(
          500,
          'INTERNAL_ERROR',
          'Upsert de conversation state não retornou dados — erro interno inesperado.',
        );
      }

      // Detectar se foi criação ou atualização comparando createdAt ≈ updatedAt.
      // Drizzle não retorna diretamente se houve INSERT ou UPDATE.
      // Proxy: se createdAt e updatedAt são iguais (ou muito próximos, < 1s),
      // foi um INSERT (ambos definidos agora). Se createdAt < updatedAt, foi UPDATE.
      //
      // Nota: essa heurística é melhor que nada, mas tem um edge case: um upsert
      // na mesma transação com o mesmo `now` pode dar falso positivo de "created".
      // Para o LangGraph, `created` é informativo (não crítico para a operação).
      const createdDiff = Math.abs(row.updatedAt.getTime() - row.createdAt.getTime());
      const wasCreated = createdDiff < 1000;

      return reply.status(200).send({
        id: row.id,
        organization_id: row.organizationId,
        conversation_id: row.conversationId,
        chatwoot_conversation_id: row.chatwootConversationId ?? null,
        lead_id: row.leadId ?? null,
        customer_id: row.customerId ?? null,
        current_node: row.currentNode ?? null,
        graph_version: row.graphVersion ?? null,
        // `as` justificado: Drizzle infere jsonb como `unknown`; schema DB garante objeto.
        state: (row.state as Record<string, unknown>) ?? {},
        last_message_at: toIso(row.lastMessageAt),
        created_at: toIso(row.createdAt) ?? now.toISOString(),
        updated_at: toIso(row.updatedAt) ?? now.toISOString(),
        created: wasCreated,
      });
    },
  );
};

export default internalConversationsRoutes;
