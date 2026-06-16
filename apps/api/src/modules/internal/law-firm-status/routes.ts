// =============================================================================
// internal/law-firm-status/routes.ts — Endpoints internos de advocacia (F19-S03).
//
// Canal M2M: consumido pelo agente LangGraph para encaminhamentos automáticos.
// Autenticação via X-Internal-Token (sem JWT).
//
// Regra inviolável (CLAUDE.md §1):
//   LangGraph NUNCA toca o Postgres direto — acesso exclusivo via estes endpoints
//   com header X-Internal-Token.
//
// Endpoints registrados neste plugin (prefixo /law-firm-status via autoload):
//   GET  /             → GET  /internal/law-firm-status?customer_id= (path final)
//   POST /customers/:id/law-firm-referral → POST /internal/law-firm-status/customers/:id/...
//
// AGUARDA: o autoload mapeia o dirname 'law-firm-status' como prefixo:
//   - GET  / → /internal/law-firm-status
//   - POST /customers/:id/law-firm-referral → /internal/law-firm-status/customers/:id/law-firm-referral
//
// IMPORTANTE: O LangGraph deve chamar:
//   GET  /internal/law-firm-status?customer_id=<uuid>
//   POST /internal/law-firm-status/customers/:id/law-firm-referral
//
// Multi-tenant (regra inviolável #3):
//   X-Organization-Id obrigatório em todas as chamadas.
//
// LGPD (doc 17 §8.5 + §12):
//   - GET não retorna PII do customer — apenas dados do escritório (PJ).
//   - POST emite evento outbox sem PII do customer (apenas IDs opacos).
//   - ai_decision_logs: decision jsonb sem PII bruta.
//   - Base legal: Art. 7º V LGPD — cobrança judicial.
//
// Autenticação:
//   Header X-Internal-Token = env.LANGGRAPH_INTERNAL_TOKEN. 401 se ausente/inválido.
//
// Descoberta:
//   Registrado automaticamente pelo plugin agregador internal/index.ts via
//   @fastify/autoload (F3-S04). Não edite internal/index.ts nem app.ts.
//   Diretório modules/internal/law-firm-status/routes.ts → prefixo /law-firm-status.
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { env } from '../../../config/env.js';
import { db } from '../../../db/client.js';
import { verifyInternalToken } from '../../../lib/auth/internal-token.js';
import { AppError, UnauthorizedError } from '../../../shared/errors.js';
import {
  CreateAiReferralBodySchema,
  CreateAiReferralResponseSchema,
  CustomerReferralParamsSchema,
  LawFirmStatusQuerySchema,
  LawFirmStatusResponseSchema,
} from '../../customers/law-firm-referral.schemas.js';
import {
  checkLawFirmStatusService,
  createAiReferralService,
} from '../../customers/law-firm-referral.service.js';

// ---------------------------------------------------------------------------
// Helper — verificar X-Internal-Token e X-Organization-Id
// ---------------------------------------------------------------------------

/**
 * Verifica X-Internal-Token e extrai X-Organization-Id.
 * Lança UnauthorizedError / AppError conforme necessário.
 */
function verifyInternalHeaders(request: {
  headers: Record<string, string | string[] | undefined>;
}): string {
  // 1. Token interno (timing-safe — previne timing oracle, doc 10 §2.3)
  if (!verifyInternalToken(request.headers['x-internal-token'], env.LANGGRAPH_INTERNAL_TOKEN)) {
    throw new UnauthorizedError('Token interno inválido ou ausente');
  }

  // 2. Organization ID para escopo multi-tenant (regra inviolável #3)
  const orgHeader = request.headers['x-organization-id'];
  if (typeof orgHeader !== 'string' || orgHeader.trim() === '') {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Header X-Organization-Id obrigatório para escopo multi-tenant (regra inviolável #3).',
    );
  }

  return orgHeader;
}

// ---------------------------------------------------------------------------
// Plugin — registrado via autoload em internal/index.ts
// ---------------------------------------------------------------------------
// Exportação DEFAULT obrigatória para @fastify/autoload v6 (ESM).
// ---------------------------------------------------------------------------

const internalLawFirmStatusRoutes: FastifyPluginAsyncZod = async (app) => {
  // -------------------------------------------------------------------------
  // GET /
  //
  // Path final (com prefixo do autoload + app.ts): GET /internal/law-firm-status
  //
  // Parâmetros: ?customer_id=<uuid>
  // Headers:    X-Internal-Token, X-Organization-Id
  //
  // Pipeline:
  //   1. Verificar X-Internal-Token → 401 se ausente/inválido.
  //   2. Extrair X-Organization-Id → 400 se ausente.
  //   3. Verificar feature flag law_firm.ai_handoff.enabled.
  //   4. Verificar cooldown ativo → { eligible: false, reason: 'cooldown_active' }.
  //   5. Verificar parcelas overdue → { eligible: false, reason: 'no_overdue_dues' }.
  //   6. Buscar city_id do customer → { eligible: false, reason: 'no_coverage' }.
  //   7. Buscar escritório padrão para a cidade.
  //   8. Retornar { eligible, law_firm, cooldown_until, reason }.
  //
  // LGPD (doc 17 §8.5):
  //   Resposta NÃO contém nome/CPF/telefone do customer.
  //   law_firm.contact_phone é dado público de PJ — não é PII pessoal.
  // -------------------------------------------------------------------------
  app.get(
    '/',
    {
      schema: {
        hide: true,
        querystring: LawFirmStatusQuerySchema,
        response: {
          200: LawFirmStatusResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const organizationId = verifyInternalHeaders(request);
      const { customer_id: customerId } = request.query;

      const result = await checkLawFirmStatusService(db, customerId, organizationId);

      return reply.status(200).send(result);
    },
  );

  // -------------------------------------------------------------------------
  // POST /customers/:id/law-firm-referral
  //
  // Path final: POST /internal/law-firm-status/customers/:id/law-firm-referral
  //
  // Headers: X-Internal-Token, X-Organization-Id, X-Correlation-Id (recomendado)
  //
  // Pipeline:
  //   1. Verificar X-Internal-Token → 401.
  //   2. Extrair X-Organization-Id → 400.
  //   3. Verificar cooldown → 409 LAW_FIRM_COOLDOWN.
  //   4. Verificar customer e law_firm no org-scope → 404.
  //   5. Transação: INSERT referral + emit outbox + ai_decision_log.
  //   6. Retornar { ok: true, referral_id }.
  //
  // Diferenças do canal humano:
  //   - linked_by = null (sem usuário humano).
  //   - channel = 'ai'.
  //   - Registra em ai_decision_logs (Art. 20 LGPD — decisão autônoma de IA).
  //
  // LGPD: evento outbox sem PII — apenas IDs opacos + canal + timestamp.
  // -------------------------------------------------------------------------
  app.post(
    '/customers/:id/law-firm-referral',
    {
      schema: {
        hide: true,
        params: CustomerReferralParamsSchema,
        body: CreateAiReferralBodySchema,
        response: {
          201: CreateAiReferralResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const organizationId = verifyInternalHeaders(request);
      const { id: customerId } = request.params;

      // correlationId: X-Correlation-Id do header, ou UUID gerado
      const corrHeader = request.headers['x-correlation-id'];
      const correlationId =
        typeof corrHeader === 'string' && corrHeader.trim() !== ''
          ? corrHeader
          : crypto.randomUUID();

      const result = await createAiReferralService(
        db,
        customerId,
        request.body.law_firm_id,
        organizationId,
        correlationId,
      );

      return reply.status(201).send(result);
    },
  );
};

export default internalLawFirmStatusRoutes;
