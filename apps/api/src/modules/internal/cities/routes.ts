// =============================================================================
// internal/cities/routes.ts — Endpoint POST /internal/cities/identify (F3-S05).
//
// Canal M2M: consumido pela tool `identify_city` (F3-S14, LangGraph).
// Não usa JWT — autenticação via X-Internal-Token.
//
// Registrado automaticamente pelo plugin agregador internal/index.ts via
// @fastify/autoload. O prefixo /internal/cities é injetado pelo autoload com
// base na estrutura de diretórios (modules/internal/cities/routes.ts → /cities).
//
// Endpoint registrado neste plugin (prefixo /cities via autoload):
//   POST /identify → POST /internal/cities/identify (path final)
//
// Autenticação:
//   Header X-Internal-Token = env.LANGGRAPH_INTERNAL_TOKEN. Senão → 401.
//
// Regras de matching (doc 06 §7.2):
//   - confidence >= 0.85 → matched: true. Evento cities.identified emitido
//     quando lead_id informado.
//   - confidence <  0.85 → matched: false + alternatives (top 3).
//   - Cidade fora do atendimento (is_active: false) → matched: false,
//     out_of_service: true.
//
// Fuzzy match:
//   - pg_trgm similarity() + unaccent() em cities.name_normalized e aliases[].
//   - Index GIN trgm em name_normalized acelera a busca (0002_cities_agents.sql).
//
// Outbox:
//   - cities.identified emitido em db.transaction quando matched: true e
//     lead_id presente.
//   - Sem evento quando matched: false — LangGraph pergunta confirmação.
//
// LGPD (doc 17 §8.5):
//   - city_text é texto livre — não armazenado, usado só para matching.
//   - source_text no payload do evento contém o city_text original (dado público
//     de localização — não é PII conforme §8.5: não identifica pessoa, apenas lugar).
//   - Resposta retorna apenas IDs e nomes de município (dados públicos).
// =============================================================================

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { env } from '../../../config/env.js';
import { db } from '../../../db/client.js';
import { emit } from '../../../events/emit.js';
import { verifyInternalToken } from '../../../lib/auth/internal-token.js';
import { UnauthorizedError } from '../../../shared/errors.js';
import { findActiveCities, findCitiesByFuzzyMatch } from '../../cities/repository.js';

import {
  InternalIdentifyCityBodySchema,
  InternalIdentifyCityResponseSchema,
  InternalListCitiesQuerySchema,
  InternalListCitiesResponseSchema,
} from './schemas.js';

// ---------------------------------------------------------------------------
// Limiar de confiança (doc 06 §7.2)
// ---------------------------------------------------------------------------
const CONFIDENCE_THRESHOLD = 0.85;

// ---------------------------------------------------------------------------
// Plugin — registrado via autoload em internal/index.ts
// ---------------------------------------------------------------------------
// Exportação DEFAULT obrigatória para @fastify/autoload v6 (ESM).
// ---------------------------------------------------------------------------

const internalCitiesRoutes: FastifyPluginAsyncZod = async (app) => {
  // -------------------------------------------------------------------------
  // POST /identify
  //
  // Path final (com prefixo do autoload): POST /internal/cities/identify
  //
  // Pipeline:
  //   1. Verificar X-Internal-Token → 401 se ausente/inválido.
  //   2. Validar body via Zod (Fastify aplica automaticamente).
  //   3. Executar fuzzy match via findCitiesByFuzzyMatch().
  //   4. Avaliar resultado:
  //      a. Nenhum candidato → matched: false (out_of_service detectado adiante).
  //      b. Melhor candidato is_active: false → out_of_service: true.
  //      c. confidence >= 0.85 → matched: true. Emitir cities.identified se lead_id.
  //      d. confidence <  0.85 → matched: false + alternatives top-3.
  //   5. Retornar 200 com resultado.
  //
  // Nota sobre out_of_service:
  //   O fuzzy match inclui cidades inativas (is_active=false) mas exclui soft-deleted.
  //   Se o melhor candidato for inativo, reportamos out_of_service: true ao LangGraph.
  //   O LangGraph trata esse fluxo com mensagem de "cidade não atendida".
  // -------------------------------------------------------------------------
  app.post(
    '/identify',
    {
      schema: {
        hide: true,
        body: InternalIdentifyCityBodySchema,
        response: {
          200: InternalIdentifyCityResponseSchema,
        },
      },
    },
    async (request, reply) => {
      // 1. Verificar X-Internal-Token (timing-safe — previne timing oracle, doc 10 §2.3).
      if (!verifyInternalToken(request.headers['x-internal-token'], env.LANGGRAPH_INTERNAL_TOKEN)) {
        throw new UnauthorizedError('Token interno inválido ou ausente');
      }

      const { lead_id, organization_id, city_text } = request.body;

      // 2. Executar fuzzy match
      //    Solicitamos limit=4: melhor candidato + até 3 alternativas.
      const candidates = await findCitiesByFuzzyMatch(db, organization_id, city_text, 4);

      // 3. Sem candidatos → matched: false, sem alternativas
      if (candidates.length === 0) {
        return reply.status(200).send({
          city_id: null,
          city_name: null,
          matched: false,
          confidence: 0,
          out_of_service: false,
          alternatives: [],
        });
      }

      // Melhor candidato sempre é o primeiro (ORDER BY similarity DESC na query)
      // noUncheckedIndexedAccess: candidates[0] pode ser undefined — uso de non-null
      // é seguro aqui porque verificamos length > 0 acima.
      // `as` justificado: TypeScript com noUncheckedIndexedAccess torna o tipo
      // `FuzzyCityCandidate | undefined` — checamos length > 0 antes, portanto
      // a asserção é segura e semanticamente correta.
      const best = candidates[0] as NonNullable<(typeof candidates)[0]>;

      // 4a. Melhor candidato é cidade inativa → fora do atendimento
      if (!best.is_active) {
        return reply.status(200).send({
          city_id: null,
          city_name: null,
          matched: false,
          confidence: best.similarity,
          out_of_service: true,
          alternatives: [],
        });
      }

      // 4b. Confiança suficiente → matched: true
      if (best.similarity >= CONFIDENCE_THRESHOLD) {
        // Emitir cities.identified via outbox se lead_id presente
        if (lead_id !== undefined) {
          await db.transaction(async (tx) => {
            await emit(tx, {
              eventName: 'cities.identified',
              aggregateType: 'city',
              aggregateId: best.id,
              organizationId: organization_id,
              actor: { kind: 'ai', id: null, ip: null },
              // Chave determinística: mesma combinação lead+city → mesmo evento no outbox.
              // Elimina duplicatas quando o LangGraph reemite identify_city em retry (F3-S05).
              idempotencyKey: `city_identify_${lead_id}_${best.id}`,
              data: {
                lead_id,
                city_id: best.id,
                confidence: best.similarity,
                // source_text: dado de localização público — não PII (doc 17 §8.5)
                source_text: city_text,
              },
            });
          });
        }

        return reply.status(200).send({
          city_id: best.id,
          city_name: best.name,
          matched: true,
          confidence: best.similarity,
          out_of_service: false,
          alternatives: [],
        });
      }

      // 4c. Confiança insuficiente → matched: false + alternativas (top 3 ativos)
      const alternatives = candidates
        // Exclui o best (já reportado como principal) e cidades inativas
        .filter((c) => c.is_active)
        .slice(0, 3)
        .map((c) => ({
          city_id: c.id,
          city_name: c.name,
          confidence: c.similarity,
        }));

      return reply.status(200).send({
        city_id: null,
        city_name: null,
        matched: false,
        confidence: best.similarity,
        out_of_service: false,
        alternatives,
      });
    },
  );

  // -------------------------------------------------------------------------
  // GET / → GET /internal/cities
  //
  // Lista as cidades ATIVAS da org (cobertura atual de atendimento). Consumida
  // pela tool `list_active_cities` do agente para informar a cobertura ao
  // cliente e validar dinamicamente — reflete ativar/desativar cidade no painel
  // em tempo real, sem redeploy nem mexer no prompt.
  // -------------------------------------------------------------------------
  app.get(
    '/',
    {
      schema: {
        hide: true,
        querystring: InternalListCitiesQuerySchema,
        response: {
          200: InternalListCitiesResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!verifyInternalToken(request.headers['x-internal-token'], env.LANGGRAPH_INTERNAL_TOKEN)) {
        throw new UnauthorizedError('Token interno inválido ou ausente');
      }

      const { organization_id } = request.query;
      const rows = await findActiveCities(db, organization_id);

      return reply.status(200).send({
        cities: rows.map((c) => ({ city_id: c.id, city_name: c.name })),
      });
    },
  );
};

export default internalCitiesRoutes;
