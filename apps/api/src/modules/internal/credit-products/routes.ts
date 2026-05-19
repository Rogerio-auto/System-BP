// =============================================================================
// internal/credit-products/routes.ts — GET /internal/credit-products (F3-S06).
//
// Canal M2M: consumido pela tool `list_credit_products` (LangGraph, F3-S15).
// Não usa JWT — autenticação via X-Internal-Token.
//
// Registrado automaticamente pelo plugin agregador internal/index.ts via
// @fastify/autoload. O prefixo /internal/credit-products é injetado pelo
// autoload com base na estrutura de diretórios:
//   modules/internal/credit-products/routes.ts → prefix /internal/credit-products
//
// Endpoints registrados neste plugin (prefixo /credit-products via autoload):
//   GET / → GET /internal/credit-products (path final)
//
// Autenticação:
//   Header X-Internal-Token = env.LANGGRAPH_INTERNAL_TOKEN. Senão 401.
//
// Lógica de filtragem:
//   1. Busca todos os produtos is_active=true da organização.
//      Como este é um endpoint M2M (sem JWT), a organização é derivada do
//      query param `organizationId` que a IA passa em cada chamada.
//      Sem organizationId, retorna lista vazia (não expõe dados multi-tenant).
//   2. Filtra por cityId: inclui produtos cuja regra ativa tem cityScope
//      contendo o cityId informado OU cityScope null (produto global).
//   3. Produtos sem regra ativa publicada são excluídos (a IA não pode simular
//      sem taxa/limites definidos).
//
// Payload seguro (doc 06 §5.6):
//   Sem campos internos sensíveis. Apenas o necessário para simular:
//   id, name, min_amount, max_amount, min_term, max_term,
//   interest_rate (monthlyRate), amortization_type.
//
// LGPD: nenhum dado sensível neste endpoint.
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { env } from '../../../config/env.js';
import { db } from '../../../db/client.js';
import { UnauthorizedError } from '../../../shared/errors.js';
import { findProducts } from '../../credit-products/repository.js';

import {
  InternalCreditProductsQuerySchema,
  InternalCreditProductsResponseSchema,
} from './schemas.js';

// ---------------------------------------------------------------------------
// Plugin — registrado via autoload em internal/index.ts
// ---------------------------------------------------------------------------
// Exportação DEFAULT obrigatória para @fastify/autoload v6 (ESM).
// O autoload descobre o plugin pela presença do export default neste arquivo.
// ---------------------------------------------------------------------------

const internalCreditProductsRoutes: FastifyPluginAsyncZod = async (app) => {
  // -------------------------------------------------------------------------
  // GET /
  //
  // Path final (com prefixo do autoload): GET /internal/credit-products
  //
  // Query params:
  //   - organizationId (UUID, obrigatório): multi-tenant — a IA passa por chamada.
  //   - cityId         (UUID, opcional):   filtra produtos disponíveis para a cidade.
  //
  // Pipeline:
  //   1. Verificar X-Internal-Token → 401 se ausente/inválido.
  //   2. Validar querystring via Zod (Fastify aplica automaticamente).
  //   3. Chamar findProducts() com is_active=true da organização.
  //   4. Filtrar por cityId se informado.
  //   5. Excluir produtos sem regra ativa.
  //   6. Mapear para payload seguro (campos internos removidos).
  //   7. Retornar 200 com array de produtos.
  //
  // Decisão de design — organizationId no querystring (não no body de GET):
  //   Tokens internos M2M não carregam contexto de organização.
  //   O LangGraph passa organizationId em cada chamada (padrão consistente
  //   com POST /internal/leads/get-or-create que passa no body).
  //   Para GET, querystring é o veículo correto (REST semântico).
  //   Sem organizationId → lista vazia (sem erro) para não expor dados cross-tenant.
  // -------------------------------------------------------------------------
  app.get(
    '/',
    {
      schema: {
        // organizationId e cityId definidos em InternalCreditProductsQuerySchema.
        // Ambos opcionais no schema Zod para comportamento gracioso:
        //   - sem organizationId → lista vazia (proteção cross-tenant).
        //   - sem cityId → retorna todos os produtos ativos sem filtro de cidade.
        querystring: InternalCreditProductsQuerySchema,
        response: {
          200: InternalCreditProductsResponseSchema,
        },
      },
    },
    async (request, reply) => {
      // 1. Verificar X-Internal-Token
      //    Lançamos UnauthorizedError (tratado pelo error handler central) para
      //    resposta consistente com outros endpoints internos.
      const token = request.headers['x-internal-token'];
      if (token !== env.LANGGRAPH_INTERNAL_TOKEN) {
        throw new UnauthorizedError('Token interno inválido ou ausente');
      }

      const { organizationId, cityId } = request.query;

      // 2. Sem organizationId → retorna lista vazia (proteção multi-tenant).
      if (organizationId === undefined) {
        return reply.status(200).send({ data: [] });
      }

      // 3. Buscar todos os produtos ativos da organização.
      //    Usa limit=1000 para cobrir catálogos reais (Banco do Povo tem <50 produtos).
      //    findProducts retorna cada produto com activeRule inlinado.
      const { data: products } = await findProducts(db, organizationId, {
        page: 1,
        limit: 1000,
        is_active: true,
        include_deleted: false,
      });

      // 4. Filtrar: apenas produtos com regra ativa publicada.
      //    Produto ativo mas sem regra = sem taxa/limites → não pode ser simulado.
      const withActiveRule = products.filter((p) => p.activeRule !== null);

      // 5. Filtrar por cityId se informado.
      //    Inclui produtos com cityScope null (global) ou cityScope contendo o cityId.
      const filtered =
        cityId !== undefined
          ? withActiveRule.filter((p) => {
              const scope = p.activeRule?.cityScope;
              // cityScope null/undefined = produto global (não restrito a cidade)
              if (scope === null || scope === undefined) return true;
              return scope.includes(cityId);
            })
          : withActiveRule;

      // 6. Mapear para payload seguro (doc 06 §5.6).
      //    Remove campos internos: organization_id, key, description, created_at,
      //    updated_at, deleted_at, versão/datas da regra, city_scope, iof_rate.
      const data = filtered.map((p) => {
        // activeRule é non-null aqui (filtrado em passo 4)
        // `as` justificado: filtro acima garante activeRule !== null, mas
        // TypeScript não estreita o tipo do campo inlinado no objeto composto.
        const rule = p.activeRule!;

        return {
          id: p.id,
          name: p.name,
          min_amount: rule.minAmount,
          max_amount: rule.maxAmount,
          min_term: rule.minTermMonths,
          max_term: rule.maxTermMonths,
          interest_rate: rule.monthlyRate,
          amortization_type: rule.amortization as 'price' | 'sac',
        };
      });

      return reply.status(200).send({ data });
    },
  );
};

export default internalCreditProductsRoutes;
