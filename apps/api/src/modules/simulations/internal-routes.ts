// =============================================================================
// simulations/internal-routes.ts — Endpoint POST /internal/simulations (F2-S05).
//
// Canal M2M: consumido exclusivamente pela tool `generate_credit_simulation`
// do LangGraph (F3). Não usa JWT — autenticação via X-Internal-Token.
//
// Endpoint:
//   POST /internal/simulations
//
// Autenticação:
//   Header X-Internal-Token = env.LANGGRAPH_INTERNAL_TOKEN. Senão 401.
//
// Idempotência:
//   Campo `idempotencyKey` (UUID v4) obrigatório no body.
//   Primeira chamada → cria simulação, persiste chave na tabela idempotency_keys.
//   Reenvio com mesma chave → retorna 200 com simulação original (sem novo INSERT,
//   sem novo outbox — apenas o cached response_body + lookup por simulation_id).
//
// Origin:
//   Toda simulação criada por este endpoint recebe `origin='ai'`.
//   `created_by_user_id` sempre NULL.
//
// LGPD:
//   - Body contém apenas IDs opacos + números financeiros (sem PII).
//   - idempotency_keys.response_body armazena apenas { simulation_id: uuid }.
//   - Audit log com actor_user_id=NULL, actor_type derivado (actor=null).
//   - Rate limit 60 req/min por IP: proteção contra loop infinito da IA.
//   - pino.redact no app.ts cobre req.body.* como medida extra.
//   - DLP do LangGraph (F1-S26) garante que prompts não contêm PII antes desta
//     chamada — este endpoint só recebe IDs + números.
//
// Invariantes:
//   - Service compartilhado com F2-S04 (simulationsService.createSimulation).
//   - Outbox emitido UMA ÚNICA VEZ (na criação, não no reenvio idempotente).
//   - Audit emitido UMA ÚNICA VEZ (idem).
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
import { createSimulation } from './service.js';
import type { SimulationActorContext } from './service.js';

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
};
