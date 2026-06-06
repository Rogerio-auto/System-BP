// =============================================================================
// internal/credit-analyses/routes.ts — Endpoint GET /internal/customers/:id/credit-analyses.
//
// Canal M2M: consumido pela tool `get_credit_analysis_history` (F4-S04, LangGraph).
// Não usa JWT — autenticação via X-Internal-Token.
//
// Registrado manualmente em internal/index.ts com prefix /internal/customers
// (não via autoload — este módulo usa estrutura de controller/repository separados,
// e o prefixo /internal/customers não corresponde ao dirname deste módulo).
//
// Endpoint:
//   GET /:id/credit-analyses → GET /internal/customers/:id/credit-analyses (path final)
//
// Autenticação:
//   Header X-Internal-Token = env.LANGGRAPH_INTERNAL_TOKEN.
//   401 se ausente/inválido.
//
// Multi-tenant (regra inviolável #3 — CLAUDE.md):
//   Header X-Organization-Id obrigatório. 400 se ausente.
//   Filtra WHERE organization_id = $1 em todas as queries.
//   Lead de outra org retorna 404 (não 403) — não vaza existência do recurso.
//
// LGPD (doc 17 §3.4 + Art. 6º III — Minimização):
//   Resposta limitada a: analysis_id, status, created_at, updated_at, current_version_number.
//   NUNCA retorna: parecer_text, pendencias, attachments, internal_score, analyst_user_id,
//   approved_amount, approved_term_months, approved_rate_monthly.
//   Defesa em profundidade: backend não expõe os campos — não é redação no cliente.
//
// Descoberta:
//   Registrado manualmente em internal/index.ts via import direto (não autoload).
//   Autoload (matchFilter: /routes\.(ts|js|mjs|cjs)$/) é excluído para este módulo
//   via ignorePattern em internal/index.ts.
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { env } from '../../../config/env.js';
import { verifyInternalToken } from '../../../lib/auth/internal-token.js';
import { AppError, NotFoundError, UnauthorizedError } from '../../../shared/errors.js';

import { LeadNotFoundInOrgError, getMaskedAnalysisHistory } from './repository.js';
import {
  CreditAnalysisHistoryParamsSchema,
  CreditAnalysisHistoryResponseSchema,
} from './schemas.js';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Serializa Date para ISO 8601. Retorna a data atual como fallback (nunca null)
 * — as colunas created_at e updated_at são NOT NULL no banco.
 */
function toIso(d: Date): string {
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Plugin — registrado manualmente em internal/index.ts com prefix /internal/customers
// ---------------------------------------------------------------------------
// Exportação DEFAULT obrigatória para FastifyPluginAsyncZod.
// ---------------------------------------------------------------------------

const internalCreditAnalysesRoutes: FastifyPluginAsyncZod = async (app) => {
  // -------------------------------------------------------------------------
  // GET /:id/credit-analyses
  //
  // Path final (com prefixo aplicado em internal/index.ts):
  //   GET /internal/customers/:id/credit-analyses
  //
  // Pipeline:
  //   1. Verificar X-Internal-Token → 401 se ausente/inválido.
  //   2. Extrair organization_id do header X-Organization-Id → 400 se ausente.
  //      Regra inviolável #3: toda query filtra por organization_id (multi-tenant).
  //   3. Validar :id (UUID) via Zod.
  //   4. Chamar repositório → getMaskedAnalysisHistory(leadId, organizationId).
  //      - Lead não encontrado na org → 404 (não vaza existência de outras orgs).
  //      - Análises vazias → 200 com items: [].
  //   5. Serializar resposta mascarada e retornar 200.
  //
  // Mascaramento LGPD:
  //   O repositório seleciona APENAS id, status, created_at, updated_at.
  //   current_version_number é derivado via MAX(version) — sem expor parecer_text.
  //   A resposta final NÃO contém: parecer_text, pendencias, attachments,
  //   internal_score, analyst_user_id, approved_amount, approved_term_months,
  //   approved_rate_monthly.
  // -------------------------------------------------------------------------
  app.get(
    '/:id/credit-analyses',
    {
      schema: {
        hide: true,
        params: CreditAnalysisHistoryParamsSchema,
        response: {
          200: CreditAnalysisHistoryResponseSchema,
        },
      },
    },
    async (request, reply) => {
      // 1. Verificar X-Internal-Token (timing-safe — previne timing oracle, doc 10 §2.3).
      if (!verifyInternalToken(request.headers['x-internal-token'], env.LANGGRAPH_INTERNAL_TOKEN)) {
        throw new UnauthorizedError('Token interno inválido ou ausente');
      }

      // 2. Extrair organization_id do header X-Organization-Id.
      //    Regra inviolável #3 (CLAUDE.md): toda rota interna filtra por organization_id.
      //    400 se ausente — erro de contrato (caller deve sempre fornecer).
      const orgHeader = request.headers['x-organization-id'];
      if (typeof orgHeader !== 'string' || orgHeader.trim() === '') {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          'Header X-Organization-Id obrigatório para escopo multi-tenant (regra inviolável #3).',
        );
      }
      const organizationId = orgHeader;

      const { id: leadId } = request.params;

      // 3. Buscar análises mascaradas.
      //
      //    LeadNotFoundInOrgError → 404 (lead não existe ou pertence a outra org).
      //    Outros erros → propagam como 500 (error handler de app.ts).
      let rows: Awaited<ReturnType<typeof getMaskedAnalysisHistory>>;

      try {
        rows = await getMaskedAnalysisHistory(leadId, organizationId);
      } catch (err) {
        if (err instanceof LeadNotFoundInOrgError) {
          throw new NotFoundError(`Lead não encontrado: ${leadId}`);
        }
        // Relança erros inesperados — tratados pelo error handler do Fastify.
        throw err;
      }

      // 4. Serializar resposta mascarada.
      //
      //    LGPD: cada campo foi revisado — apenas status e datas são incluídos.
      //    NÃO inclui: parecer_text, score, analyst, valores financeiros.
      return reply.status(200).send({
        lead_id: leadId,
        items: rows.map((row) => ({
          analysis_id: row.analysisId,
          status: row.status,
          current_version_number: row.currentVersionNumber,
          created_at: toIso(row.createdAt),
          updated_at: toIso(row.updatedAt),
        })),
      });
    },
  );
};

export default internalCreditAnalysesRoutes;
