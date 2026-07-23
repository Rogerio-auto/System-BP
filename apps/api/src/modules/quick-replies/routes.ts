// =============================================================================
// quick-replies/routes.ts — Rotas do módulo de respostas rápidas (F28-S03,
// F28-S04).
//
// Endpoints:
//   GET    /api/quick-replies                    — lista visíveis ao ator (org ∪ próprias)
//   GET    /api/quick-replies/:id                 — detalhe
//   POST   /api/quick-replies                     — cria (organization exige manage; personal exige write)
//   PATCH  /api/quick-replies/:id                  — atualização parcial
//   DELETE /api/quick-replies/:id                  — soft-delete
//   PATCH  /api/quick-replies/reorder              — reordenação em lote (exige manage)
//   POST   /api/quick-replies/uploads/signed-url   — signed URL de upload de mídia (F28-S04, exige write)
//   POST   /api/quick-replies/:id/used             — telemetria de uso (F28-S04, exige read)
//
// RBAC (doc 25 §5):
//   - Leitura: livechat:quick_reply:read.
//   - Escrita (POST/PATCH/DELETE por id): write OU manage no mínimo — a
//     decisão fina (qual das duas é exigida para o registro específico) é
//     do service, que conhece o dono/visibilidade do registro (authorizeAny
//     aqui é só o piso: quem não tem NENHUMA das duas nem chega ao service).
//   - Reordenar: manage.
//   - Signed URL de upload: write (mesmo piso de criar/editar resposta pessoal).
//   - Telemetria de uso: read (a regra fina de visibilidade — não tocar
//     resposta pessoal de outro — é do service/repository, não da rota).
//
// Feature flag: livechat.quick_replies.enabled em TODAS as rotas — flag
// desligada retorna 403 feature_disabled antes de qualquer outra checagem.
//
// Validação de body (POST/PATCH): `attachValidation: true` — o Fastify NÃO
// rejeita automaticamente o body malformado; o schema continua declarado
// para a documentação OpenAPI, mas quem valida de fato é o service (via
// quickReplyCreateSchema/UpdateSchema + extractQuickReplyErrorCode), que
// assim consegue responder 422 com o código estável do catálogo de
// variáveis (QUICK_REPLY_UNKNOWN_VARIABLE/MISSING_FALLBACK/etc.) em vez do
// 400 genérico que a validação automática do Fastify produziria. Mesmo
// precedente de modules/templates/routes.ts (body validado no controller).
// O body de /uploads/signed-url segue o MESMO padrão (quickReplySignedUrlBodySchema
// tem superRefine para QUICK_REPLY_MEDIA_TOO_LARGE — precisa do mesmo bypass
// para responder 422 com o código estável em vez de 400 genérico).
// =============================================================================
import {
  quickReplyCreateSchema,
  quickReplyListQuerySchema,
  quickReplyListResponseSchema,
  quickReplyResponseSchema,
  quickReplySignedUrlBodySchema,
  quickReplyUpdateSchema,
} from '@elemento/shared-schemas';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { featureGate } from '../../plugins/featureGate.js';
import { authenticate } from '../auth/middlewares/authenticate.js';
import { authorize, authorizeAny } from '../auth/middlewares/authorize.js';

import {
  createQuickReplyController,
  deleteQuickReplyController,
  getQuickReplyController,
  listQuickRepliesController,
  markQuickReplyUsedController,
  requestQuickReplyUploadSignedUrlController,
  reorderQuickRepliesController,
  updateQuickReplyController,
} from './controller.js';
import {
  quickReplyIdParamSchema,
  quickReplyReorderBodySchema,
  quickReplySignedUrlResponseSchema,
} from './schemas.js';
import { MANAGE_PERMISSION, READ_PERMISSION, WRITE_PERMISSION } from './service.js';

const FLAG = 'livechat.quick_replies.enabled';
const READ_PERMS: [string, ...string[]] = [READ_PERMISSION];
const WRITE_PERMS: [string, ...string[]] = [WRITE_PERMISSION];
const WRITE_OR_MANAGE_PERMS: [string, ...string[]] = [WRITE_PERMISSION, MANAGE_PERMISSION];
const MANAGE_PERMS: [string, ...string[]] = [MANAGE_PERMISSION];

const reorderResponseSchema = z.object({
  updated: z.number().int().nonnegative().describe('Quantidade de respostas rápidas reordenadas'),
});

export const quickRepliesRoutes: FastifyPluginAsyncZod = async (app) => {
  // Autenticação obrigatória em todas as rotas deste plugin.
  app.addHook('preHandler', authenticate());

  // ---------------------------------------------------------------------------
  // GET /api/quick-replies — lista
  // ---------------------------------------------------------------------------
  app.get(
    '/api/quick-replies',
    {
      schema: {
        tags: ['Quick Replies'],
        summary: 'Listar respostas rápidas',
        description:
          'Lista as respostas rápidas visíveis ao operador autenticado: a biblioteca da ' +
          'organização (curada pela gestão) somada às respostas pessoais do próprio operador. ' +
          'Nunca inclui respostas pessoais de outro operador. Suporta busca (título/corpo/' +
          'categoria), filtros por visibilidade/categoria/status e paginação por cursor. ' +
          'A ordenação padrão é sort_order, uso (usage_count) e título. `city_ids` é um filtro ' +
          'de conveniência de exibição aplicado automaticamente ao escopo de cidade do ator — ' +
          'nunca uma fronteira de segurança.',
        security: [{ bearerAuth: [] }],
        querystring: quickReplyListQuerySchema,
        response: { 200: quickReplyListResponseSchema },
      },
      preHandler: [authorize({ permissions: READ_PERMS }), featureGate(FLAG)],
    },
    listQuickRepliesController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/quick-replies — criar
  // Registrado ANTES de PATCH /reorder não é necessário (métodos diferentes),
  // mas mantido na ordem lógica do CRUD.
  // ---------------------------------------------------------------------------
  app.post(
    '/api/quick-replies',
    {
      attachValidation: true,
      schema: {
        tags: ['Quick Replies'],
        summary: 'Criar resposta rápida',
        description:
          'Cria uma resposta rápida. `visibility="organization"` (biblioteca curada, visível a ' +
          'toda a organização) exige a permissão `manage`. `visibility="personal"` (biblioteca ' +
          'própria) exige `write` — o dono é sempre o próprio operador autenticado, nunca um ' +
          'valor vindo do body. O corpo aceita variáveis do catálogo fechado (`{{contato.nome|' +
          'fallback}}` etc.) — variáveis desconhecidas ou sem fallback obrigatório são ' +
          'rejeitadas com 422. O corpo não pode conter CPF, CNPJ, e-mail ou telefone do cidadão.',
        security: [{ bearerAuth: [] }],
        body: quickReplyCreateSchema,
        response: { 201: quickReplyResponseSchema },
      },
      preHandler: [authorizeAny({ permissions: WRITE_OR_MANAGE_PERMS }), featureGate(FLAG)],
    },
    createQuickReplyController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/quick-replies/uploads/signed-url — assina upload de mídia (F28-S04)
  // Path estático ("uploads") — o roteador do Fastify prioriza segmentos
  // estáticos sobre parâmetros, então não colide com GET/PATCH/DELETE /:id.
  // ---------------------------------------------------------------------------
  app.post(
    '/api/quick-replies/uploads/signed-url',
    {
      attachValidation: true,
      schema: {
        tags: ['Quick Replies'],
        summary: 'Assinar upload de mídia para a biblioteca de respostas rápidas',
        description:
          'Gera uma URL pré-assinada (PUT) para upload direto de mídia ao storage, para uso no ' +
          'cadastro (criação/edição) de uma resposta rápida. Fase 1 de um upload em duas fases — ' +
          'o browser faz o PUT diretamente na `uploadUrl` retornada, sem passar pelo backend, e ' +
          'em seguida usa `publicMediaUrl` como `mediaUrl` no POST/PATCH da resposta rápida. ' +
          'A key do objeto usa o prefixo `quick-replies/{organizationId}/{uuid}{ext}` — distinto ' +
          'do prefixo `outbound/` do live chat, pois mídia de biblioteca é ativo institucional, ' +
          'não dado de conversa sujeito a retenção de atendimento. MIME e tamanho são validados ' +
          'contra os mesmos limites do live chat (imagem 5MB, áudio/vídeo 16MB, documento 50MB).',
        security: [{ bearerAuth: [] }],
        body: quickReplySignedUrlBodySchema,
        response: { 200: quickReplySignedUrlResponseSchema },
      },
      preHandler: [authorize({ permissions: WRITE_PERMS }), featureGate(FLAG)],
    },
    requestQuickReplyUploadSignedUrlController,
  );

  // ---------------------------------------------------------------------------
  // PATCH /api/quick-replies/reorder — reordenação em lote
  // Registrada ANTES de PATCH /:id para não ser capturada como um UUID de id.
  // ---------------------------------------------------------------------------
  app.patch(
    '/api/quick-replies/reorder',
    {
      schema: {
        tags: ['Quick Replies'],
        summary: 'Reordenar respostas rápidas',
        description:
          'Atualiza `sort_order` em lote para respostas rápidas da biblioteca da organização ' +
          '(visibility="organization"). Exige a permissão `manage`. Todos os ids devem existir, ' +
          'pertencer à organização do ator e ser org-wide (não pessoais) — caso contrário a ' +
          'operação inteira é rejeitada (atômica).',
        security: [{ bearerAuth: [] }],
        body: quickReplyReorderBodySchema,
        response: { 200: reorderResponseSchema },
      },
      preHandler: [authorize({ permissions: MANAGE_PERMS }), featureGate(FLAG)],
    },
    reorderQuickRepliesController,
  );

  // ---------------------------------------------------------------------------
  // GET /api/quick-replies/:id — detalhe
  // ---------------------------------------------------------------------------
  app.get(
    '/api/quick-replies/:id',
    {
      schema: {
        tags: ['Quick Replies'],
        summary: 'Obter resposta rápida',
        description:
          'Retorna uma resposta rápida pelo id. Só é visível se for da organização (curada) ou ' +
          'pertencer ao próprio operador — resposta pessoal de outro operador retorna 404 (não ' +
          'revela existência).',
        security: [{ bearerAuth: [] }],
        params: quickReplyIdParamSchema,
        response: { 200: quickReplyResponseSchema },
      },
      preHandler: [authorize({ permissions: READ_PERMS }), featureGate(FLAG)],
    },
    getQuickReplyController,
  );

  // ---------------------------------------------------------------------------
  // PATCH /api/quick-replies/:id — atualizar
  // ---------------------------------------------------------------------------
  app.patch(
    '/api/quick-replies/:id',
    {
      attachValidation: true,
      schema: {
        tags: ['Quick Replies'],
        summary: 'Atualizar resposta rápida',
        description:
          'Atualiza parcialmente uma resposta rápida. Editar uma resposta da organização (atual ' +
          'ou resultante da mudança de visibilidade) exige `manage`; editar a própria resposta ' +
          'pessoal exige `write`. As mesmas validações de criação se aplicam ao corpo quando ' +
          'fornecido (catálogo de variáveis, ausência de PII, mídia consistente).',
        security: [{ bearerAuth: [] }],
        params: quickReplyIdParamSchema,
        body: quickReplyUpdateSchema,
        response: { 200: quickReplyResponseSchema },
      },
      preHandler: [authorizeAny({ permissions: WRITE_OR_MANAGE_PERMS }), featureGate(FLAG)],
    },
    updateQuickReplyController,
  );

  // ---------------------------------------------------------------------------
  // DELETE /api/quick-replies/:id — remover (soft-delete)
  // ---------------------------------------------------------------------------
  app.delete(
    '/api/quick-replies/:id',
    {
      schema: {
        tags: ['Quick Replies'],
        summary: 'Remover resposta rápida',
        description:
          'Remove (soft-delete) uma resposta rápida. Exige `manage` para respostas da ' +
          'organização e `write` para a própria resposta pessoal.',
        security: [{ bearerAuth: [] }],
        params: quickReplyIdParamSchema,
        response: { 204: { description: 'Removida com sucesso.' } },
      },
      preHandler: [authorizeAny({ permissions: WRITE_OR_MANAGE_PERMS }), featureGate(FLAG)],
    },
    deleteQuickReplyController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/quick-replies/:id/used — telemetria de uso (F28-S04)
  // ---------------------------------------------------------------------------
  app.post(
    '/api/quick-replies/:id/used',
    {
      schema: {
        tags: ['Quick Replies'],
        summary: 'Registrar uso de uma resposta rápida',
        description:
          'Incrementa `usage_count` e grava `last_used_at`. Chamado pelo cliente de forma ' +
          '"fire-and-forget" logo após o envio de uma mensagem originada de uma resposta rápida ' +
          '— uma falha aqui nunca desfaz nem bloqueia o envio já realizado. Sem `Idempotency-Key`: ' +
          'o contador é aproximado por natureza. Só é possível incrementar respostas visíveis ao ' +
          'operador (da organização ou da própria biblioteca pessoal) — tentar marcar o uso de ' +
          'uma resposta pessoal de outro operador retorna 404 (não revela existência).',
        security: [{ bearerAuth: [] }],
        params: quickReplyIdParamSchema,
        response: { 204: { description: 'Uso registrado com sucesso.' } },
      },
      preHandler: [authorize({ permissions: READ_PERMS }), featureGate(FLAG)],
    },
    markQuickReplyUsedController,
  );
};
