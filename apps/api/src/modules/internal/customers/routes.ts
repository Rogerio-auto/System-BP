// =============================================================================
// internal/customers/routes.ts — Endpoint GET /internal/customers/:id/context (F3-S10).
//
// Canal M2M: consumido pela tool `get_customer_context` (F3-S20, LangGraph).
// Não usa JWT — autenticação via X-Internal-Token.
//
// Registrado automaticamente pelo plugin agregador internal/index.ts via
// @fastify/autoload. O prefixo /internal/customers é injetado pelo autoload com
// base na estrutura de diretórios (modules/internal/customers/routes.ts → /customers).
//
// Endpoints registrados neste plugin (prefixo /customers via autoload):
//   GET /:id/context → GET /internal/customers/:id/context (path final)
//
// Autenticação:
//   Header X-Internal-Token = env.LANGGRAPH_INTERNAL_TOKEN. 401 se ausente/inválido.
//
// Parâmetros:
//   :id     = UUID do lead ou customer.
//   ?type   = 'lead' (default) | 'customer'.
//             Quando type=customer, busca customer por id, depois obtém o lead primário.
//             Quando type=lead, busca lead diretamente.
//
// LGPD (doc 06 §7.6 + doc 17 §3.4):
//   - A resposta é uma "ficha resumida" propositalmente limitada.
//   - NÃO retorna CPF, RG, phone, email, document_number, notes.
//   - Retorna: name (necessário para personalização — base legal legítimo interesse),
//     city_name, agent_name, current_stage, lead_status, last_simulation,
//     last_analysis (null até F4+ implementar credit_analyses), messages_last_30_days.
//   - Logs cobertos pelo pino.redact configurado em app.ts.
//
// Descoberta:
//   Registrado automaticamente pelo plugin agregador internal/index.ts via
//   @fastify/autoload (F3-S04). Não edite internal/index.ts nem app.ts.
// =============================================================================
import { and, count, eq, gte } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { env } from '../../../config/env.js';
import { db } from '../../../db/client.js';
import { agents } from '../../../db/schema/agents.js';
import { cities } from '../../../db/schema/cities.js';
import { creditSimulations } from '../../../db/schema/creditSimulations.js';
import { customers } from '../../../db/schema/customers.js';
import { interactions } from '../../../db/schema/interactions.js';
import { kanbanCards } from '../../../db/schema/kanbanCards.js';
import { kanbanStages } from '../../../db/schema/kanbanStages.js';
import { leads } from '../../../db/schema/leads.js';
import { verifyInternalToken } from '../../../lib/auth/internal-token.js';
import { AppError, NotFoundError, UnauthorizedError } from '../../../shared/errors.js';

import {
  CustomerContextParamsSchema,
  CustomerContextQuerySchema,
  CustomerContextResponseSchema,
} from './schemas.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Serializa Date para ISO 8601. Retorna null quando o valor é null/undefined.
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

const internalCustomersRoutes: FastifyPluginAsyncZod = async (app) => {
  // -------------------------------------------------------------------------
  // GET /:id/context
  //
  // Path final (com prefixo do autoload): GET /internal/customers/:id/context
  //
  // Pipeline:
  //   1. Verificar X-Internal-Token → 401 se ausente/inválido.
  //   2. Extrair organization_id do header X-Organization-Id → 400 se ausente.
  //      Regra inviolável #3: toda query filtra por organization_id (multi-tenant).
  //   3. Validar :id (UUID) e ?type via Zod.
  //   4. Resolver lead:
  //      a. type=lead  → buscar lead por id + organization_id diretamente.
  //      b. type=customer → buscar customer por id + organization_id → obter primary_lead_id.
  //      Em ambos, 404 se entidade não existir OU pertencer a outra org.
  //   5. Resolver dados auxiliares em paralelo (minimiza latência):
  //      - city name (via leads.city_id → cities.name)
  //      - agent name (via leads.agent_id → agents.display_name)
  //      - kanban stage name (via kanban_cards.lead_id → kanban_stages.name)
  //      - última simulação (via leads.last_simulation_id → credit_simulations)
  //      - contagem de mensagens nos últimos 30 dias (COUNT de interactions)
  //   6. Montar ficha resumida e retornar 200.
  //
  // Observação sobre last_analysis:
  //   A tabela credit_analyses não existe até F4+. Retorna null até lá.
  //   O schema de resposta documenta o stub (LastAnalysisSchema.nullable()).
  //
  // Multi-tenant (regra inviolável #3 — CLAUDE.md):
  //   organization_id vem do header X-Organization-Id — não do path/query.
  //   O LangGraph passa a org de cada requisição. O token não carrega contexto de org.
  //   Customer/lead de outra org retorna 404 (não 403) — não vaza existência do recurso.
  // -------------------------------------------------------------------------
  app.get(
    '/:id/context',
    {
      schema: {
        hide: true,
        params: CustomerContextParamsSchema,
        querystring: CustomerContextQuerySchema,
        response: {
          200: CustomerContextResponseSchema,
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
      //    O LangGraph passa a org de cada requisição via header (token não carrega org).
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

      const { id } = request.params;
      const { type } = request.query;

      // -----------------------------------------------------------------------
      // 3. Resolver lead
      //
      // LGPD: buscamos apenas as colunas necessárias (minimização — art. 6 III).
      // NÃO selecionar: phone_e164, phone_normalized, email, cpf_encrypted,
      //                 cpf_hash, notes (texto livre potencialmente com PII).
      //
      // Multi-tenant: toda query filtra por organization_id (regra inviolável #3).
      //   Customer/lead de outra org retorna 404 — não vaza existência do recurso.
      // -----------------------------------------------------------------------

      let leadId: string;
      let customerId: string | null = null;

      if (type === 'customer') {
        // Buscar customer para obter o lead primário — filtrando por organization_id.
        const customerRows = await db
          .select({
            id: customers.id,
            primaryLeadId: customers.primaryLeadId,
          })
          .from(customers)
          .where(and(eq(customers.id, id), eq(customers.organizationId, organizationId)))
          .limit(1);

        const customer = customerRows[0];
        if (customer === undefined) {
          throw new NotFoundError(`Customer não encontrado: ${id}`);
        }

        customerId = customer.id;
        leadId = customer.primaryLeadId;
      } else {
        // type === 'lead' (default)
        leadId = id;
      }

      // Buscar lead — colunas não-PII selecionadas explicitamente (minimização).
      // organization_id filtrado para garantir multi-tenant scope (regra inviolável #3).
      const leadRows = await db
        .select({
          id: leads.id,
          name: leads.name,
          cityId: leads.cityId,
          agentId: leads.agentId,
          status: leads.status,
          lastSimulationId: leads.lastSimulationId,
          deletedAt: leads.deletedAt,
        })
        .from(leads)
        .where(and(eq(leads.id, leadId), eq(leads.organizationId, organizationId)))
        .limit(1);

      const lead = leadRows[0];
      if (lead === undefined || lead.deletedAt !== null) {
        throw new NotFoundError(`Lead não encontrado: ${leadId}`);
      }

      // Quando a busca foi por lead, tentamos encontrar o customer vinculado.
      if (type === 'lead') {
        const customerForLead = await db
          .select({ id: customers.id })
          .from(customers)
          .where(eq(customers.primaryLeadId, leadId))
          .limit(1);

        customerId = customerForLead[0]?.id ?? null;
      }

      // -----------------------------------------------------------------------
      // 3. Resolver dados auxiliares em paralelo
      //
      // Cinco queries independentes disparadas simultaneamente via Promise.all.
      // Cada uma retorna array vazio / count 0 em caso de ausência — não lança.
      // -----------------------------------------------------------------------

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const [cityRows, agentRows, kanbanRows, simulationRows, messageCountRows] = await Promise.all(
        [
          // City name — apenas se cityId está preenchido
          lead.cityId !== null
            ? db
                .select({ name: cities.name })
                .from(cities)
                .where(eq(cities.id, lead.cityId))
                .limit(1)
            : Promise.resolve([] as Array<{ name: string }>),

          // Agent display name — apenas se agentId está preenchido
          lead.agentId !== null
            ? db
                .select({ displayName: agents.displayName })
                .from(agents)
                .where(eq(agents.id, lead.agentId))
                .limit(1)
            : Promise.resolve([] as Array<{ displayName: string }>),

          // Kanban stage name — via kanban_cards JOIN kanban_stages
          db
            .select({ stageName: kanbanStages.name })
            .from(kanbanCards)
            .innerJoin(kanbanStages, eq(kanbanCards.stageId, kanbanStages.id))
            .where(eq(kanbanCards.leadId, leadId))
            .limit(1),

          // Última simulação — apenas se lastSimulationId está preenchido
          // Inclui verificação de lead_id para consistência referencial.
          lead.lastSimulationId !== null
            ? db
                .select({
                  id: creditSimulations.id,
                  amountRequested: creditSimulations.amountRequested,
                  termMonths: creditSimulations.termMonths,
                  monthlyPayment: creditSimulations.monthlyPayment,
                  createdAt: creditSimulations.createdAt,
                  sentAt: creditSimulations.sentAt,
                })
                .from(creditSimulations)
                .where(
                  and(
                    eq(creditSimulations.id, lead.lastSimulationId),
                    // Garante que a simulação pertence a este lead (consistência referencial).
                    // Protege contra corrupção onde last_simulation_id aponta para simulação
                    // de outro lead após migração ou bug de dados.
                    eq(creditSimulations.leadId, leadId),
                  ),
                )
                .limit(1)
            : Promise.resolve(
                [] as Array<{
                  id: string;
                  amountRequested: string;
                  termMonths: number;
                  monthlyPayment: string;
                  createdAt: Date;
                  sentAt: Date | null;
                }>,
              ),

          // Contagem de mensagens (interactions) nos últimos 30 dias.
          // interactions não tem soft-delete — lead já foi verificado como ativo acima.
          db
            .select({ total: count() })
            .from(interactions)
            .where(
              and(eq(interactions.leadId, leadId), gte(interactions.createdAt, thirtyDaysAgo)),
            ),
        ],
      );

      // -----------------------------------------------------------------------
      // 4. Montar ficha resumida
      //
      // LGPD: cada campo foi revisado quanto à classificação de PII.
      // NÃO inclui: CPF, phone, email, RG, document_number, notes.
      // `name` incluído por necessidade operacional (doc 06 §7.6),
      // com base legal de legítimo interesse (doc 17 §3.3 item 1).
      // Coberto por pino.redact — nunca aparece em logs em claro.
      // -----------------------------------------------------------------------

      const cityName = cityRows[0]?.name ?? null;
      const agentName = agentRows[0]?.displayName ?? null;
      const stageName = kanbanRows[0]?.stageName ?? null;
      const simulation = simulationRows[0];
      const messagesCount = messageCountRows[0]?.total ?? 0;

      return reply.status(200).send({
        lead_id: lead.id,
        customer_id: customerId,
        name: lead.name,
        city_name: cityName,
        agent_name: agentName,
        current_stage: stageName,
        lead_status: lead.status,

        last_simulation:
          simulation !== undefined
            ? {
                simulation_id: simulation.id,
                amount_requested: simulation.amountRequested,
                term_months: simulation.termMonths,
                monthly_payment: simulation.monthlyPayment,
                created_at: toIso(simulation.createdAt) ?? new Date().toISOString(),
                sent_at: toIso(simulation.sentAt),
              }
            : null,

        // credit_analyses não existe até F4+.
        // Retornar null agora — schema documenta o contrato futuro via LastAnalysisSchema.
        // Quando a tabela existir, substituir por query à tabela credit_analyses.
        last_analysis: null,

        messages_last_30_days: messagesCount,
      });
    },
  );
};

export default internalCustomersRoutes;
