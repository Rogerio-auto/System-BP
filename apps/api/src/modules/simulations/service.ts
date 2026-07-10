// =============================================================================
// simulations/service.ts — Regras de negócio para simulações de crédito.
//
// Responsabilidades:
//   - Validar city scope do lead (RBAC).
//   - Resolver regra ativa por cidade do lead.
//   - Validar amount/termMonths contra limites da regra.
//   - Chamar calculator (F2-S02) para calcular amortização.
//   - Persistir simulação com snapshot de rule_version_id.
//   - Atualizar leads.last_simulation_id e kanban_cards.last_simulation_id.
//   - Emitir outbox simulations.generated na mesma transação.
//   - Gerar audit log.
//
// API pública (createSimulation) aceita `origin` + `idempotencyKey` opcionais
// para que F2-S05 (internal/IA) reutilize o mesmo service.
//
// markSimulationSent (F3-S11):
//   - Marca sent_at na simulação (idempotente: NÃO regrava se já definido).
//   - Emite simulations.sent_to_customer via outbox (única vez).
//   - Retorna { alreadySent: boolean } para o endpoint controlar 200 vs 204.
//
// sendSimulation (F14-S05):
//   - Endpoint manual: POST /api/simulations/:id/send.
//   - Gated: flag simulations.send.enabled + RBAC simulations:send.
//   - Idempotência via header Idempotency-Key: não reenviar a mesma req.
//   - Monta variáveis (nome, valor, parcelas, valor_parcela, taxa) e chama
//     metaClient.sendTemplate (mesma esteira de cobrança/follow-up).
//   - Registra interação na timeline (channel whatsapp, outbound).
//   - Meta indisponível → ExternalServiceError (502) com mensagem clara.
//
// Invariantes:
//   - Simulação é snapshot imutável após criação (exceto sent_at).
//   - Outbox + audit sempre na mesma transação que a mutação.
//   - Nenhum PII bruto no payload do outbox.
//
// LGPD: lead_id, product_id, rule_version_id são IDs opacos — não são PII.
//   name + phoneE164 do lead são usados apenas para envio e nunca logados.
//   Interação registrada sem PII bruta no content (apenas IDs).
// =============================================================================
import { sql } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { interactions } from '../../db/schema/interactions.js';
import { emit } from '../../events/emit.js';
import { MetaWhatsAppClient } from '../../integrations/meta-whatsapp/client.js';
import { auditLog } from '../../lib/audit.js';
import type { AuditActor } from '../../lib/audit.js';
import { isFlagEnabled } from '../../modules/featureFlags/service.js';
import {
  AppError,
  ExternalServiceError,
  ForbiddenError,
  NotFoundError,
} from '../../shared/errors.js';
import { resolveChannelForSend } from '../channels/channel-selection.service.js';

import { calculate } from './calculator.js';
import {
  findActiveProduct,
  findActiveRuleForCity,
  findLeadForSimulation,
  findSimulationForSend,
  insertSimulation,
  updateKanbanCardLastSimulation,
  updateLeadLastSimulation,
} from './repository.js';
import type { SimulationCreate, SimulationResponse, SendSimulationResponse } from './schemas.js';
import type { AmortizationTableJsonb } from './schemas.js';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class SimulationOutOfRangError extends AppError {
  constructor(field: 'amount' | 'termMonths', min: number, max: number, actual: number) {
    super(422, 'VALIDATION_ERROR', `${field} fora dos limites da regra ativa`, {
      field,
      min,
      max,
      actual,
    });
    this.name = 'SimulationOutOfRangeError';
  }
}

export class NoActiveRuleForCityError extends AppError {
  constructor(cityId: string) {
    super(409, 'CONFLICT', 'Nenhuma regra ativa disponível para a cidade do lead', {
      code: 'no_active_rule_for_city',
      city_id: cityId,
    });
    this.name = 'NoActiveRuleForCityError';
  }
}

// ---------------------------------------------------------------------------
// Actor context
// ---------------------------------------------------------------------------

export interface SimulationActorContext {
  userId: string;
  organizationId: string;
  role: string;
  cityScopeIds: string[] | null;
  ip?: string | null;
  userAgent?: string | null;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface CreateSimulationOptions {
  /** Origem: 'manual' = UI, 'ai' = LangGraph (F2-S05). Default: 'manual'. */
  origin?: 'manual' | 'ai' | 'import';
  /**
   * Chave de idempotência para F2-S05 (IA pode reenviar com mesma chave).
   * null/undefined para origin='manual' (UI sempre cria nova simulação).
   */
  idempotencyKey?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * F25-S11 — actor_type='ai' para os audits de IA:
 *
 * Este helper é compartilhado por 3 sites de auditLog() (createSimulation,
 * markSimulationSent, sendSimulation). Não forçamos `type: 'ai'` aqui porque
 * sendSimulation() é o endpoint MANUAL (F14-S05, humano clica "enviar") — um
 * `type` fixo classificaria incorretamente ações humanas como IA.
 *
 * Em vez disso confiamos na derivação por `role` em lib/audit.ts
 * (`actor.role === 'ai' -> actor_type = 'ai'`): os únicos dois callers que
 * criam SimulationActorContext com origin='ai' (internal-routes.ts, tools da
 * IA) já setam `role: 'ai'` explicitamente — createSimulation(origin='ai') e
 * markSimulationSent(). sendSimulation() é chamado só com a role real do
 * usuário autenticado, então cai corretamente em 'user'.
 */
function buildAuditActor(actor: SimulationActorContext): AuditActor {
  return {
    // origin='ai' passa userId='' (sentinela — IA não tem usuário). audit_logs.
    // actor_user_id é uuid FK e rejeita ''; normaliza para null (actor_role='ai'
    // já identifica o ator de sistema). Ver feedback_system_actor_audit_uuid.
    userId: actor.userId || null,
    role: actor.role,
    ...(actor.ip !== undefined ? { ip: actor.ip } : {}),
    ...(actor.userAgent !== undefined ? { userAgent: actor.userAgent } : {}),
  };
}

/** Converte numeric string do DB para number. */
function parseDecimal(s: string): number {
  return parseFloat(s);
}

/** Formata number para string com precisão suficiente (até 6 casas). */
function toDecimalString(n: number, scale = 2): string {
  return n.toFixed(scale);
}

// ---------------------------------------------------------------------------
// createSimulation — endpoint público (UI via F2-S04, IA via F2-S05)
// ---------------------------------------------------------------------------

/**
 * Cria uma simulação de crédito para um lead.
 *
 * Pipeline:
 *   1. Carrega lead → city scope check.
 *   2. Carrega produto ativo → 404 se não existir/inativo.
 *   3. Resolve regra ativa por cidade → 409 se não existir.
 *   4. Valida amount/termMonths contra limites → 422 se fora.
 *   5. Calcula amortização (Price ou SAC).
 *   6. Transação: INSERT simulation + UPDATE lead/card + EMIT outbox + AUDIT.
 *   7. Retorna simulação completa.
 *
 * @throws ForbiddenError (403) — lead fora do city scope do usuário.
 * @throws NotFoundError (404) — lead ou produto não encontrado / inativo.
 * @throws NoActiveRuleForCityError (409) — sem regra para a cidade do lead.
 * @throws SimulationOutOfRangError (422) — amount ou termMonths fora dos limites.
 */
export async function createSimulation(
  db: Database,
  actor: SimulationActorContext,
  body: SimulationCreate,
  opts: CreateSimulationOptions = {},
): Promise<SimulationResponse> {
  const origin = opts.origin ?? 'manual';

  // ---------------------------------------------------------------------------
  // 1. Carregar lead com city scope check
  // ---------------------------------------------------------------------------
  const lead = await findLeadForSimulation(
    db,
    body.leadId,
    actor.organizationId,
    actor.cityScopeIds,
  );

  if (!lead) {
    // Retorna 403 (não 404) para não vazar existência do lead fora do scope.
    // Spec: "lead fora do escopo do usuário → 403".
    throw new ForbiddenError('Lead não encontrado ou fora do escopo do usuário');
  }

  // ---------------------------------------------------------------------------
  // 2. Carregar produto ativo
  // ---------------------------------------------------------------------------
  const product = await findActiveProduct(db, body.productId, actor.organizationId);
  if (!product) {
    throw new NotFoundError('Produto de crédito não encontrado ou inativo');
  }

  // ---------------------------------------------------------------------------
  // 3. Resolver regra ativa para a cidade do lead
  // ---------------------------------------------------------------------------
  // cityId nullable (F3-S01): lead criado pelo agente IA pode não ter cidade ainda.
  // Simulação requer cidade identificada — regra de negócio: não pode simular sem cidade.
  if (!lead.cityId) {
    throw new NoActiveRuleForCityError('unknown');
  }
  const rule = await findActiveRuleForCity(db, product.id, lead.cityId);
  if (!rule) {
    throw new NoActiveRuleForCityError(lead.cityId);
  }

  // ---------------------------------------------------------------------------
  // 4. Validar amount e termMonths contra limites da regra
  // ---------------------------------------------------------------------------
  const minAmount = parseDecimal(rule.minAmount);
  const maxAmount = parseDecimal(rule.maxAmount);
  const minTerm = rule.minTermMonths;
  const maxTerm = rule.maxTermMonths;

  if (body.amount < minAmount || body.amount > maxAmount) {
    throw new SimulationOutOfRangError('amount', minAmount, maxAmount, body.amount);
  }

  if (body.termMonths < minTerm || body.termMonths > maxTerm) {
    throw new SimulationOutOfRangError('termMonths', minTerm, maxTerm, body.termMonths);
  }

  // ---------------------------------------------------------------------------
  // 5. Calcular amortização
  // ---------------------------------------------------------------------------
  const monthlyRate = parseDecimal(rule.monthlyRate);
  // `as` justificado: rule.amortization vem do DB como string — é validado
  // pelo schema Zod na criação da regra como 'price' | 'sac'.
  const amortizationMethod = rule.amortization as 'price' | 'sac';

  const calcResult = calculate({
    amount: body.amount,
    termMonths: body.termMonths,
    monthlyRate,
    method: amortizationMethod,
  });

  // Primeira parcela como monthly_payment (Price: todas iguais; SAC: maior)
  const firstInstallment = calcResult.installments[0];
  // Defensive: calculator always returns at least 1 installment when valid
  if (!firstInstallment) {
    throw new AppError(500, 'VALIDATION_ERROR', 'Falha interna no cálculo da simulação');
  }
  const monthlyPayment = firstInstallment.payment;

  const amortizationTableJsonb: AmortizationTableJsonb = {
    method: calcResult.method,
    amount: calcResult.amount,
    termMonths: calcResult.termMonths,
    monthlyRate: calcResult.monthlyRate,
    installments: calcResult.installments,
    totalPayment: calcResult.totalPayment,
    totalInterest: calcResult.totalInterest,
  };

  // ---------------------------------------------------------------------------
  // 6. Transação: INSERT + UPDATE lead/card + EMIT + AUDIT
  // ---------------------------------------------------------------------------
  const simulation = await db.transaction(async (tx) => {
    // 6a. INSERT credit_simulation
    const created = await insertSimulation(tx as unknown as Database, {
      organizationId: actor.organizationId,
      leadId: body.leadId,
      productId: body.productId,
      ruleVersionId: rule.id,
      amountRequested: toDecimalString(body.amount, 2),
      termMonths: body.termMonths,
      monthlyPayment: toDecimalString(monthlyPayment, 2),
      totalAmount: toDecimalString(calcResult.totalPayment, 2),
      totalInterest: toDecimalString(calcResult.totalInterest, 2),
      rateMonthlySnapshot: toDecimalString(monthlyRate, 6),
      amortizationTable: amortizationTableJsonb,
      origin,
      createdByUserId: origin === 'manual' ? actor.userId : null,
    });

    // 6b. UPDATE leads.last_simulation_id
    await updateLeadLastSimulation(tx as unknown as Database, body.leadId, created.id);

    // 6c. UPDATE kanban_cards.last_simulation_id (sem falhar se card não existe)
    await updateKanbanCardLastSimulation(tx as unknown as Database, body.leadId, created.id);

    // 6d. EMIT outbox simulations.generated (sem PII)
    await emit(tx as unknown as Parameters<typeof emit>[0], {
      eventName: 'simulations.generated',
      aggregateType: 'credit_simulation',
      aggregateId: created.id,
      organizationId: actor.organizationId,
      actor: { kind: origin === 'ai' ? 'ai' : 'user', id: actor.userId, ip: actor.ip ?? null },
      idempotencyKey: `simulations.generated:${created.id}`,
      data: {
        simulation_id: created.id,
        lead_id: body.leadId,
        product_id: body.productId,
        rule_version_id: rule.id,
        amount: body.amount,
        term_months: body.termMonths,
        monthly_payment: monthlyPayment,
        origin,
      },
    });

    // 6e. AUDIT LOG
    await auditLog(tx as unknown as Parameters<typeof auditLog>[0], {
      organizationId: actor.organizationId,
      actor: buildAuditActor(actor),
      action: 'credit_simulation.create',
      resource: { type: 'credit_simulation', id: created.id },
      before: null,
      after: {
        simulation_id: created.id,
        lead_id: body.leadId,
        product_id: body.productId,
        rule_version_id: rule.id,
        amount_requested: created.amountRequested,
        term_months: created.termMonths,
        origin,
      },
    });

    return created;
  });

  // ---------------------------------------------------------------------------
  // 7. Montar resposta
  // ---------------------------------------------------------------------------
  return {
    id: simulation.id,
    organization_id: simulation.organizationId,
    lead_id: simulation.leadId,
    product_id: simulation.productId,
    rule_version_id: simulation.ruleVersionId,
    amount_requested: simulation.amountRequested,
    term_months: simulation.termMonths,
    monthly_payment: simulation.monthlyPayment,
    total_amount: simulation.totalAmount,
    total_interest: simulation.totalInterest,
    rate_monthly_snapshot: simulation.rateMonthlySnapshot,
    amortization_method: amortizationMethod,
    amortization_table: amortizationTableJsonb.installments,
    origin: simulation.origin as 'manual' | 'ai' | 'import',
    created_by_user_id: simulation.createdByUserId ?? null,
    created_at: simulation.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// markSimulationSent — endpoint interno (IA via F3-S11)
// ---------------------------------------------------------------------------

/** Resultado de markSimulationSent. */
export interface MarkSimulationSentResult {
  /** true = simulação já estava marcada como enviada (reenvio idempotente). */
  alreadySent: boolean;
  /** UUID da simulação marcada. */
  simulationId: string;
  /** lead_id da simulação (para o outbox). */
  leadId: string;
  /** organization_id da simulação (para o outbox). */
  organizationId: string;
}

/**
 * Marca uma simulação como enviada ao cliente.
 *
 * Idempotente: se sent_at já estiver definido, retorna { alreadySent: true }
 * sem alterar o registro nem emitir novo evento via outbox.
 *
 * Pipeline:
 *   1. Busca simulação por ID → 404 se não existir.
 *   2. Se sent_at já definido → retorna { alreadySent: true } sem transação.
 *   3. Transação:
 *      a. UPDATE credit_simulations SET sent_at = NOW() WHERE id = $1 AND sent_at IS NULL
 *         → condição WHERE sent_at IS NULL garante idempotência sob race condition.
 *      b. EMIT simulations.sent_to_customer via outbox.
 *      c. AUDIT LOG.
 *   4. Retorna { alreadySent: false, ... }.
 *
 * Nota sobre sent_at:
 *   A coluna sent_at foi adicionada pela migration 0023_simulation_sent_at.sql.
 *   Por decisão de minimizar diff no schema tipado (creditSimulations.ts fora
 *   do files_allowed deste slot), usamos raw SQL via drizzle sql`` template.
 *   O typecheck passa pois sql`` retorna SQL<unknown> — sem acesso a coluna tipada.
 *
 * @param db            Instância Drizzle (não transação — a função cria internamente).
 * @param simulationId  UUID da simulação a marcar.
 * @param actor         Contexto do actor (IA — sem userId real).
 * @param channel       Canal de envio ("whatsapp", "email" etc.).
 * @param messageId     ID externo da mensagem (opcional — ex: Chatwoot message ID).
 *
 * @throws NotFoundError (404) — simulação não existe.
 */
export async function markSimulationSent(
  db: Database,
  simulationId: string,
  actor: SimulationActorContext,
  channel: string,
  messageId: string | null,
): Promise<MarkSimulationSentResult> {
  // ---------------------------------------------------------------------------
  // 1. Busca simulação por ID filtrado por organization_id (SEC-04)
  //
  // Filtra WHERE id = $1 AND organization_id = $2 para impedir que uma tool
  // da IA de org A marque simulações de org B (isolamento multi-tenant).
  // actor.organizationId é preenchido pelo endpoint via header X-Organization-Id.
  //
  // Usamos sql`` para acessar sent_at sem o schema tipado.
  // `as` justificado: drizzle sql`` retorna Row[] genérico; sentAt é nullable
  //   timestamp coerced pelo driver pg para Date | null.
  // ---------------------------------------------------------------------------
  const rows = await db.execute(
    sql`SELECT id, lead_id, organization_id, sent_at
        FROM credit_simulations
        WHERE id = ${simulationId}
          AND organization_id = ${actor.organizationId}
        LIMIT 1`,
  );

  type SimulationRow = {
    id: string;
    lead_id: string;
    organization_id: string;
    sent_at: Date | null;
  };

  const row = rows.rows[0] as SimulationRow | undefined;

  if (!row) {
    // 404 (não 403) — não vaza existência de simulações de outra org.
    throw new NotFoundError(`Simulação ${simulationId} não encontrada`);
  }

  // ---------------------------------------------------------------------------
  // 2. Idempotência: sent_at já definido → reenvio, não emitir novo evento
  // ---------------------------------------------------------------------------
  if (row.sent_at !== null) {
    return {
      alreadySent: true,
      simulationId: row.id,
      leadId: row.lead_id,
      organizationId: row.organization_id,
    };
  }

  // ---------------------------------------------------------------------------
  // 3. Transação: UPDATE + EMIT + AUDIT
  // ---------------------------------------------------------------------------
  await db.transaction(async (tx) => {
    // 3a. UPDATE sent_at (WHERE sent_at IS NULL garante idempotência sob race)
    await tx.execute(
      sql`UPDATE credit_simulations
          SET sent_at = NOW()
          WHERE id = ${simulationId} AND sent_at IS NULL`,
    );

    // 3b. EMIT simulations.sent_to_customer (sem PII)
    await emit(tx as unknown as Parameters<typeof emit>[0], {
      eventName: 'simulations.sent_to_customer',
      aggregateType: 'credit_simulation',
      aggregateId: simulationId,
      organizationId: row.organization_id,
      actor: { kind: 'ai', id: actor.userId || null, ip: actor.ip ?? null },
      // Chave determinística: simulação enviada acontece uma única vez.
      idempotencyKey: `simulations.sent_to_customer:${simulationId}`,
      data: {
        simulation_id: simulationId,
        lead_id: row.lead_id,
        channel,
        message_id: messageId,
      },
    });

    // 3c. AUDIT LOG
    await auditLog(tx as unknown as Parameters<typeof auditLog>[0], {
      organizationId: row.organization_id,
      actor: buildAuditActor(actor),
      action: 'credit_simulation.sent',
      resource: { type: 'credit_simulation', id: simulationId },
      before: { sent_at: null },
      after: {
        simulation_id: simulationId,
        lead_id: row.lead_id,
        channel,
        message_id: messageId,
      },
    });
  });

  return {
    alreadySent: false,
    simulationId: row.id,
    leadId: row.lead_id,
    organizationId: row.organization_id,
  };
}

// ---------------------------------------------------------------------------
// sendSimulation — endpoint manual POST /api/simulations/:id/send (F14-S05)
// ---------------------------------------------------------------------------

/**
 * Opções de injeção para sendSimulation (facilitam testes unitários).
 * Em produção, metaClient é criado internamente.
 *
 * `metaClient` aceita `undefined` explicitamente para compatibilidade com
 * `exactOptionalPropertyTypes: true` — usar `undefined` significa "criar do env".
 */
export interface SendSimulationOptions {
  /** Chave de idempotência do header Idempotency-Key (UUID). */
  idempotencyKey: string;
  /**
   * UUID do canal WhatsApp a usar (F20-S05: multi-canal).
   * null/undefined = usar canal padrão ou primeiro ativo da organização.
   * LGPD: channelId é ID técnico, não PII — pode ser logado.
   */
  channelId?: string | null;
  /**
   * MetaWhatsAppClient injetável para testes.
   * undefined | null = usar banco (resolveChannelForSend).
   */
  metaClient?: MetaWhatsAppClient | null | undefined;
}

/**
 * Envia a simulação para o lead via WhatsApp (template `simulacao_resultado`).
 *
 * Pipeline:
 *   1. Feature flag (4 camadas — guard na rota + verificação na service layer).
 *   2. Carrega simulação (org scope) + lead (city scope) → 404/403 se não encontrado.
 *   3. Verifica idempotência: se já existe interação com este Idempotency-Key
 *      (external_ref) → retorna { status: 'already_sent', sent_message_id: null }.
 *   4. Constrói variáveis do template a partir dos dados da simulação.
 *   5. Obtém/verifica MetaWhatsAppClient → ExternalServiceError se não configurado.
 *   6. Chama metaClient.sendTemplate → ExternalServiceError em falha de rede/Meta.
 *   7. Transação: INSERT interaction (outbound, whatsapp) + EMIT outbox + AUDIT.
 *   8. Retorna { status: 'sent', sent_message_id: wamid }.
 *
 * Idempotência:
 *   A tabela interactions tem UNIQUE (channel, external_ref) WHERE external_ref IS NOT NULL.
 *   O external_ref é o Idempotency-Key prefixado: 'simulations.send:<idempotencyKey>'.
 *   Antes do envio verificamos a existência do external_ref para evitar re-disparar
 *   a Meta desnecessariamente (custo por template message).
 *
 * LGPD:
 *   - name e phoneE164 do lead são usados apenas para envio — nunca logados.
 *   - O content da interaction armazena 'Simulação [id] enviada por WhatsApp' (sem PII).
 *   - O outbox payload contém apenas IDs opacos (simulation_id, lead_id).
 *   - Valores financeiros (amount, rate) não são PII.
 *
 * @throws ForbiddenError (403)        — lead fora do city scope.
 * @throws NotFoundError (404)         — simulação ou lead não encontrado.
 * @throws ExternalServiceError (502)  — Meta não configurada ou falha de rede.
 */
export async function sendSimulation(
  db: Database,
  actor: SimulationActorContext,
  simulationId: string,
  opts: SendSimulationOptions,
): Promise<SendSimulationResponse> {
  // ---------------------------------------------------------------------------
  // 1. Verificação da flag na service layer (segunda camada — a primeira é o
  //    featureGate() no preHandler da rota).
  //    Fail-closed: se a flag não existe no banco, bloqueia.
  // ---------------------------------------------------------------------------
  const { enabled: flagEnabled } = await isFlagEnabled(db, 'simulations.send.enabled');
  if (!flagEnabled) {
    throw new ExternalServiceError(
      'Funcionalidade de envio de simulação está desabilitada (flag simulations.send.enabled)',
      { flag: 'simulations.send.enabled' },
    );
  }

  // ---------------------------------------------------------------------------
  // 2. Carregar simulação (org scope) + lead (city scope)
  // ---------------------------------------------------------------------------
  const sim = await findSimulationForSend(db, simulationId, actor.organizationId);
  if (!sim) {
    throw new NotFoundError(`Simulação ${simulationId} não encontrada`);
  }

  // Carregar lead com city scope check
  const lead = await findLeadForSimulation(
    db,
    sim.leadId,
    actor.organizationId,
    actor.cityScopeIds,
  );
  if (!lead) {
    // Retorna 403 para não vazar existência do lead fora do scope
    throw new ForbiddenError('Lead não encontrado ou fora do escopo do usuário');
  }

  // Lead precisa ter telefone para envio via WhatsApp
  if (!lead.phoneE164) {
    throw new AppError(
      422,
      'VALIDATION_ERROR',
      'Lead não possui número de telefone cadastrado — não é possível enviar via WhatsApp',
      { code: 'lead_no_phone' },
    );
  }

  // ---------------------------------------------------------------------------
  // 3. Idempotência: verificar se já existe interação com este Idempotency-Key
  // ---------------------------------------------------------------------------
  const externalRef = `simulations.send:${opts.idempotencyKey}`;
  const existingRows = await db.execute(
    sql`SELECT id FROM interactions
        WHERE channel = 'whatsapp'
          AND external_ref = ${externalRef}
        LIMIT 1`,
  );

  if ((existingRows.rows[0] as { id?: string } | undefined)?.id !== undefined) {
    return { status: 'already_sent', sent_message_id: null };
  }

  // ---------------------------------------------------------------------------
  // 4. Construir variáveis do template
  //
  // Template `simulacao_resultado` — variáveis (ordem posicional):
  //   {{1}} nome_cliente      — lead.name (PII — nunca logado)
  //   {{2}} valor_solicitado  — amount_requested formatado em BRL
  //   {{3}} num_parcelas      — term_months
  //   {{4}} valor_parcela     — monthly_payment formatado em BRL
  //   {{5}} taxa_mensal       — rate_monthly_snapshot como percentual
  //
  // LGPD: nome_cliente é PII mas é enviado PARA o próprio titular —
  //   tratamento legítimo de dado pessoal (art. 7º, III LGPD — execução de contrato).
  //   Não é logado aqui (apenas em body HTTP — MetaWhatsAppClient não loga `to` nem body).
  // ---------------------------------------------------------------------------
  function formatBrl(numericStr: string): string {
    const value = parseFloat(numericStr);
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  }

  function formatRate(numericStr: string): string {
    const value = parseFloat(numericStr) * 100;
    return `${value.toFixed(2).replace('.', ',')}%`;
  }

  const templateVariables = [
    { type: 'text' as const, text: lead.name },
    { type: 'text' as const, text: formatBrl(sim.amountRequested) },
    { type: 'text' as const, text: String(sim.termMonths) },
    { type: 'text' as const, text: formatBrl(sim.monthlyPayment) },
    { type: 'text' as const, text: formatRate(sim.rateMonthlySnapshot) },
  ];

  // ---------------------------------------------------------------------------
  // 5. Obter MetaWhatsAppClient
  //
  //    F20-S05: credenciais resolvidas da tabela channels (não de env vars).
  //    Prioridade: opts.metaClient (injeção p/ testes) → resolveChannelForSend.
  //
  //    resolveChannelForSend lança ExternalServiceError se org sem canal ativo.
  //    LGPD: channelId logado pelo channel-selection.service; accessToken NUNCA.
  // ---------------------------------------------------------------------------
  let metaClient: MetaWhatsAppClient;
  // `opts.metaClient` pode ser undefined (não passado), null (explícito) ou instance.
  // Com exactOptionalPropertyTypes, verificamos ambos undefined e null.
  const injectedClient = opts.metaClient;
  if (injectedClient !== undefined && injectedClient !== null) {
    metaClient = injectedClient;
  } else {
    // Resolve credenciais do canal no banco — ExternalServiceError se sem canal ativo.
    const resolved = await resolveChannelForSend(db, actor.organizationId, opts.channelId ?? null);
    metaClient = new MetaWhatsAppClient({
      accessToken: resolved.accessToken,
      phoneNumberId: resolved.phoneNumberId,
    });
  }

  // ---------------------------------------------------------------------------
  // 6. Enviar template via Meta
  //    ExternalServiceError propagada em falha de rede / resposta de erro Meta.
  // ---------------------------------------------------------------------------
  let wamid: string;
  try {
    const result = await metaClient.sendTemplate({
      // phoneE164 garantido acima — `as` justificado: narrowing já verificado
      to: lead.phoneE164 as string,
      templateName: 'simulacao_resultado',
      language: 'pt_BR',
      components:
        templateVariables.length > 0 ? [{ type: 'body', parameters: templateVariables }] : [],
    });
    wamid = result.wamid;
  } catch (err) {
    if (err instanceof ExternalServiceError) {
      throw new ExternalServiceError(
        `Falha ao enviar simulação via WhatsApp: ${err.message}`,
        err.details,
      );
    }
    throw err;
  }

  // ---------------------------------------------------------------------------
  // 7. Transação: INSERT interaction + EMIT outbox + AUDIT
  // ---------------------------------------------------------------------------
  await db.transaction(async (tx) => {
    const txDb = tx as unknown as Database;

    // 7a. Gravar channel_id na simulação (F20-S05: auditoria de canal).
    //     SQL raw: gravamos o channelId do opts para rastreabilidade do canal usado.
    //     LGPD: channel_id é ID técnico — não é PII.
    if (opts.channelId !== null && opts.channelId !== undefined) {
      await txDb.execute(
        sql`UPDATE credit_simulations
            SET channel_id = ${opts.channelId}::uuid
            WHERE id = ${simulationId}`,
      );
    }

    // 7b. INSERT interaction (channel whatsapp, outbound)
    //     external_ref = idempotency key → dedupe pela unique constraint
    //     content: sem PII bruta — apenas IDs opacos
    await txDb.insert(interactions).values({
      leadId: sim.leadId,
      organizationId: actor.organizationId,
      channel: 'whatsapp',
      direction: 'outbound',
      content: `Simulação ${simulationId} enviada por WhatsApp (wamid: ${wamid})`,
      externalRef: externalRef,
      metadata: {
        template: 'simulacao_resultado',
        wamid,
        simulation_id: simulationId,
        idempotency_key: opts.idempotencyKey,
      },
    });

    // 7c. EMIT simulations.sent_to_customer (sem PII)
    //     Reutiliza o evento já tipado no AppEventDataMap (events/types.ts).
    //     message_id = wamid retornado pela Meta.
    await emit(txDb as unknown as Parameters<typeof emit>[0], {
      eventName: 'simulations.sent_to_customer',
      aggregateType: 'credit_simulation',
      aggregateId: simulationId,
      organizationId: actor.organizationId,
      actor: { kind: 'user', id: actor.userId, ip: actor.ip ?? null },
      idempotencyKey: `simulations.sent_to_customer:${opts.idempotencyKey}`,
      data: {
        simulation_id: simulationId,
        lead_id: sim.leadId,
        channel: 'whatsapp',
        message_id: wamid,
      },
    });

    // 7d. AUDIT LOG
    await auditLog(txDb as unknown as Parameters<typeof auditLog>[0], {
      organizationId: actor.organizationId,
      actor: buildAuditActor(actor),
      action: 'credit_simulation.sent_via_whatsapp',
      resource: { type: 'credit_simulation', id: simulationId },
      before: null,
      after: {
        simulation_id: simulationId,
        lead_id: sim.leadId,
        channel: 'whatsapp',
        wamid,
        idempotency_key: opts.idempotencyKey,
      },
    });
  });

  return { status: 'sent', sent_message_id: wamid };
}
