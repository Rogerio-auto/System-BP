// =============================================================================
// internal/leads/routes.ts — Endpoints do canal interno /internal/leads.
//
// Canal M2M: consumido pelas tools LangGraph (F3-S13, F3-S22).
// Não usa JWT — autenticação via X-Internal-Token.
//
// Registrado automaticamente pelo plugin agregador internal/index.ts via
// @fastify/autoload. O prefixo /internal/leads é injetado pelo autoload com
// base na estrutura de diretórios (modules/internal/leads/routes.ts → /leads).
//
// Endpoints registrados neste plugin (prefixo /leads via autoload):
//   POST  /get-or-create → POST  /internal/leads/get-or-create (F3-S04)
//   PATCH /:id           → PATCH /internal/leads/:id           (F3-S12)
//
// Autenticação:
//   Header X-Internal-Token = env.LANGGRAPH_INTERNAL_TOKEN. Senão 401.
//
// Dedupe (POST get-or-create):
//   Por phone_normalized + organization_id. Unique constraint na DB garante
//   atomicidade; race condition mapeada para LEAD_MERGE_REQUIRED.
//
// LGPD (doc 17 §8.1, §3.4):
//   - phone e name no body são PII — cobertos por pino.redact em app.ts.
//   - Resposta retorna apenas IDs opacos (lead_id, city_id, assigned_agent_id).
//   - city_id: lead_id é sempre UUID; city_id e assigned_agent_id podem ser null.
//   - leads.created emitido via outbox APENAS quando created=true.
//   - leads.updated emitido via outbox em toda atualização de perfil (actor: ai).
//   - audit_logs com actor_type='ai' em toda mutação do canal interno.
//   - lead_history append-only para toda mutação de perfil.
//   - Rate limit 60 req/min por IP (proteção contra loop de IA).
// =============================================================================
import { createHash } from 'node:crypto';

import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { env } from '../../../config/env.js';
import { db } from '../../../db/client.js';
import { kanbanCards, kanbanStages, leadHistory } from '../../../db/schema/index.js';
import { emit } from '../../../events/emit.js';
import { auditLog } from '../../../lib/audit.js';
import { verifyInternalToken } from '../../../lib/auth/internal-token.js';
import { NotFoundError, UnauthorizedError } from '../../../shared/errors.js';
import { findLeadById, updateLead } from '../../leads/repository.js';
import { getOrCreateLead, qualifyLead } from '../../leads/service.js';

import {
  InternalGetOrCreateLeadBodySchema,
  InternalGetOrCreateLeadResponseSchema,
  InternalLeadParamsSchema,
  InternalQualifyLeadBodySchema,
  InternalQualifyLeadParamsSchema,
  InternalQualifyLeadResponseSchema,
  InternalUpdateLeadBodySchema,
  InternalUpdateLeadResponseSchema,
} from './schemas.js';

// ---------------------------------------------------------------------------
// Plugin — registrado via autoload em internal/index.ts
// ---------------------------------------------------------------------------
// Exportação DEFAULT obrigatória para @fastify/autoload v6 (ESM).
// O autoload descobre o plugin pela presença do export default neste arquivo.
// ---------------------------------------------------------------------------

const internalLeadsRoutes: FastifyPluginAsyncZod = async (app) => {
  // -------------------------------------------------------------------------
  // POST /get-or-create
  //
  // Path final (com prefixo do autoload): POST /internal/leads/get-or-create
  //
  // Pipeline:
  //   1. Verificar X-Internal-Token → 401 se ausente/inválido.
  //   2. Validar body via Zod (Fastify aplica automaticamente).
  //   3. Chamar getOrCreateLead() no leads/service.ts.
  //   4. Retornar 200 com resultado (created: true|false).
  //
  // Erros mapeados:
  //   - INVALID_PHONE → 422.
  //   - LEAD_MERGE_REQUIRED → 409.
  //   - Zod validation → 400 VALIDATION_ERROR (pelo error handler central).
  // -------------------------------------------------------------------------
  app.post(
    '/get-or-create',
    {
      schema: {
        hide: true,
        body: InternalGetOrCreateLeadBodySchema,
        response: {
          200: InternalGetOrCreateLeadResponseSchema,
        },
      },
      config: {
        // Rate limit específico desta rota: 60 req/min por IP.
        // Protege contra loop de IA ou chamadas paralelas excessivas do LangGraph.
        rateLimit: {
          max: 60,
          timeWindow: '1 minute',
          errorResponseBuilder: (_req: unknown, context: { statusCode: number }) => {
            const err = Object.assign(
              new Error('Rate limit excedido: máximo 60 requisições por minuto.'),
              {
                statusCode: context.statusCode,
                code: 'RATE_LIMITED',
              },
            );
            return err;
          },
        },
      },
    },
    async (request, reply) => {
      // 1. Verificar X-Internal-Token (timing-safe — previne timing oracle, doc 10 §2.3).
      //    Lançamos UnauthorizedError (tratado pelo error handler central) em vez de
      //    reply.status(401).send() para evitar conflito com o tipo de resposta Zod (200 only).
      if (!verifyInternalToken(request.headers['x-internal-token'], env.LANGGRAPH_INTERNAL_TOKEN)) {
        throw new UnauthorizedError('Token interno inválido ou ausente');
      }

      const body = request.body;

      // 2. Mapear body para input do service.
      //    LGPD: phone e name são PII — não logar, cobertos pelo pino.redact.
      const result = await getOrCreateLead(
        db,
        // organizationId vem do body — consistente com /internal/simulations.
        // O LangGraph passa organization_id em cada chamada (token não carrega contexto de org).
        body.organization_id,
        {
          phone: body.phone,
          name: body.name,
          source: body.source,
          chatwootConversationId: body.chatwoot_conversation_id,
          correlationId: body.correlation_id,
          cityId: body.city_id,
        },
        request.ip,
      );

      return reply.status(200).send(result);
    },
  );

  // -------------------------------------------------------------------------
  // PATCH /:id — update_lead_profile (F3-S12)
  //
  // Path final (com prefixo do autoload): PATCH /internal/leads/:id
  //
  // Pipeline:
  //   1. Verificar X-Internal-Token → 401 se ausente/inválido.
  //   2. Validar body via Zod strict (campos desconhecidos → 422).
  //   3. Verificar existência do lead → 404 se não encontrado.
  //   4. Calcular campos alterados (changedFields).
  //   5. Em transação: updateLead + lead_history + audit_logs + outbox leads.updated.
  //   6. Retornar 200 com IDs opacos.
  //
  // Campos atualizáveis: name, city_id, requested_amount, requested_term_months.
  //   requested_amount e requested_term_months são armazenados em metadata
  //   (colunas próprias pendentes de migration futura).
  //
  // Campos NÃO atualizáveis por este endpoint: status, source, agent_id, cpf,
  //   email, phone — requerem ação humana ou fluxo CRM.
  //   Rejeitados via z.object().strict() no schema (→ 422 VALIDATION_ERROR).
  //
  // LGPD (doc 17 §8.1, §8.5):
  //   - name é PII — coberto pelo pino.redact do app.ts.
  //   - audit_logs: actor null (ação de sistema/IA) com action 'leads.update_profile'.
  //   - before/after no audit_log passam por redactLeadPii (name → '[redacted]').
  //   - lead_history: actor_user_id null (ação de sistema); metadata inclui
  //     correlation_id para rastreamento distribuído.
  //   - outbox leads.updated: sem PII bruta nos campos changes.
  //   - Resposta: apenas IDs opacos, sem PII (name, phone não retornados).
  // -------------------------------------------------------------------------
  app.patch(
    '/:id',
    {
      schema: {
        hide: true,
        params: InternalLeadParamsSchema,
        body: InternalUpdateLeadBodySchema,
        response: {
          200: InternalUpdateLeadResponseSchema,
        },
      },
      config: {
        // Mesmo rate limit do get-or-create: proteção contra loop de IA.
        rateLimit: {
          max: 60,
          timeWindow: '1 minute',
          errorResponseBuilder: (_req: unknown, context: { statusCode: number }) => {
            const err = Object.assign(
              new Error('Rate limit excedido: máximo 60 requisições por minuto.'),
              {
                statusCode: context.statusCode,
                code: 'RATE_LIMITED',
              },
            );
            return err;
          },
        },
      },
    },
    async (request, reply) => {
      // 1. Verificar X-Internal-Token (timing-safe — previne timing oracle, doc 10 §2.3).
      if (!verifyInternalToken(request.headers['x-internal-token'], env.LANGGRAPH_INTERNAL_TOKEN)) {
        throw new UnauthorizedError('Token interno inválido ou ausente');
      }

      const { id: leadId } = request.params;
      const body = request.body;

      // 2. Verificar existência do lead (pré-voo, sem transação).
      //    cityScopeIds=null: IA tem visibilidade global dentro da org.
      const existingLead = await findLeadById(db, leadId, body.organization_id, null);
      if (!existingLead) {
        throw new NotFoundError('Lead não encontrado');
      }

      // 3. Calcular campos alterados para o outbox event.
      //    PII (name) é redactado no outbox — apenas nomes de campos, sem valores.
      const changedFields: string[] = [];
      if (body.name !== undefined && body.name !== existingLead.name) {
        changedFields.push('name');
      }
      if (body.city_id !== undefined && body.city_id !== existingLead.cityId) {
        changedFields.push('city_id');
      }

      // requested_amount / requested_term_months: compara contra metadata atual.
      // `as` justificado: metadata é JSONB — Drizzle retorna unknown; cast para
      // Record<string,unknown> é seguro pois o schema garante que é objeto.
      const existingMeta =
        (existingLead.metadata as Record<string, unknown> | null | undefined) ?? {};
      if (
        body.requested_amount !== undefined &&
        body.requested_amount !== existingMeta['requested_amount']
      ) {
        changedFields.push('requested_amount');
      }
      if (
        body.requested_term_months !== undefined &&
        body.requested_term_months !== existingMeta['requested_term_months']
      ) {
        changedFields.push('requested_term_months');
      }

      // Construir metadata mesclada: preserva campos existentes, sobrescreve os novos.
      const updatedMeta: Record<string, unknown> = { ...existingMeta };
      if (body.requested_amount !== undefined) {
        updatedMeta['requested_amount'] = body.requested_amount;
      }
      if (body.requested_term_months !== undefined) {
        updatedMeta['requested_term_months'] = body.requested_term_months;
      }

      // Verificar se há efetivamente algo a atualizar.
      const hasMetaChanges =
        body.requested_amount !== undefined || body.requested_term_months !== undefined;
      const hasDirectChanges = changedFields.some((f) => ['name', 'city_id'].includes(f));

      if (changedFields.length === 0 && !hasMetaChanges) {
        // Nenhuma mudança — retornar estado atual sem transação (idempotente).
        const stageRows = await db
          .select({ stageName: kanbanStages.name })
          .from(kanbanCards)
          .innerJoin(kanbanStages, eq(kanbanCards.stageId, kanbanStages.id))
          .where(eq(kanbanCards.leadId, leadId))
          .limit(1);

        return reply.status(200).send({
          lead_id: existingLead.id,
          city_id: existingLead.cityId ?? null,
          assigned_agent_id: existingLead.agentId ?? null,
          current_stage: stageRows[0]?.stageName ?? null,
        });
      }

      // 4. Transação: update + lead_history + audit_logs + outbox.
      const result = await db.transaction(async (tx) => {
        // Monta payload de update para o repository.
        // Apenas campos reconhecidos pelo UpdateLeadInput (city_id, name).
        // requested_amount/requested_term_months vão via metadata.
        const updatePayload: Parameters<typeof updateLead>[4] = {
          updatedAt: new Date(),
          ...(body.name !== undefined && hasDirectChanges ? {} : {}),
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.city_id !== undefined ? { cityId: body.city_id } : {}),
          ...(hasMetaChanges ? { metadata: updatedMeta } : {}),
        };

        const updated = await updateLead(
          // `as` justificado: Drizzle não exporta tipo público de Transaction;
          // a transação implementa a mesma interface que Database neste contexto.
          tx as unknown as Parameters<typeof updateLead>[0],
          leadId,
          body.organization_id,
          null, // cityScopeIds null: IA tem visibilidade global na org
          updatePayload,
        );

        if (!updated) {
          // Race condition: lead foi deletado entre o pré-voo e a transação.
          throw new NotFoundError('Lead não encontrado');
        }

        // LGPD §8.5 — sanitização PII para audit_logs e lead_history.
        // name é PII (identificação direta); phone já está fora deste endpoint.
        const sanitizePii = (obj: Record<string, unknown>): Record<string, unknown> => ({
          ...obj,
          ...(obj['name'] !== undefined ? { name: '[redacted]' } : {}),
        });

        // 4a. lead_history — append-only (doc 17, leadHistory.ts).
        //     actor_user_id null = ação de sistema/IA.
        //     before/after: snapshots dos campos alterados, sem PII bruta.
        await (
          tx as unknown as {
            insert: (t: typeof leadHistory) => {
              values: (v: typeof leadHistory.$inferInsert) => Promise<unknown>;
            };
          }
        )
          .insert(leadHistory)
          .values({
            leadId,
            action: 'profile_updated_by_ai',
            before: sanitizePii({
              name: existingLead.name,
              city_id: existingLead.cityId ?? null,
              requested_amount: existingMeta['requested_amount'] ?? null,
              requested_term_months: existingMeta['requested_term_months'] ?? null,
            }),
            after: sanitizePii({
              name: body.name ?? existingLead.name,
              city_id: body.city_id ?? existingLead.cityId ?? null,
              requested_amount: updatedMeta['requested_amount'] ?? null,
              requested_term_months: updatedMeta['requested_term_months'] ?? null,
            }),
            // actor_user_id null = sistema/IA (não há usuário humano)
            actorUserId: null,
            metadata: {
              actor_type: 'ai',
              changed_fields: changedFields,
            },
          });

        // 4b. audit_logs — LGPD §8.5: actor null = sistema/IA (doc 17 §8.5).
        await auditLog(
          // `as` justificado: AuditTx é interface estrutural compatível com tx.
          tx as unknown as Parameters<typeof auditLog>[0],
          {
            organizationId: body.organization_id,
            // null = ator de sistema/IA (não há usuário humano autenticado).
            actor: null,
            action: 'leads.update_profile',
            resource: { type: 'lead', id: leadId },
            // redactLeadPii inline: name → '[redacted]', sem phone neste snapshot.
            before: sanitizePii({
              id: existingLead.id,
              organization_id: existingLead.organizationId,
              city_id: existingLead.cityId ?? null,
              name: existingLead.name,
              source: existingLead.source,
              status: existingLead.status,
              requested_amount: existingMeta['requested_amount'] ?? null,
              requested_term_months: existingMeta['requested_term_months'] ?? null,
            }),
            after: sanitizePii({
              id: updated.id,
              organization_id: updated.organizationId,
              city_id: updated.cityId ?? null,
              name: updated.name,
              source: updated.source,
              status: updated.status,
              requested_amount: updatedMeta['requested_amount'] ?? null,
              requested_term_months: updatedMeta['requested_term_months'] ?? null,
            }),
          },
        );

        // 4c. Outbox leads.updated — sem PII bruta; apenas nomes dos campos.
        //     idempotency_key inclui timestamp para evitar conflito em atualizações
        // Chave determinística: hash SHA-256 dos campos alterados (F3-S12).
        // Elimina duplicatas quando o LangGraph reemite update_lead_profile em retry.
        // Formato: lead_update_<lead_id>_<sha256(sorted_changed_fields)[:16]>
        const fieldHash = createHash('sha256')
          .update([...changedFields].sort().join(','))
          .digest('hex')
          .slice(0, 16);
        await emit(
          // `as` justificado: DrizzleTx é interface estrutural compatível com tx.
          tx as unknown as Parameters<typeof emit>[0],
          {
            eventName: 'leads.updated',
            aggregateType: 'lead',
            aggregateId: leadId,
            organizationId: body.organization_id,
            actor: { kind: 'system', id: 'langgraph', ip: request.ip },
            idempotencyKey: `lead_update_${leadId}_${fieldHash}`,
            data: {
              lead_id: leadId,
              // PII (name) redactado no outbox — apenas nomes dos campos alterados.
              changes: changedFields.map((field) => ({
                field,
                before: field === 'name' ? '[redacted]' : null,
                after: field === 'name' ? '[redacted]' : null,
              })),
            },
          },
          // Chave determinística (lead_update_<lead>_<hash dos campos>): reemitir o
          // MESMO conjunto de campos (ex.: o LangGraph reenvia update_lead_profile
          // com requested_amount null→null) colide em uq_event_outbox_idempotency.
          // Dedup como NO-OP em vez de 500 (que travava o agente → handoff). Igual
          // ao cities/identify. Fix prod 2026-07-06.
          { onConflictDoNothing: true },
        );

        // 4d. Buscar stage atual (após update, dentro da transação).
        const stageRows = await (tx as unknown as typeof db)
          .select({ stageName: kanbanStages.name })
          .from(kanbanCards)
          .innerJoin(kanbanStages, eq(kanbanCards.stageId, kanbanStages.id))
          .where(eq(kanbanCards.leadId, leadId))
          .limit(1);

        return {
          lead_id: updated.id,
          city_id: updated.cityId ?? null,
          assigned_agent_id: updated.agentId ?? null,
          current_stage: stageRows[0]?.stageName ?? null,
        };
      });

      return reply.status(200).send(result);
    },
  );

  // -------------------------------------------------------------------------
  // POST /:id/qualify — qualify_lead (F25-S03)
  //
  // Path final (com prefixo do autoload): POST /internal/leads/:id/qualify
  //
  // Pipeline:
  //   1. Verificar X-Internal-Token → 401 se ausente/inválido.
  //   2. Validar body via Zod (Fastify aplica automaticamente).
  //   3. Chamar qualifyLead() em leads/service.ts.
  //   4. Retornar 200 com resultado (idempotente).
  //
  // Idempotência:
  //   Se o lead já estiver em qualifying+, retorna o estado atual sem modificar.
  //
  // LGPD §8.5:
  //   Resposta retorna apenas IDs opacos e campos de status — sem PII.
  //   CPF, nome, telefone nunca são retornados neste endpoint.
  // -------------------------------------------------------------------------
  app.post(
    '/:id/qualify',
    {
      schema: {
        hide: true,
        params: InternalQualifyLeadParamsSchema,
        body: InternalQualifyLeadBodySchema,
        response: {
          200: InternalQualifyLeadResponseSchema,
        },
      },
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 minute',
          errorResponseBuilder: (_req: unknown, context: { statusCode: number }) => {
            const err = Object.assign(
              new Error('Rate limit excedido: máximo 60 requisições por minuto.'),
              { statusCode: context.statusCode, code: 'RATE_LIMITED' },
            );
            return err;
          },
        },
      },
    },
    async (request, reply) => {
      // 1. Verificar X-Internal-Token (timing-safe — previne timing oracle, doc 10 §2.3).
      if (!verifyInternalToken(request.headers['x-internal-token'], env.LANGGRAPH_INTERNAL_TOKEN)) {
        throw new UnauthorizedError('Token interno inválido ou ausente');
      }

      const { id: leadId } = request.params;
      const { organization_id: organizationId } = request.body;

      const result = await qualifyLead(db, leadId, organizationId);
      return reply.status(200).send(result);
    },
  );
};

export default internalLeadsRoutes;
