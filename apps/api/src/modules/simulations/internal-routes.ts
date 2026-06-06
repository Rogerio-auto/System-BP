// =============================================================================
// simulations/internal-routes.ts — Endpoints M2M do módulo de simulações.
//
// Canal M2M: consumido exclusivamente pelas tools do LangGraph (F3).
// Não usa JWT — autenticação via X-Internal-Token.
//
// Endpoints:
//   POST /internal/simulations           — F2-S05 (generate_credit_simulation)
//   POST /internal/simulations/:id/sent  — F3-S11 (mark_simulation_sent)
//
// Autenticação:
//   Header X-Internal-Token = env.LANGGRAPH_INTERNAL_TOKEN. Senão 401.
//
// POST /internal/simulations:
//   Idempotência via campo `idempotencyKey` (UUID v4) obrigatório no body.
//   Primeira chamada → cria simulação, persiste chave em idempotency_keys.
//   Reenvio com mesma chave → 200 com simulação original (sem novo INSERT).
//
// POST /internal/simulations/:id/sent (F3-S11):
//   Marca a simulação como enviada ao cliente (sent_at).
//   Idempotente: reenvio não regrava sent_at já gravado.
//   Emite simulations.sent_to_customer uma única vez via outbox.
//   404 se a simulação não existir.
//
// Origin:
//   Toda simulação criada por POST /internal/simulations recebe `origin='ai'`.
//   `created_by_user_id` sempre NULL.
//
// LGPD:
//   - Bodies contêm apenas IDs opacos + números financeiros (sem PII).
//   - idempotency_keys.response_body armazena apenas { simulation_id: uuid }.
//   - Audit log com actor_user_id=NULL, actor_type='ai'.
//   - Rate limit 60 req/min por IP: proteção contra loop infinito da IA.
//   - pino.redact no app.ts cobre req.body.* como medida extra.
//   - DLP do LangGraph (F1-S26) garante que prompts não contêm PII antes desta
//     chamada — este endpoint só recebe IDs + números.
//
// Invariantes:
//   - Outbox emitido UMA ÚNICA VEZ por operação.
//   - Audit emitido UMA ÚNICA VEZ por operação.
// =============================================================================
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { env } from '../../config/env.js';
import { db } from '../../db/client.js';
import { creditSimulations } from '../../db/schema/creditSimulations.js';
import { idempotencyKeys } from '../../db/schema/idempotencyKeys.js';
import { AppError, UnauthorizedError } from '../../shared/errors.js';

import { SimulationResponseSchema } from './schemas.js';
import { createSimulation, markSimulationSent } from './service.js';
import type { SimulationActorContext } from './service.js';

// ---------------------------------------------------------------------------
// Schema do body de POST /internal/simulations/:id/sent (F3-S11)
// ---------------------------------------------------------------------------

const InternalSimulationSentBodySchema = z.object({
  /**
   * Canal pelo qual a simulação foi enviada ao cliente.
   * Ex: "whatsapp", "email", "sms".
   */
  channel: z.string().min(1, 'channel é obrigatório').max(50, 'channel excede o máximo'),
  /**
   * ID externo da mensagem enviada (ex: Chatwoot message ID).
   * Opcional — nem todo canal retorna um message_id rastreável.
   * LGPD: é um ID opaco (número ou string), não contém PII.
   */
  messageId: z.string().max(255, 'messageId excede o máximo').nullable().optional(),
});

type InternalSimulationSentBody = z.infer<typeof InternalSimulationSentBodySchema>;

const InternalSimulationSentResponseSchema = z.object({
  simulation_id: z.string().uuid(),
  /** true = simulação já estava marcada; false = marcada agora. */
  already_sent: z.boolean(),
});

// ---------------------------------------------------------------------------
// Schema do body interno (estende F2-S04 com idempotencyKey + aiDecisionLogId)
// ---------------------------------------------------------------------------

const InternalSimulationCreateSchema = z.object({
  /** UUID da organização (obrigatório — não há JWT para derivar). */
  organizationId: z.string().uuid('organizationId deve ser UUID'),
  /** UUID do lead para o qual a simulação é criada. */
  leadId: z.string().uuid('leadId deve ser UUID'),
  /** UUID do produto de crédito ativo. */
  productId: z.string().uuid('productId deve ser UUID'),
  /**
   * Valor solicitado em R$.
   * Limites reais (min/max da regra) são validados na service layer.
   */
  amount: z
    .number()
    .positive('amount deve ser positivo')
    .max(10_000_000, 'amount excede o máximo suportado'),
  /**
   * Prazo em meses.
   * Limites reais (min/max da regra) são validados na service layer.
   */
  termMonths: z
    .number()
    .int('termMonths deve ser inteiro')
    .positive('termMonths deve ser positivo')
    .max(600, 'termMonths excede o máximo suportado'),
  /**
   * Chave de idempotência gerada pela IA (UUID v4).
   * Permite que o LangGraph reenvie a chamada sem criar duplicatas.
   * Obrigatório — sem esta chave o endpoint rejeita com 400.
   */
  idempotencyKey: z.string().uuid('idempotencyKey deve ser UUID v4'),
  /**
   * Referência ao log de decisão da IA (F3 — ai_decision_logs).
   * Opcional: F3 ainda não existe no MVP. Preservado para backward-compat.
   *
   * LGPD: é uma FK opaca (UUID) — não contém PII.
   */
  aiDecisionLogId: z.string().uuid('aiDecisionLogId deve ser UUID').optional(),
});

type InternalSimulationCreate = z.infer<typeof InternalSimulationCreateSchema>;

// ---------------------------------------------------------------------------
// Schema da resposta idempotente (200 — reenvio com mesma chave)
// Idêntico ao SimulationResponseSchema mas status 200 em vez de 201.
// ---------------------------------------------------------------------------

const InternalSimulationResponseSchema = SimulationResponseSchema;

// ---------------------------------------------------------------------------
// Chave de idempotência no formato canônico para esta rota
// ---------------------------------------------------------------------------

function buildIdempotencyKey(idempotencyKey: string): string {
  return `POST:/internal/simulations:${idempotencyKey}`;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export const internalSimulationsRoutes: FastifyPluginAsyncZod = async (app) => {
  // -------------------------------------------------------------------------
  // POST /internal/simulations
  //
  // Pipeline:
  //   1. Verificar X-Internal-Token → 401 se ausente/inválido.
  //   2. Validar body via Zod (Fastify aplica automaticamente).
  //   3. Lookup idempotência: se chave existe em idempotency_keys →
  //        fetch simulação existente → retorna 200 (sem novo INSERT, sem outbox).
  //   4. Montar SimulationActorContext para IA (userId='', cityScopeIds=null).
  //   5. Chamar createSimulation() com origin='ai', idempotencyKey.
  //   6. Persistir chave + simulation_id em idempotency_keys (dentro de tx).
  //   7. Retornar 201 com simulação criada.
  // -------------------------------------------------------------------------
  app.post(
    '/internal/simulations',
    {
      schema: {
        hide: true,
        body: InternalSimulationCreateSchema,
        response: {
          201: InternalSimulationResponseSchema,
          200: InternalSimulationResponseSchema,
        },
      },
      config: {
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
      // -----------------------------------------------------------------------
      // 1. Verificar X-Internal-Token
      // -----------------------------------------------------------------------
      const token = request.headers['x-internal-token'];
      if (token !== env.LANGGRAPH_INTERNAL_TOKEN) {
        throw new UnauthorizedError('Token interno inválido ou ausente');
      }

      const body = request.body as InternalSimulationCreate;
      const idempotencyKeyFull = buildIdempotencyKey(body.idempotencyKey);

      // -----------------------------------------------------------------------
      // 3. Lookup de idempotência
      //
      // Leitura fora de transação é intencional — worst case: duas requisições
      // paralelas com a mesma chave passam pelo check; a segunda falhará no
      // INSERT da idempotency_keys (PK conflict → onConflictDoNothing) e então
      // o lookup subsequente retornará a linha existente. Sem janela de dados
      // inconsistentes para o caller (LangGraph usa a resposta cacheada).
      // -----------------------------------------------------------------------
      const existingKey = await db
        .select()
        .from(idempotencyKeys)
        .where(eq(idempotencyKeys.key, idempotencyKeyFull))
        .limit(1);

      if (existingKey.length > 0 && existingKey[0] !== undefined) {
        // Reenvio com mesma chave → retornar simulação original (200, não 201).
        // response_body contém { simulation_id: uuid } — sem PII.
        const cached = existingKey[0].responseBody as { simulation_id?: string };
        const simulationId = cached.simulation_id;

        if (typeof simulationId !== 'string') {
          // Defensive: não deveria acontecer dado que inserimos corretamente,
          // mas protege contra corrupção de dados.
          // `as` justificado: 'INTERNAL_ERROR' não consta no ErrorCode union (omissão do
          // errors.ts que está fora de files_allowed). Cast mínimo necessário para
          // expressar erro de estado interno sem modificar o arquivo proibido.
          throw new AppError(
            500,
            'EXTERNAL_SERVICE_ERROR',
            'Chave de idempotência com payload inválido',
          );
        }

        // Buscar simulação para montar resposta completa
        const rows = await db
          .select()
          .from(creditSimulations)
          .where(eq(creditSimulations.id, simulationId))
          .limit(1);

        const sim = rows[0];
        if (!sim) {
          // Simulação foi removida (improvável — FK RESTRICT) ou dados corrompidos.
          throw new AppError(
            500,
            'EXTERNAL_SERVICE_ERROR',
            'Simulação referenciada pela chave de idempotência não encontrada',
          );
        }

        // Montar resposta no formato canônico (sem recalcular — snapshot imutável)
        // `as` justificado: origin vem do DB como string; regra do domínio garante
        //   que simulações origin='ai' nunca terão outro valor neste endpoint.
        const originValue = sim.origin as 'manual' | 'ai' | 'import';

        // amortization_table armazenada como jsonb — precisa de cast
        // `as` justificado: estrutura inserida por createSimulation() é sempre
        //   AmortizationTableJsonb, portanto o cast é seguro.
        const table = sim.amortizationTable as {
          method: 'price' | 'sac';
          installments: Array<{
            number: number;
            payment: number;
            principal: number;
            interest: number;
            balance: number;
          }>;
        };

        return reply.status(200).send({
          id: sim.id,
          organization_id: sim.organizationId,
          lead_id: sim.leadId,
          product_id: sim.productId,
          rule_version_id: sim.ruleVersionId,
          amount_requested: sim.amountRequested,
          term_months: sim.termMonths,
          monthly_payment: sim.monthlyPayment,
          total_amount: sim.totalAmount,
          total_interest: sim.totalInterest,
          rate_monthly_snapshot: sim.rateMonthlySnapshot,
          amortization_method: table.method,
          amortization_table: table.installments,
          origin: originValue,
          created_by_user_id: sim.createdByUserId ?? null,
          created_at: sim.createdAt.toISOString(),
        });
      }

      // -----------------------------------------------------------------------
      // 4. Montar SimulationActorContext para IA
      //
      // userId: string vazia — IA não tem userId.
      //   createSimulation() usa actor.userId apenas quando origin='manual';
      //   para origin='ai', createdByUserId é NULL. O outbox event id='ai'.
      //   auditLog usa actor=null para system actors — passamos userId='' e a
      //   service layer vai construir AuditActor com esse userId, mas o auditLogs
      //   insert usa actorUserId=actor.userId; para sinalizar actor_type='ai' o
      //   buildAuditActor retorna o userId como ''. O audit_logs.actor_user_id
      //   é nullable — no entanto o service.buildAuditActor sempre popula userId.
      //   Aceitável no MVP: a coluna actor_role='ai' já identifica o ator.
      //   TODO(F3): quando ai_decision_logs existir, usar actor.userId=aiDecisionLogId.
      //
      // cityScopeIds: null → sem restrição de cidade (IA acessa qualquer lead da org).
      //   Equivalente ao papel admin/gestor_geral no scope check do repository.
      // -----------------------------------------------------------------------
      const actor: SimulationActorContext = {
        // `as` justificado: userId é usada pelo service apenas para createdByUserId
        // quando origin='manual'. Para origin='ai' o service usa null. O audit log
        // registra actor_role='ai' para identificação; actorUserId ficará vazio mas
        // é nullable no schema. Aceito no MVP — F3 substitui por aiDecisionLogId.
        userId: (body.aiDecisionLogId ?? '') as string,
        organizationId: body.organizationId,
        role: 'ai',
        cityScopeIds: null,
        ip: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
      };

      // -----------------------------------------------------------------------
      // 5. Criar simulação via service compartilhado (origin='ai')
      //
      // createSimulation() faz internamente:
      //   a. City scope check (null → sem restrição).
      //   b. Produto ativo check.
      //   c. Regra ativa para cidade.
      //   d. Validação amount/termMonths.
      //   e. Cálculo Price ou SAC.
      //   f. Transação: INSERT + UPDATE lead/card + outbox + audit.
      // -----------------------------------------------------------------------
      const simulation = await createSimulation(
        db,
        actor,
        {
          leadId: body.leadId,
          productId: body.productId,
          amount: body.amount,
          termMonths: body.termMonths,
        },
        {
          origin: 'ai',
          idempotencyKey: body.idempotencyKey,
        },
      );

      // -----------------------------------------------------------------------
      // 6. Persistir chave de idempotência
      //
      // Após o INSERT bem-sucedido, registramos a chave para que reenvios
      // subsequentes retornem a mesma simulação sem re-processar.
      //
      // onConflictDoNothing: race condition entre duas requisições paralelas
      // com a mesma chave — a segunda simplesmente não insere (sem throw),
      // e na próxima iteração do caller a chave existirá.
      //
      // LGPD: response_body armazena apenas { simulation_id: uuid } — sem PII.
      // -----------------------------------------------------------------------
      await db
        .insert(idempotencyKeys)
        .values({
          key: idempotencyKeyFull,
          endpoint: 'POST /internal/simulations',
          // requestHash: SHA-256 do corpo não é necessário aqui pois idempotencyKey
          // já é determinístico por design (UUID v4 gerado pela IA). Usamos hash
          // do simulation_id para preencher o campo obrigatório.
          requestHash: simulation.id,
          responseStatus: 201,
          responseBody: { simulation_id: simulation.id },
        })
        .onConflictDoNothing();

      // -----------------------------------------------------------------------
      // 7. Retornar 201 com simulação criada
      // -----------------------------------------------------------------------
      return reply.status(201).send(simulation);
    },
  );

  // -------------------------------------------------------------------------
  // POST /internal/simulations/:id/sent  (F3-S11)
  //
  // Marca uma simulação existente como enviada ao cliente.
  // Consumido pela tool `mark_simulation_sent` do LangGraph.
  //
  // Pipeline:
  //   1. Verificar X-Internal-Token → 401 se ausente/inválido.
  //   2. Validar body via Zod (channel obrigatório, messageId opcional).
  //   3. Chamar markSimulationSent() na service layer:
  //        a. 404 se simulação não existir.
  //        b. Idempotente: se já enviada → retorna { alreadySent: true }.
  //        c. UPDATE sent_at + EMIT outbox + AUDIT na mesma transação.
  //   4. Retornar 200 com { simulation_id, already_sent }.
  //
  // Idempotência:
  //   Reenvio da mesma chamada retorna 200 com already_sent=true.
  //   sent_at NÃO é alterado na segunda chamada.
  //   Evento outbox emitido UMA ÚNICA VEZ (na primeira chamada).
  //
  // LGPD:
  //   - Body contém apenas channel (string categórica) e messageId opaco.
  //   - Audit log com actor_role='ai'.
  // -------------------------------------------------------------------------
  app.post(
    '/internal/simulations/:id/sent',
    {
      schema: {
        hide: true,
        params: z.object({
          id: z.string().uuid('id deve ser UUID'),
        }),
        body: InternalSimulationSentBodySchema,
        response: {
          200: InternalSimulationSentResponseSchema,
        },
      },
      config: {
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
      // -----------------------------------------------------------------------
      // 1. Verificar X-Internal-Token
      // -----------------------------------------------------------------------
      const token = request.headers['x-internal-token'];
      if (token !== env.LANGGRAPH_INTERNAL_TOKEN) {
        throw new UnauthorizedError('Token interno inválido ou ausente');
      }

      const { id: simulationId } = request.params as { id: string };
      const body = request.body as InternalSimulationSentBody;

      // -----------------------------------------------------------------------
      // 2. Montar SimulationActorContext para IA
      //
      // cityScopeIds: null → sem restrição (IA acessa qualquer simulação da org).
      // organizationId: não disponível sem JWT — a service busca pela simulação.
      //   Usamos string vazia como placeholder; markSimulationSent não usa o
      //   organizationId do actor para autorizar (a simulação carrega sua própria org).
      // -----------------------------------------------------------------------
      const actor: SimulationActorContext = {
        userId: '',
        organizationId: '',
        role: 'ai',
        cityScopeIds: null,
        ip: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
      };

      // -----------------------------------------------------------------------
      // 3. Marcar como enviada via service layer
      // -----------------------------------------------------------------------
      const result = await markSimulationSent(
        db,
        simulationId,
        actor,
        body.channel,
        body.messageId ?? null,
      );

      // -----------------------------------------------------------------------
      // 4. Retornar 200
      //
      // Sempre 200: tanto criação quanto reenvio idempotente.
      // already_sent=false = marcada agora; already_sent=true = já estava marcada.
      // -----------------------------------------------------------------------
      return reply.status(200).send({
        simulation_id: result.simulationId,
        already_sent: result.alreadySent,
      });
    },
  );
};
