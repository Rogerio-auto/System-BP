// =============================================================================
// internal/ai/routes.ts — Endpoint POST /internal/ai/decisions (F3-S09).
//
// Canal M2M: consumido pela tool `log_ai_decision` (F3-S19) do serviço LangGraph,
// chamada no nó final `log_decision` com agregação dos dados do turno (doc 06 §7.9).
//
// Regra inviolável (doc 02, CLAUDE.md §1):
//   LangGraph NUNCA toca o Postgres direto — acesso exclusivo via este endpoint
//   com header X-Internal-Token.
//
// Endpoints registrados neste plugin (prefixo /ai via autoload + /internal via app.ts):
//   POST /decisions → POST /internal/ai/decisions (path final)
//
// Autenticação:
//   Header X-Internal-Token = env.LANGGRAPH_INTERNAL_TOKEN. 401 se ausente/inválido.
//   Sem JWT — token rotacionável armazenado em secrets manager (doc 10 §2.3).
//
// Comportamento:
//   INSERT append-only em ai_decision_logs. Tabela imutável após inserção.
//   Sem UPDATE, sem ON CONFLICT DO UPDATE — cada call cria 1 novo registro.
//   Resposta: { decision_log_id } — UUID do registro criado.
//
// LGPD (doc 17 §8.4):
//   - `decision` jsonb: DLP aplicado pelo serviço Python ANTES de chamar este endpoint.
//     Responsabilidade de sanitização é do produtor (LangGraph).
//     Backend valida ausência de chaves PII conhecidas como defesa em profundidade.
//   - Logs de acesso cobertos por pino.redact configurado em app.ts.
//   - Retenção: job externo purga registros com created_at < now() - 12 months.
//
// Descoberta:
//   Registrado automaticamente pelo plugin agregador internal/index.ts via
//   @fastify/autoload (F3-S04). Não edite internal/index.ts nem app.ts.
//   Diretório modules/internal/ai/routes.ts → prefixo /ai (autoload dirNameRoutePrefix).
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { env } from '../../../config/env.js';
import { db } from '../../../db/client.js';
import { aiDecisionLogs } from '../../../db/schema/aiDecisionLogs.js';
import { AppError, UnauthorizedError } from '../../../shared/errors.js';

import { LogAiDecisionBodySchema, LogAiDecisionResponseSchema } from './schemas.js';

// ---------------------------------------------------------------------------
// Chaves PII conhecidas que NUNCA devem aparecer no campo `decision`.
// Defesa em profundidade no backend — o LangGraph deve aplicar DLP antes.
// Lista baseada em doc 17 §8.4 e campos sensíveis do domínio.
// ---------------------------------------------------------------------------
const PII_KEYS_FORBIDDEN = [
  'cpf',
  'rg',
  'document_number',
  'documento',
  'nome_completo',
  'full_name',
  'email',
  'phone',
  'telefone',
  'senha',
  'password',
] as const;

/**
 * Verifica recursivamente se um objeto contém chaves PII proibidas.
 * Retorna a primeira chave proibida encontrada, ou null se limpo.
 *
 * Depth-limited a 5 níveis para evitar abuse via objeto profundo.
 */
function findForbiddenPiiKey(obj: Record<string, unknown>, depth = 0): string | null {
  if (depth > 5) return null;
  for (const key of Object.keys(obj)) {
    const lower = key.toLowerCase();
    if (PII_KEYS_FORBIDDEN.some((k) => lower === k || lower.includes(k))) {
      return key;
    }
    const val = obj[key];
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      const nested = findForbiddenPiiKey(val as Record<string, unknown>, depth + 1);
      if (nested !== null) return nested;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Plugin — registrado via autoload em internal/index.ts
// ---------------------------------------------------------------------------
// Exportação DEFAULT obrigatória para @fastify/autoload v6 (ESM).
// ---------------------------------------------------------------------------

const internalAiRoutes: FastifyPluginAsyncZod = async (app) => {
  // -------------------------------------------------------------------------
  // POST /decisions
  //
  // Path final (com prefixos do autoload + app.ts): POST /internal/ai/decisions
  //
  // Pipeline:
  //   1. Verificar X-Internal-Token → 401 se ausente/inválido.
  //   2. Validar body via Zod (Fastify aplica automaticamente).
  //   3. Verificar ausência de PII em `decision` → 422 se detectado.
  //   4. INSERT append-only em ai_decision_logs.
  //   5. Retornar { decision_log_id }.
  //
  // Append-only:
  //   Não há ON CONFLICT — cada call é um registro novo e imutável.
  //   Para corrigir um log errado: inserir novo registro com `error` explicativo.
  // -------------------------------------------------------------------------
  app.post(
    '/decisions',
    {
      schema: {
        body: LogAiDecisionBodySchema,
        response: {
          200: LogAiDecisionResponseSchema,
        },
      },
    },
    async (request, reply) => {
      // 1. Verificar X-Internal-Token
      //    UnauthorizedError (tratado pelo error handler central) em vez de
      //    reply.status(401) para evitar conflito com o tipo de resposta Zod (200 only).
      const token = request.headers['x-internal-token'];
      if (token !== env.LANGGRAPH_INTERNAL_TOKEN) {
        throw new UnauthorizedError('Token interno inválido ou ausente');
      }

      const body = request.body;

      // 2. Validação de PII em `decision` — defesa em profundidade (doc 17 §8.4).
      //    O Zod já validou o shape; aqui inspecionamos o conteúdo das chaves.
      //    O LangGraph é responsável pelo DLP primário — este é o firewall backend.
      const forbiddenKey = findForbiddenPiiKey(body.decision);
      if (forbiddenKey !== null) {
        // Usando VALIDATION_ERROR (ErrorCode canônico).
        // 422 Unprocessable Entity: body bem formado mas violação de política LGPD.
        throw new AppError(
          422,
          'VALIDATION_ERROR',
          `Campo 'decision' contém chave PII proibida: "${forbiddenKey}". ` +
            'Aplique DLP antes de chamar este endpoint (doc 17 §8.4).',
        );
      }

      // 3. INSERT append-only em ai_decision_logs.
      //    Sem onConflictDoUpdate — tabela imutável após inserção (doc F3-S01).
      //    `returning` retorna apenas o id gerado pelo gen_random_uuid() do DB.
      const rows = await db
        .insert(aiDecisionLogs)
        .values({
          organizationId: body.organizationId,
          conversationId: body.conversationId,
          leadId: body.leadId ?? null,
          nodeName: body.nodeName,
          intent: body.intent ?? null,
          promptKey: body.promptKey ?? null,
          promptVersion: body.promptVersion ?? null,
          model: body.model ?? null,
          tokensIn: body.tokensIn ?? null,
          tokensOut: body.tokensOut ?? null,
          latencyMs: body.latencyMs ?? null,
          decision: body.decision,
          error: body.error ?? null,
          correlationId: body.correlationId,
        })
        .returning({ id: aiDecisionLogs.id });

      // noUncheckedIndexedAccess: rows[0] é T | undefined — guard obrigatório.
      // Em prática, INSERT sem DO NOTHING sempre retorna ≥1 linha.
      const row = rows[0];
      if (row === undefined) {
        // Nunca ocorre — guard para satisfazer noUncheckedIndexedAccess.
        throw new AppError(
          500,
          'INTERNAL_ERROR',
          'INSERT em ai_decision_logs não retornou id — erro interno inesperado.',
        );
      }

      return reply.status(200).send({ decision_log_id: row.id });
    },
  );
};

export default internalAiRoutes;
