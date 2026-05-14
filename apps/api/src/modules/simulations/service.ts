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
// Invariantes:
//   - Simulação é snapshot imutável após criação.
//   - Outbox + audit sempre na mesma transação que o INSERT.
//   - Nenhum PII bruto no payload do outbox.
//
// LGPD: lead_id, product_id, rule_version_id são IDs opacos — não são PII.
// =============================================================================
import type { Database } from '../../db/client.js';
import { emit } from '../../events/emit.js';
import { auditLog } from '../../lib/audit.js';
import type { AuditActor } from '../../lib/audit.js';
import { AppError, ForbiddenError, NotFoundError } from '../../shared/errors.js';

import { calculate } from './calculator.js';
import {
  findActiveProduct,
  findActiveRuleForCity,
  findLeadForSimulation,
  insertSimulation,
  updateKanbanCardLastSimulation,
  updateLeadLastSimulation,
} from './repository.js';
import type { SimulationCreate, SimulationResponse } from './schemas.js';
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

function buildAuditActor(actor: SimulationActorContext): AuditActor {
  return {
    userId: actor.userId,
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
