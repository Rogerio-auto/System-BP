// =============================================================================
// customers/law-firm-referral.service.ts — Regras de negócio para encaminhamento
// de clientes para escritórios de advocacia (F19-S03).
//
// Responsabilidades:
//   - createReferralService: canal humano (POST /api/customers/:id/law-firm-referral)
//     * Verifica feature flag law_firm.referral.enabled
//     * Verifica cooldown ativo (409 LAW_FIRM_COOLDOWN)
//     * Verifica existência de customer e law_firm no org-scope
//     * Insere referral + emite outbox + audit_log na mesma transação
//   - checkLawFirmStatusService: canal IA (GET /internal/law-firm-status)
//     * Verifica feature flag law_firm.ai_handoff.enabled
//     * Verifica cooldown ativo
//     * Verifica parcelas em atraso (overdue) do customer
//     * Retorna eligibility + dados do escritório (sem PII do customer)
//   - createAiReferralService: canal IA (POST /internal/customers/:id/law-firm-referral)
//     * Mesma lógica do canal humano mas linked_by = null
//     * Registra em ai_decision_logs
//
// LGPD (doc 17 §8.5 + §12):
//   - Evento outbox: sem PII do customer (apenas IDs opacos).
//   - /internal: sem PII do customer na resposta (apenas dados do escritório, que é PJ).
//   - audit_log: before/after sem PII sensível (apenas IDs e metadados operacionais).
//   - Base legal: Art. 7º V LGPD — execução de contrato (cobrança judicial).
// =============================================================================
import type { Database } from '../../db/client.js';
import { aiDecisionLogs } from '../../db/schema/aiDecisionLogs.js';
import { emit } from '../../events/emit.js';
import { auditLog } from '../../lib/audit.js';
import { AppError, NotFoundError } from '../../shared/errors.js';
import { isFlagEnabled } from '../featureFlags/service.js';
import { findDefaultLawFirmForCity } from '../law-firms/repository.js';

import {
  checkReferralCooldown,
  customerExistsInOrg,
  customerHasOverdueDues,
  findCustomerCityIdForReferral,
  findLawFirmForReferral,
  insertReferral,
} from './law-firm-referral.repository.js';
import type {
  CreateAiReferralResponse,
  CreateReferralBody,
  CreateReferralResponse,
  LawFirmStatusResponse,
} from './law-firm-referral.schemas.js';

// ---------------------------------------------------------------------------
// Erros de domínio
// ---------------------------------------------------------------------------

/**
 * 409 — Cooldown ativo: customer já foi encaminhado recentemente (< 7 dias).
 */
export class LawFirmCooldownError extends AppError {
  constructor(cooldownUntil: string) {
    super(409, 'LAW_FIRM_COOLDOWN', 'Cliente em período de cooldown — aguarde o prazo expirar.', {
      cooldown_until: cooldownUntil,
    });
    this.name = 'LawFirmCooldownError';
  }
}

/**
 * 403 — Feature flag desabilitada.
 */
export class FeatureDisabledError extends AppError {
  constructor(flagKey: string) {
    super(
      403,
      'FEATURE_DISABLED',
      `Funcionalidade desabilitada: flag '${flagKey}' está desligada.`,
    );
    this.name = 'FeatureDisabledError';
  }
}

// ---------------------------------------------------------------------------
// Contexto do ator humano
// ---------------------------------------------------------------------------

export interface HumanActorContext {
  userId: string;
  organizationId: string;
  role: string;
  ip?: string | null;
  userAgent?: string | null;
}

// ---------------------------------------------------------------------------
// createReferralService — Canal humano
// ---------------------------------------------------------------------------

/**
 * Encaminha um cliente para um escritório de advocacia (canal humano).
 *
 * Pipeline:
 *   1. Verificar feature flag law_firm.referral.enabled → 403 se desabilitada.
 *   2. Verificar cooldown ativo → 409 LAW_FIRM_COOLDOWN se bloqueado.
 *   3. Verificar customer no org-scope → 404 se não encontrado.
 *   4. Verificar law_firm no org-scope → 404 se não encontrado.
 *   5. Transação:
 *      a. INSERT customer_law_firm_referrals (channel='human', linked_by=userId).
 *      b. emit outbox 'customer.law_firm_referred' (sem PII).
 *      c. auditLog (action='customer.law_firm_referral').
 *   6. Retornar { ok: true, referral_id, cooldown_until }.
 *
 * LGPD: evento outbox contém apenas IDs opacos — sem nome/CPF/telefone do customer.
 * Base legal: Art. 7º V LGPD — execução de contrato (cobrança judicial).
 */
export async function createReferralService(
  db: Database,
  actor: HumanActorContext,
  customerId: string,
  body: CreateReferralBody,
): Promise<CreateReferralResponse> {
  // 1. Feature flag — verificar antes de qualquer query ao banco
  const { enabled } = await isFlagEnabled(db, 'law_firm.referral.enabled');
  if (!enabled) {
    throw new FeatureDisabledError('law_firm.referral.enabled');
  }

  // 2. Cooldown — verificar se customer já foi encaminhado nos últimos 7 dias
  const cooldown = await checkReferralCooldown(db, customerId, actor.organizationId);
  if (cooldown.active && cooldown.cooldownUntil !== null) {
    throw new LawFirmCooldownError(cooldown.cooldownUntil);
  }

  // 3. Verificar existência do customer no org-scope
  const customerExists = await customerExistsInOrg(db, customerId, actor.organizationId);
  if (!customerExists) {
    // 404 (não 403) — não vaza existência de recursos de outras orgs
    throw new NotFoundError('Cliente não encontrado');
  }

  // 4. Verificar existência do law_firm no org-scope
  const lawFirm = await findLawFirmForReferral(db, body.law_firm_id, actor.organizationId);
  if (lawFirm === null) {
    throw new NotFoundError('Escritório de advocacia não encontrado');
  }

  // 5. Transação: INSERT + emit outbox + audit_log
  const referral = await db.transaction(async (tx) => {
    // a. Inserir encaminhamento (channel='human', linked_by=userId)
    const inserted = await insertReferral(tx as unknown as Database, {
      organizationId: actor.organizationId,
      customerId,
      lawFirmId: body.law_firm_id,
      linkedBy: actor.userId,
      channel: 'human',
      notes: body.notes ?? null,
    });

    // b. Emitir evento outbox (LGPD §8.5 — sem PII bruta)
    //    Payload: IDs opacos + canal + sent_at. Sem nome/CPF/telefone do customer.
    //    O worker que consome o evento hidrata dados via /internal/customers/:id.
    //    sent_at = linked_at ≈ now() no momento da inserção.
    const sentAt = new Date().toISOString();
    await emit(tx as unknown as Parameters<typeof emit>[0], {
      eventName: 'customer.law_firm_referred',
      aggregateType: 'customer',
      aggregateId: customerId,
      organizationId: actor.organizationId,
      actor: { kind: 'user', id: actor.userId, ip: actor.ip ?? null },
      idempotencyKey: `customer.law_firm_referred:${inserted.id}`,
      data: {
        referral_id: inserted.id,
        customer_id: customerId,
        law_firm_id: body.law_firm_id,
        organization_id: actor.organizationId,
        channel: 'human' as const,
        sent_at: sentAt,
      },
    });

    // c. Audit log — sem PII do customer na serialização (apenas IDs operacionais)
    await auditLog(tx as unknown as Parameters<typeof auditLog>[0], {
      organizationId: actor.organizationId,
      actor: {
        userId: actor.userId,
        role: actor.role,
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
      },
      action: 'customer.law_firm_referral',
      resource: { type: 'customer', id: customerId },
      before: null,
      // after: metadados do encaminhamento (sem PII do customer)
      after: {
        referral_id: inserted.id,
        law_firm_id: body.law_firm_id,
        channel: 'human',
        cooldown_until: inserted.cooldownUntil,
      },
    });

    return inserted;
  });

  return {
    ok: true,
    referral_id: referral.id,
    cooldown_until: referral.cooldownUntil,
  };
}

// ---------------------------------------------------------------------------
// checkLawFirmStatusService — GET /internal/law-firm-status
// ---------------------------------------------------------------------------

/**
 * Verifica elegibilidade de encaminhamento para advocacia (para o LangGraph).
 *
 * Pipeline:
 *   1. Verificar feature flag law_firm.ai_handoff.enabled.
 *   2. Verificar cooldown ativo.
 *   3. Verificar se customer tem parcelas overdue (elegibilidade de cobrança judicial).
 *   4. Buscar city_id do customer (via lead primário).
 *   5. Buscar escritório padrão para a cidade.
 *   6. Retornar { eligible, law_firm, cooldown_until, reason }.
 *
 * LGPD (doc 17 §8.5):
 *   - A resposta NÃO contém nome/CPF/telefone do customer.
 *   - law_firm.contact_phone é dado público de PJ — não é PII pessoal.
 *   - customer_id não é incluído na resposta (o LangGraph já tem o id da chamada).
 */
export async function checkLawFirmStatusService(
  db: Database,
  customerId: string,
  organizationId: string,
): Promise<LawFirmStatusResponse> {
  // 1. Feature flag law_firm.ai_handoff.enabled
  const { enabled: flagEnabled } = await isFlagEnabled(db, 'law_firm.ai_handoff.enabled');
  if (!flagEnabled) {
    return {
      eligible: false,
      law_firm: null,
      cooldown_until: null,
      reason: 'flag_disabled',
    };
  }

  // 2. Cooldown ativo
  const cooldown = await checkReferralCooldown(db, customerId, organizationId);
  if (cooldown.active && cooldown.cooldownUntil !== null) {
    return {
      eligible: false,
      law_firm: null,
      cooldown_until: cooldown.cooldownUntil,
      reason: 'cooldown_active',
    };
  }

  // 3. Verificar parcelas overdue (pré-requisito para encaminhamento judicial)
  const hasOverdue = await customerHasOverdueDues(db, customerId, organizationId);
  if (!hasOverdue) {
    return {
      eligible: false,
      law_firm: null,
      cooldown_until: null,
      reason: 'no_overdue_dues',
    };
  }

  // 4. Buscar city_id do customer (via lead primário)
  const cityId = await findCustomerCityIdForReferral(db, customerId, organizationId);
  if (cityId === null) {
    // Customer não encontrado ou sem cidade → sem cobertura
    return {
      eligible: false,
      law_firm: null,
      cooldown_until: null,
      reason: 'no_coverage',
    };
  }

  // 5. Buscar escritório padrão para a cidade
  const firm = await findDefaultLawFirmForCity(db, organizationId, cityId);
  if (firm === null) {
    return {
      eligible: false,
      law_firm: null,
      cooldown_until: null,
      reason: 'no_coverage',
    };
  }

  // 6. Elegível — retornar dados do escritório (sem PII do customer)
  return {
    eligible: true,
    law_firm: {
      id: firm.id,
      name: firm.name,
      contact_phone: firm.contactPhone ?? null,
    },
    cooldown_until: null,
    reason: 'ok',
  };
}

// ---------------------------------------------------------------------------
// createAiReferralService — Canal IA
// ---------------------------------------------------------------------------

/**
 * Encaminha um cliente para um escritório de advocacia (canal IA / LangGraph).
 *
 * Diferenças do canal humano:
 *   - linked_by = null (sem usuário humano).
 *   - channel = 'ai'.
 *   - Registra em ai_decision_logs (auditoria de decisão autônoma do agente).
 *   - Sem verificação de RBAC (autenticado via X-Internal-Token).
 *
 * LGPD: mesmo contrato que o canal humano — sem PII no outbox.
 * Art. 20 LGPD: decisão autônoma de IA com impacto ao titular → ai_decision_logs.
 */
export async function createAiReferralService(
  db: Database,
  customerId: string,
  lawFirmId: string,
  organizationId: string,
  correlationId: string,
): Promise<CreateAiReferralResponse> {
  // 0. Feature flag — bloqueia se AI handoff estiver desligado
  const { enabled: aiHandoffEnabled } = await isFlagEnabled(db, 'law_firm.ai_handoff.enabled');
  if (!aiHandoffEnabled) {
    throw new FeatureDisabledError('law_firm.ai_handoff.enabled');
  }

  // 1. Cooldown — verificar antes de inserir
  const cooldown = await checkReferralCooldown(db, customerId, organizationId);
  if (cooldown.active && cooldown.cooldownUntil !== null) {
    throw new LawFirmCooldownError(cooldown.cooldownUntil);
  }

  // 2. Verificar existência do customer (org-scope)
  const customerExists = await customerExistsInOrg(db, customerId, organizationId);
  if (!customerExists) {
    throw new NotFoundError('Cliente não encontrado');
  }

  // 3. Verificar existência do law_firm (org-scope)
  const lawFirm = await findLawFirmForReferral(db, lawFirmId, organizationId);
  if (lawFirm === null) {
    throw new NotFoundError('Escritório de advocacia não encontrado');
  }

  // 4. Transação: INSERT + emit outbox + ai_decision_log
  const referral = await db.transaction(async (tx) => {
    // a. Inserir encaminhamento (channel='ai', linked_by=null)
    const inserted = await insertReferral(tx as unknown as Database, {
      organizationId,
      customerId,
      lawFirmId,
      linkedBy: null, // IA não tem usuário humano
      channel: 'ai',
    });

    // b. Emitir evento outbox (LGPD §8.5 — sem PII bruta)
    const sentAt = new Date().toISOString();
    await emit(tx as unknown as Parameters<typeof emit>[0], {
      eventName: 'customer.law_firm_referred',
      aggregateType: 'customer',
      aggregateId: customerId,
      organizationId,
      actor: { kind: 'ai', id: null, ip: null },
      idempotencyKey: `customer.law_firm_referred:${inserted.id}`,
      data: {
        referral_id: inserted.id,
        customer_id: customerId,
        law_firm_id: lawFirmId,
        organization_id: organizationId,
        channel: 'ai' as const,
        sent_at: sentAt,
      },
    });

    // c. ai_decision_logs — auditoria de decisão autônoma (Art. 20 LGPD)
    //    LGPD: `decision` jsonb não contém PII — apenas IDs opacos e metadados.
    await (tx as unknown as Database).insert(aiDecisionLogs).values({
      organizationId,
      conversationId: correlationId, // correlationId como proxy de conversationId
      customerId,
      leadId: null,
      nodeName: 'law_firm_referral',
      intent: 'encaminhar_advocacia',
      decision: {
        referral_id: inserted.id,
        law_firm_id: lawFirmId,
        channel: 'ai',
        cooldown_until: inserted.cooldownUntil,
      } as Record<string, unknown>,
      correlationId,
    });

    return inserted;
  });

  return {
    ok: true,
    referral_id: referral.id,
  };
}
