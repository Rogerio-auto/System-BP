// =============================================================================
// notification-rules/sla-sources.ts — Fontes de inatividade por eixo (F24-S07,
// corrigido em F24-S16).
//
// F24-S07 entregou apenas 1 dos 7 eixos do TRIGGER_CATALOG (kanban_stage) e com
// um bug de formato de chave (comparava o nome do stage contra a chave inteira
// 'kanban_stage:*'). F24-S16 corrige os dois problemas:
//   1. findSlaSources agora roteia por trigger_key para uma fonte real por eixo.
//   2. kanban_stage:* / kanban_stage:<stageId> (UUID de kanban_stages.id) são
//      resolvidos via lookupTrigger (packages/shared-schemas), que já trata o
//      prefixo — o filtro por stage usa o UUID diretamente (não o nome, que é
//      editável e não é uma chave estável).
//
// Eixos suportados (trigger_key → fonte):
//   kanban_stage:*        → kanban_cards.entered_stage_at (qualquer stage)
//   kanban_stage:<stageId> → kanban_cards.entered_stage_at (stage específico)
//   handoff:requested      → chatwoot_handoffs.created_at (status='requested')
//   simulation:sent_no_reply → credit_simulations.sent_at (sent_at IS NOT NULL)
//   analysis:pendente       → credit_analyses.updated_at (status='pendente')
//   contract:draft_unsigned → contracts.created_at (status='draft', signed_at NULL)
//   payment_due:overdue     → payment_dues.due_date (status IN pending/overdue)
//   conversation:no_reply   → conversations.last_inbound_at (status='open')
//
// entityType de cada resultado vem do TRIGGER_CATALOG (via lookupTrigger) —
// nunca hardcoded 'lead'. trigger_key desconhecido (ou que não seja um eixo
// stage_inactivity do catálogo) lança AppError — nunca cai em fallback silencioso.
//
// leadId (separado de entityId): usado apenas para resolver recipientMode=
// 'assignee' (busca o assignee do kanban_card do lead). Nem toda fonte tem um
// lead diretamente — contract/payment_due chegam ao lead via customer.
//
// LGPD §8.5:
//   Queries retornam apenas IDs opacos + timestamps. Sem PII (nome, telefone,
//   CPF, resumo de handoff) no resultado.
//
// Multi-tenant:
//   Todas as queries filtram por organizationId (parâmetro explícito) e
//   devolvem cityId (via JOIN até leads quando a tabela não tem cidade
//   diretamente) para o filtro city_scope do worker.
// =============================================================================
import { lookupTrigger } from '@elemento/shared-schemas';
import { and, eq, inArray, isNotNull, isNull, lt } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import {
  chatwootHandoffs,
  contracts,
  conversations,
  creditAnalyses,
  creditSimulations,
  customers,
  kanbanCards,
  leads,
  paymentDues,
} from '../../db/schema/index.js';
import { AppError } from '../../shared/errors.js';

/**
 * Subconjunto de Database realmente exercitado pelas fontes deste módulo
 * (somente leitura — nenhuma fonte escreve). Permite tipar mocks de teste
 * sem implementar toda a superfície de NodePgDatabase (transaction, $with,
 * $count, etc.) e sem `as unknown as Database`.
 */
export type SlaSourceDb = Pick<Database, 'select'>;

// ---------------------------------------------------------------------------
// Tipo de entidade retornada pelas fontes
// ---------------------------------------------------------------------------

/**
 * Entidade elegível para notificação de SLA.
 *
 * entityId   = UUID da própria linha na tabela-fonte do eixo (ex: kanban_cards.id,
 *              chatwoot_handoffs.id) — chave de dedup em notification_rule_deliveries
 *              junto com entityType + bucket.
 * entityType = tipo do catálogo (TRIGGER_CATALOG), nunca hardcoded.
 * cityId     = cidade da entidade, para filtro city_scope da regra.
 * leadId     = lead associado (quando existir), usado apenas para
 *              recipientMode='assignee'. null quando o eixo não tem lead direto
 *              ou o vínculo é opcional e ausente.
 */
export interface SlaEligibleEntity {
  entityId: string;
  entityType: string;
  cityId: string | null;
  leadId: string | null;
  /** Timestamp relevante para diagnóstico (ex: entered_stage_at, due_date). */
  sinceAt: Date;
}

// ---------------------------------------------------------------------------
// Helpers de threshold (puros — testáveis isoladamente)
// ---------------------------------------------------------------------------

/** Calcula o timestamp de corte: entidades com sinceAt < cutoff são elegíveis. */
export function computeCutoff(thresholdHours: number, now: Date = new Date()): Date {
  return new Date(now.getTime() - thresholdHours * 60 * 60 * 1_000);
}

/**
 * Calcula o corte como data 'YYYY-MM-DD' (para colunas `date`, ex: payment_dues.due_date).
 * O PostgreSQL `date` não tem hora — comparamos pela data do corte.
 */
export function computeCutoffDateString(thresholdHours: number, now: Date = new Date()): string {
  const cutoff = computeCutoff(thresholdHours, now);
  return cutoff.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Fonte: kanban_stage (kanban_cards.entered_stage_at)
// ---------------------------------------------------------------------------

/**
 * Encontra leads parados em kanban_cards além de thresholdHours.
 *
 * stageId null = qualquer stage (trigger_key 'kanban_stage:*').
 * stageId UUID = restringe ao stage específico (trigger_key 'kanban_stage:<stageId>').
 *
 * LGPD: retorna apenas IDs opacos + timestamps. Sem PII.
 */
export async function findStagnantKanbanCards(
  db: SlaSourceDb,
  organizationId: string,
  thresholdHours: number,
  stageId: string | null,
  entityType: string,
): Promise<SlaEligibleEntity[]> {
  const cutoff = computeCutoff(thresholdHours);

  const conditions = [
    eq(kanbanCards.organizationId, organizationId),
    lt(kanbanCards.enteredStageAt, cutoff),
  ];
  if (stageId !== null) {
    conditions.push(eq(kanbanCards.stageId, stageId));
  }

  const rows = await db
    .select({
      cardId: kanbanCards.id,
      leadId: kanbanCards.leadId,
      cityId: leads.cityId,
      enteredStageAt: kanbanCards.enteredStageAt,
    })
    .from(kanbanCards)
    .innerJoin(leads, eq(kanbanCards.leadId, leads.id))
    .where(and(...conditions));

  return rows.map((r) => ({
    entityId: r.cardId,
    entityType,
    cityId: r.cityId ?? null,
    leadId: r.leadId,
    sinceAt: r.enteredStageAt,
  }));
}

// ---------------------------------------------------------------------------
// Fonte: handoff:requested (chatwoot_handoffs.created_at)
// ---------------------------------------------------------------------------

/**
 * Encontra handoffs em status='requested' há mais de thresholdHours.
 *
 * leadId é nullable em chatwoot_handoffs (edge case: conversa anônima) —
 * LEFT JOIN em leads; cityId/leadId ficam null quando não há lead vinculado.
 */
export async function findStalledHandoffRequests(
  db: SlaSourceDb,
  organizationId: string,
  thresholdHours: number,
  entityType: string,
): Promise<SlaEligibleEntity[]> {
  const cutoff = computeCutoff(thresholdHours);

  const rows = await db
    .select({
      handoffId: chatwootHandoffs.id,
      leadId: chatwootHandoffs.leadId,
      cityId: leads.cityId,
      createdAt: chatwootHandoffs.createdAt,
    })
    .from(chatwootHandoffs)
    .leftJoin(leads, eq(chatwootHandoffs.leadId, leads.id))
    .where(
      and(
        eq(chatwootHandoffs.organizationId, organizationId),
        eq(chatwootHandoffs.status, 'requested'),
        lt(chatwootHandoffs.createdAt, cutoff),
        isNull(chatwootHandoffs.deletedAt),
      ),
    );

  return rows.map((r) => ({
    entityId: r.handoffId,
    entityType,
    cityId: r.cityId ?? null,
    leadId: r.leadId,
    sinceAt: r.createdAt,
  }));
}

// ---------------------------------------------------------------------------
// Fonte: simulation:sent_no_reply (credit_simulations.sent_at)
// ---------------------------------------------------------------------------

/**
 * Encontra simulações enviadas ao lead (sent_at preenchido) há mais de
 * thresholdHours. Não há flag de "resposta" na tabela — o eixo mede apenas
 * "enviada há X horas", conforme contrato do slot F24-S16.
 */
export async function findStalledSimulations(
  db: SlaSourceDb,
  organizationId: string,
  thresholdHours: number,
  entityType: string,
): Promise<SlaEligibleEntity[]> {
  const cutoff = computeCutoff(thresholdHours);

  const rows = await db
    .select({
      simulationId: creditSimulations.id,
      leadId: creditSimulations.leadId,
      cityId: leads.cityId,
      sentAt: creditSimulations.sentAt,
    })
    .from(creditSimulations)
    .innerJoin(leads, eq(creditSimulations.leadId, leads.id))
    .where(
      and(
        eq(creditSimulations.organizationId, organizationId),
        isNotNull(creditSimulations.sentAt),
        lt(creditSimulations.sentAt, cutoff),
      ),
    );

  // sentAt é nullable no schema; o filtro SQL acima já garante NOT NULL, mas o
  // tipo TS permanece `Date | null` — narrow defensivo (noUncheckedIndexedAccess).
  return rows
    .filter((r): r is typeof r & { sentAt: Date } => r.sentAt !== null)
    .map((r) => ({
      entityId: r.simulationId,
      entityType,
      cityId: r.cityId ?? null,
      leadId: r.leadId,
      sinceAt: r.sentAt,
    }));
}

// ---------------------------------------------------------------------------
// Fonte: analysis:pendente (credit_analyses.updated_at)
// ---------------------------------------------------------------------------

/**
 * Encontra análises de crédito em status='pendente' há mais de thresholdHours,
 * medido a partir de updated_at (última mudança de status — não created_at).
 */
export async function findStalledAnalyses(
  db: SlaSourceDb,
  organizationId: string,
  thresholdHours: number,
  entityType: string,
): Promise<SlaEligibleEntity[]> {
  const cutoff = computeCutoff(thresholdHours);

  const rows = await db
    .select({
      analysisId: creditAnalyses.id,
      leadId: creditAnalyses.leadId,
      cityId: leads.cityId,
      updatedAt: creditAnalyses.updatedAt,
    })
    .from(creditAnalyses)
    .innerJoin(leads, eq(creditAnalyses.leadId, leads.id))
    .where(
      and(
        eq(creditAnalyses.organizationId, organizationId),
        eq(creditAnalyses.status, 'pendente'),
        lt(creditAnalyses.updatedAt, cutoff),
      ),
    );

  return rows.map((r) => ({
    entityId: r.analysisId,
    entityType,
    cityId: r.cityId ?? null,
    leadId: r.leadId,
    sinceAt: r.updatedAt,
  }));
}

// ---------------------------------------------------------------------------
// Fonte: contract:draft_unsigned (contracts.created_at)
// ---------------------------------------------------------------------------

/**
 * Encontra contratos em status='draft' e signed_at NULL há mais de
 * thresholdHours. contracts não tem lead_id direto — chega ao lead via
 * customers.primary_lead_id (mesmo padrão de spc-overdue-scan.ts).
 */
export async function findStalledDraftContracts(
  db: SlaSourceDb,
  organizationId: string,
  thresholdHours: number,
  entityType: string,
): Promise<SlaEligibleEntity[]> {
  const cutoff = computeCutoff(thresholdHours);

  const rows = await db
    .select({
      contractId: contracts.id,
      leadId: customers.primaryLeadId,
      cityId: leads.cityId,
      createdAt: contracts.createdAt,
    })
    .from(contracts)
    .innerJoin(customers, eq(contracts.customerId, customers.id))
    .innerJoin(leads, eq(customers.primaryLeadId, leads.id))
    .where(
      and(
        eq(contracts.organizationId, organizationId),
        eq(contracts.status, 'draft'),
        isNull(contracts.signedAt),
        lt(contracts.createdAt, cutoff),
      ),
    );

  return rows.map((r) => ({
    entityId: r.contractId,
    entityType,
    cityId: r.cityId ?? null,
    leadId: r.leadId,
    sinceAt: r.createdAt,
  }));
}

// ---------------------------------------------------------------------------
// Fonte: payment_due:overdue (payment_dues.due_date)
// ---------------------------------------------------------------------------

/**
 * Encontra parcelas em status IN ('pending','overdue') com due_date anterior
 * ao corte (data, sem hora). Chega ao lead via customers.primary_lead_id
 * (mesmo padrão de spc-overdue-scan.ts — reusa idx_payment_dues_status_due).
 */
export async function findOverduePaymentDues(
  db: SlaSourceDb,
  organizationId: string,
  thresholdHours: number,
  entityType: string,
): Promise<SlaEligibleEntity[]> {
  const cutoffDate = computeCutoffDateString(thresholdHours);

  const rows = await db
    .select({
      paymentDueId: paymentDues.id,
      leadId: customers.primaryLeadId,
      cityId: leads.cityId,
      dueDate: paymentDues.dueDate,
    })
    .from(paymentDues)
    .innerJoin(customers, eq(paymentDues.customerId, customers.id))
    .innerJoin(leads, eq(customers.primaryLeadId, leads.id))
    .where(
      and(
        eq(paymentDues.organizationId, organizationId),
        inArray(paymentDues.status, ['pending', 'overdue']),
        lt(paymentDues.dueDate, cutoffDate),
      ),
    );

  return rows.map((r) => ({
    entityId: r.paymentDueId,
    entityType,
    cityId: r.cityId ?? null,
    leadId: r.leadId,
    // due_date é `date` (string 'YYYY-MM-DD') — normaliza para Date à meia-noite UTC
    // apenas para o diagnóstico sinceAt; nunca usado em comparação SQL.
    sinceAt: new Date(`${r.dueDate}T00:00:00.000Z`),
  }));
}

// ---------------------------------------------------------------------------
// Fonte: conversation:no_reply (conversations.last_inbound_at)
// ---------------------------------------------------------------------------

/**
 * Encontra conversas abertas (status='open') cujo último inbound do contato
 * foi há mais de thresholdHours sem resposta do agente. cityId vem direto de
 * conversations.city_id — sem necessidade de JOIN em leads.
 */
export async function findStalledConversations(
  db: SlaSourceDb,
  organizationId: string,
  thresholdHours: number,
  entityType: string,
): Promise<SlaEligibleEntity[]> {
  const cutoff = computeCutoff(thresholdHours);

  const rows = await db
    .select({
      conversationId: conversations.id,
      leadId: conversations.leadId,
      cityId: conversations.cityId,
      lastInboundAt: conversations.lastInboundAt,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.organizationId, organizationId),
        eq(conversations.status, 'open'),
        isNotNull(conversations.lastInboundAt),
        lt(conversations.lastInboundAt, cutoff),
        isNull(conversations.deletedAt),
      ),
    );

  return rows
    .filter((r): r is typeof r & { lastInboundAt: Date } => r.lastInboundAt !== null)
    .map((r) => ({
      entityId: r.conversationId,
      entityType,
      cityId: r.cityId ?? null,
      leadId: r.leadId,
      sinceAt: r.lastInboundAt,
    }));
}

// ---------------------------------------------------------------------------
// Dispatcher de fonte por triggerKey
// ---------------------------------------------------------------------------

/** Prefixo de trigger_key parametrizável por stage — espelha shared-schemas. */
const KANBAN_STAGE_PREFIX = 'kanban_stage:';

/**
 * Retorna as entidades elegíveis para uma regra stage_inactivity, roteando
 * por trigger_key para a fonte real do eixo (F24-S16).
 *
 * `entityType` do resultado vem sempre do TRIGGER_CATALOG (via lookupTrigger),
 * nunca hardcoded — cumpre o contrato declarado por eixo.
 *
 * trigger_key desconhecido, ou que não corresponda a um eixo stage_inactivity
 * do catálogo, lança AppError explícito — nunca cai em fallback silencioso
 * (foi exatamente esse fallback que escondeu o bug original de F24-S07).
 */
export async function findSlaSources(
  db: SlaSourceDb,
  organizationId: string,
  thresholdHours: number,
  triggerKey: string,
): Promise<SlaEligibleEntity[]> {
  const trigger = lookupTrigger(triggerKey);
  if (trigger === undefined || trigger.kind !== 'stage_inactivity') {
    throw new AppError(
      422,
      'VALIDATION_ERROR',
      `findSlaSources: trigger_key desconhecido ou não é eixo de inatividade: '${triggerKey}'`,
    );
  }
  const entityType = trigger.entityType;

  if (triggerKey.startsWith(KANBAN_STAGE_PREFIX)) {
    const stageSelector = triggerKey.slice(KANBAN_STAGE_PREFIX.length);
    const stageId = stageSelector === '*' ? null : stageSelector;
    return findStagnantKanbanCards(db, organizationId, thresholdHours, stageId, entityType);
  }

  switch (triggerKey) {
    case 'handoff:requested':
      return findStalledHandoffRequests(db, organizationId, thresholdHours, entityType);
    case 'simulation:sent_no_reply':
      return findStalledSimulations(db, organizationId, thresholdHours, entityType);
    case 'analysis:pendente':
      return findStalledAnalyses(db, organizationId, thresholdHours, entityType);
    case 'contract:draft_unsigned':
      return findStalledDraftContracts(db, organizationId, thresholdHours, entityType);
    case 'payment_due:overdue':
      return findOverduePaymentDues(db, organizationId, thresholdHours, entityType);
    case 'conversation:no_reply':
      return findStalledConversations(db, organizationId, thresholdHours, entityType);
    default:
      // trigger existe no catálogo (validado acima) mas não tem fonte implementada —
      // não deve acontecer com o catálogo atual; erro explícito em vez de silêncio.
      throw new AppError(
        422,
        'VALIDATION_ERROR',
        `findSlaSources: eixo '${triggerKey}' sem fonte implementada`,
      );
  }
}
