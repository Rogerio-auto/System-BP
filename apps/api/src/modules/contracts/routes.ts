// =============================================================================
// contracts/routes.ts — Rotas do módulo de contratos (F17-S03).
//
// Rotas:
//   GET    /api/contracts            — listagem com filtro status, customer_id (contracts:read)
//   POST   /api/contracts            — criar contrato draft (contracts:write)
//   GET    /api/contracts/:id        — detalhe (contracts:read)
//   POST   /api/contracts/:id/sign   — assinar (draft→signed ou signed→active) (contracts:sign)
//
// RBAC:
//   contracts:read  → GET /api/contracts, GET /api/contracts/:id
//   contracts:write → POST /api/contracts
//   contracts:sign  → POST /api/contracts/:id/sign
//
// City-scope:
//   Contratos são filtrados via customers → leads → city_id.
//   Gestor regional vê apenas contratos de clientes de suas cidades.
//   Admin / gestor_geral têm acesso global (cityScopeIds = null).
//
// LGPD:
//   Nenhuma rota expõe CPF, telefone ou nome completo.
//   contract_reference não é PII (identificador operacional do legado).
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { authenticate } from '../auth/middlewares/authenticate.js';
import { authorize } from '../auth/middlewares/authorize.js';

import {
  createContractController,
  getContractController,
  listContractsController,
  signContractController,
} from './controller.js';
import {
  ContractCreateBodySchema,
  ContractResponseSchema,
  ContractsListQuerySchema,
  ContractsListResponseSchema,
  contractIdParamSchema,
} from './schemas.js';

export const contractsRoutes: FastifyPluginAsyncZod = async (app) => {
  // Autenticação obrigatória em todas as rotas deste plugin
  app.addHook('preHandler', authenticate());

  // ---------------------------------------------------------------------------
  // GET /api/contracts
  // ---------------------------------------------------------------------------
  app.get(
    '/api/contracts',
    {
      schema: {
        tags: ['Contratos'],
        summary: 'Listar contratos',
        description:
          'Lista contratos da organização com filtro opcional por status e cliente. ' +
          'Resultado paginado, ordenado por data de criação (mais recente primeiro). ' +
          'Respeitando escopo de cidade: gestores regionais veem apenas contratos de clientes ' +
          'de suas cidades; administradores e gestores gerais têm acesso global. ' +
          'Requer permissão `contracts:read`.',
        security: [{ bearerAuth: [] }],
        querystring: ContractsListQuerySchema,
        response: {
          200: ContractsListResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['contracts:read'] })],
    },
    listContractsController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/contracts
  // ---------------------------------------------------------------------------
  app.post(
    '/api/contracts',
    {
      schema: {
        tags: ['Contratos'],
        summary: 'Criar contrato',
        description:
          'Cria um novo contrato no status `draft` para o cliente informado. ' +
          'O campo `contract_reference` é a chave de negócio do contrato (ex: "BP-2026-00123") — ' +
          'deve ser único por organização. Não pode conter CPF ou outros dados pessoais. ' +
          'Campos `product_id`, `rule_version_id` e `monthly_rate_snapshot` são opcionais ' +
          'para contratos migrados do sistema legado sem essas referências. ' +
          'Requer permissão `contracts:write`.',
        security: [{ bearerAuth: [] }],
        body: ContractCreateBodySchema,
        response: {
          201: ContractResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['contracts:write'] })],
    },
    createContractController,
  );

  // ---------------------------------------------------------------------------
  // GET /api/contracts/:id
  // ---------------------------------------------------------------------------
  app.get(
    '/api/contracts/:id',
    {
      schema: {
        tags: ['Contratos'],
        summary: 'Detalhe do contrato',
        description:
          'Retorna os dados completos de um contrato pelo seu UUID. ' +
          'Aplica escopo de cidade: gestores regionais só acessam contratos de ' +
          'clientes de suas cidades; retorna 404 se fora do escopo (sem revelar existência). ' +
          'Requer permissão `contracts:read`.',
        security: [{ bearerAuth: [] }],
        params: contractIdParamSchema,
        response: {
          200: ContractResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['contracts:read'] })],
    },
    getContractController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/contracts/:id/sign
  //
  // Transições válidas:
  //   draft  → signed  (assinatura pelo cliente — signed_at preenchido)
  //   signed → active  (ativação após desembolso)
  //   Outras → 422 VALIDATION_ERROR
  //
  // Idempotência: transição inválida (ex: signed→signed) retorna 422.
  // City-scope: valida que o contrato pertence ao escopo do usuário.
  // LGPD: evento contract.signed no outbox sem PII bruta.
  // ---------------------------------------------------------------------------
  app.post(
    '/api/contracts/:id/sign',
    {
      schema: {
        tags: ['Contratos'],
        summary: 'Assinar contrato',
        description:
          'Avança o status do contrato no ciclo de vida de assinatura. ' +
          'Transições permitidas: `draft` → `signed` (cliente assina, `signed_at` é preenchido) ' +
          'e `signed` → `active` (contrato ativado após desembolso). ' +
          'Transições inválidas (ex: contrato já ativo, cancelado ou liquidado) ' +
          'retornam HTTP 422 com descrição da transição esperada. ' +
          'A operação é registrada no log de auditoria e emite o evento `contract.signed` ' +
          'no outbox (sem dados pessoais). ' +
          'Requer permissão `contracts:sign`.',
        security: [{ bearerAuth: [] }],
        params: contractIdParamSchema,
        response: {
          200: ContractResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['contracts:sign'] })],
    },
    signContractController,
  );
};
