// =============================================================================
// workers/winback-scan.ts — Worker periódico de win-back (F17-S09).
//
// Processo Node.js SEPARADO. Iniciado via: pnpm --filter @elemento/api worker:winback
//
// Responsabilidade:
//   Executa 3 scans independentes para detectar oportunidades de reativação
//   de clientes e leads:
//
//   1. scanContractWinback (winback_renovation)
//      Contratos com ≤ WINBACK_INSTALLMENTS_THRESHOLD parcelas não pagas restantes.
//      Sinal: contrato está perto do fim → sugerir renovação.
//      Idempotência: task 'winback' com entityType='contract' + entityId=contract_id
//      já aberta (status NOT IN 'done','cancelled').
//      Evento outbox: contract.near_end.
//
//   2. scanClosedLostWinback (winback_lost)
//      Leads com status='closed_lost' e updated_at < NOW() - WINBACK_CLOSED_LOST_DAYS.
//      Sinal: lead fechado como perdido há tempo suficiente → tentar reabordagem.
//      Idempotência: task 'winback' com entityType='lead' + entityId=lead_id
//      já aberta (status NOT IN 'done','cancelled').
//
//   3. scanStagnantKanban (winback_stagnant)
//      Kanban cards sem mudança de stage em ≥ WINBACK_STAGNANT_DAYS dias.
//      Sinal: lead parado no funil → acionar agente para movimentar.
//      Idempotência: task 'winback' com entityType='lead' + entityId=lead_id
//      já aberta (mesmo entity_id que o lead_id do card) sem tarefa de
//      winback_stagnant ativa.
//      Nota: para distinguir lost vs stagnant no entityType, usamos descrição
//      diferente mas o mesmo entityType='lead' — a title da tarefa diferencia.
//
// Flag-gating (2 camadas):
//   winback.enabled (camada 1):
//     Se disabled, o worker sai cedo sem nenhuma query adicional.
//   winback.scan.enabled (camada 2):
//     Se disabled, as queries rodam (diagnóstico) mas nenhum insert é feito (dry-run).
//
// Idempotência:
//   Verificação diretamente na tabela de tasks (WHERE status NOT IN 'done','cancelled').
//   Não usa idempotency_keys como o spc-overdue-scan — a presença da task aberta
//   é suficiente como gate (as tasks têm vida longa, não expiram em 24h).
//
// LGPD §8.5:
//   Worker manipula apenas IDs opacos (UUIDs) + contagens.
//   Nenhum PII (nome, telefone, CPF) é lido ou logado.
//   lead_id, contract_id, customer_id são IDs opacos (não identificam diretamente).
//   city_id é dado geográfico público (não PII).
// =============================================================================
import { and, eq, isNotNull, lt, notInArray, or, sql } from 'drizzle-orm';

import { db as defaultDb, type Database } from '../db/client.js';
import { contracts, kanbanCards, leads, paymentDues, tasks } from '../db/schema/index.js';
import { emit } from '../events/emit.js';
import type { DrizzleTx } from '../events/emit.js';
import type { ContractNearEndData } from '../events/types.js';
import { auditLog } from '../lib/audit.js';
import { isFlagEnabled } from '../modules/featureFlags/service.js';
import { AppError } from '../shared/errors.js';

import { createWorkerRuntime } from './_runtime.js';

// ---------------------------------------------------------------------------
// Configuração — limiares configuráveis
// ---------------------------------------------------------------------------

const WORKER_NAME = 'winback-scan';

/** Intervalo padrão do tick em ms (24 horas). */
const DEFAULT_TICK_MS = 24 * 60 * 60 * 1_000;

/**
 * Número máximo de parcelas não pagas restantes para considerar o contrato
 * perto do fim e elegível para tarefa de renovação.
 */
export const WINBACK_INSTALLMENTS_THRESHOLD = 2;

/**
 * Número de dias após o lead ser marcado como 'closed_lost' para considerar
 * elegível para reabordagem.
 */
export const WINBACK_CLOSED_LOST_DAYS = 30;

/**
 * Número de dias sem mudança de stage no kanban para considerar o lead estagnado.
 * Usamos `entered_stage_at` como referência (atualizado em toda movimentação).
 */
export const WINBACK_STAGNANT_DAYS = 45;

/** Role key dos agentes de crédito (destinatários das tarefas). */
const AGENTE_ROLE = 'agente';

/** Tipo de tarefa — usa 'winback' conforme enum do schema (tasks.ts). */
const TASK_TYPE = 'winback' as const;

/** Statuses de tarefa que indicam que já há uma tarefa ativa (não fechada). */
const CLOSED_TASK_STATUSES = ['done', 'cancelled'] as const;

function getTickMs(): number {
  return DEFAULT_TICK_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

export interface ContractNearEnd {
  contractId: string;
  customerId: string;
  organizationId: string;
  cityId: string;
  installmentsRemaining: number;
}

export interface ClosedLostLead {
  leadId: string;
  organizationId: string;
  cityId: string;
}

export interface StagnantCard {
  leadId: string;
  organizationId: string;
  cityId: string;
  daysSinceLastMove: number;
}

export interface WinbackScanResult {
  renovationEligible: number;
  renovationProcessed: number;
  renovationSkipped: number;
  lostEligible: number;
  lostProcessed: number;
  lostSkipped: number;
  stagnantEligible: number;
  stagnantProcessed: number;
  stagnantSkipped: number;
  dryRun: boolean;
}

// ---------------------------------------------------------------------------
// Logger interface mínima (injetável em testes)
// ---------------------------------------------------------------------------

export interface WinbackLogger {
  info(obj: object, msg?: string): void;
  debug(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

// ---------------------------------------------------------------------------
// Tipo de transação unificado
// ---------------------------------------------------------------------------

type ScanTx = DrizzleTx & Database;

// ---------------------------------------------------------------------------
// Cálculo de thresholds
// ---------------------------------------------------------------------------

/**
 * Calcula o timestamp ISO limite para elegibilidade de leads closed_lost.
 * Um lead é elegível se updated_at < now - WINBACK_CLOSED_LOST_DAYS.
 *
 * @param now Data de referência (injetável para testes).
 */
export function calcClosedLostThreshold(now: Date = new Date()): Date {
  const threshold = new Date(now);
  threshold.setDate(threshold.getDate() - WINBACK_CLOSED_LOST_DAYS);
  return threshold;
}

/**
 * Calcula o timestamp ISO limite para elegibilidade de kanban cards estagnados.
 * Um card é elegível se entered_stage_at < now - WINBACK_STAGNANT_DAYS.
 *
 * @param now Data de referência (injetável para testes).
 */
export function calcStagnantThreshold(now: Date = new Date()): Date {
  const threshold = new Date(now);
  threshold.setDate(threshold.getDate() - WINBACK_STAGNANT_DAYS);
  return threshold;
}

// ---------------------------------------------------------------------------
// Verificação de tarefa winback ativa (idempotência)
// ---------------------------------------------------------------------------

/**
 * Verifica se já existe uma tarefa winback ativa (não encerrada) para a entidade.
 * "Ativa" = status NOT IN ('done', 'cancelled').
 *
 * Usada como gate de idempotência para os 3 scans:
 *   - Scan 1 (renovation): entityType='contract', entityId=contractId
 *   - Scan 2 (lost):       entityType='lead',     entityId=leadId
 *   - Scan 3 (stagnant):   entityType='lead',     entityId=leadId
 *
 * NOTA: scans 2 e 3 usam o mesmo entityType/entityId. A distinção entre
 * "lost" e "stagnant" é feita pelo título da tarefa; a idempotência aqui
 * garante que não haverá duas tarefas winback abertas para o mesmo lead,
 * independente do gatilho. Isso é intencional — o agente deve resolver
 * uma tarefa de reativação por vez.
 *
 * @returns true se já existe tarefa ativa para a entidade.
 */
export async function hasActiveWinbackTask(
  database: Database,
  organizationId: string,
  entityType: string,
  entityId: string,
): Promise<boolean> {
  const rows = await database
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.organizationId, organizationId),
        eq(tasks.type, TASK_TYPE),
        eq(tasks.entityType, entityType),
        eq(tasks.entityId, entityId),
        notInArray(tasks.status, [...CLOSED_TASK_STATUSES]),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Scan 1 — Contratos perto do fim (winback_renovation)
// ---------------------------------------------------------------------------

/**
 * Encontra contratos com ≤ WINBACK_INSTALLMENTS_THRESHOLD parcelas não pagas.
 *
 * Condições:
 *   1. contract.status IN ('active', 'signed') — contratos em andamento.
 *   2. COUNT(payment_dues WHERE status NOT IN ('paid','cancelled','renegotiated')) <= threshold.
 *   3. Pelo menos 1 parcela não paga (evita contratos já liquidados).
 *   4. Tem customer_id para emitir evento e criar tarefa com contexto.
 *   5. lead tem city_id para escopo da tarefa (via customers.primary_lead_id).
 *
 * LGPD §8.5: retorna apenas IDs opacos + contagens. Sem PII.
 */
export async function findContractsNearEnd(database: Database): Promise<ContractNearEnd[]> {
  // Subquery: contratos com parcelas não pagas <= threshold
  // JOIN: contracts → customers → leads (para obter city_id)
  const rows = await database
    .select({
      contractId: contracts.id,
      customerId: contracts.customerId,
      organizationId: contracts.organizationId,
      cityId: leads.cityId,
      installmentsRemaining: sql<number>`COUNT(${paymentDues.id})::int`,
    })
    .from(contracts)
    .innerJoin(paymentDues, eq(paymentDues.contractId, contracts.id))
    .innerJoin(
      // customers.primary_lead_id para obter city_id do lead original
      leads,
      // Join via subselect: contracts → customers → leads
      // Drizzle não suporta JOIN com subselect direto em FROM;
      // usamos innerJoin nas tabelas customers + leads separadamente.
      // `as` não necessário — Drizzle infere a condição via eq().
      sql`${leads.id} = (SELECT primary_lead_id FROM customers WHERE id = ${contracts.customerId} LIMIT 1)`,
    )
    .where(
      and(
        // Contrato ativo ou assinado (não concluído/cancelado)
        or(eq(contracts.status, 'active'), eq(contracts.status, 'signed')),
        // Parcelas não quitadas (ainda abertas)
        notInArray(paymentDues.status, ['paid', 'cancelled', 'renegotiated']),
        // Cidade do lead obrigatória para escopo da tarefa
        isNotNull(leads.cityId),
      ),
    )
    .groupBy(contracts.id, contracts.customerId, contracts.organizationId, leads.cityId)
    // HAVING COUNT <= threshold E COUNT >= 1 (ao menos 1 parcela restante)
    .having(
      and(
        sql`COUNT(${paymentDues.id}) <= ${WINBACK_INSTALLMENTS_THRESHOLD}`,
        sql`COUNT(${paymentDues.id}) >= 1`,
      ),
    );

  return rows
    .filter((row): row is ContractNearEnd & { cityId: string } => row.cityId !== null)
    .map((row) => ({
      contractId: row.contractId,
      customerId: row.customerId,
      organizationId: row.organizationId,
      cityId: row.cityId as string,
      installmentsRemaining: row.installmentsRemaining,
    }));
}

/**
 * Processa um contrato perto do fim:
 *   1. Cria tarefa winback para role='agente' na cidade do contrato.
 *   2. Emite evento contract.near_end no outbox.
 *   3. Registra auditoria.
 *
 * Sem chave de idempotency_keys (ao contrário do spc-overdue-scan):
 * contratos ficam perto do fim por semanas — uma task aberta é o gate.
 *
 * @returns UUID da tarefa criada.
 */
export async function processContractWinback(
  database: Database,
  contract: ContractNearEnd,
): Promise<string> {
  return database.transaction(async (tx) => {
    // `as` justificado: transação Drizzle implementa estruturalmente Database + DrizzleTx.
    const txDb = tx as unknown as ScanTx;
    const now = new Date();

    const [taskRow] = await txDb
      .insert(tasks)
      .values({
        organizationId: contract.organizationId,
        assigneeRole: AGENTE_ROLE,
        cityId: contract.cityId,
        type: TASK_TYPE,
        title: `Contrato perto do fim — verificar renovação (${contract.installmentsRemaining} parcela(s) restante(s))`,
        description: null,
        entityType: 'contract',
        entityId: contract.contractId,
        dueAt: null,
        status: 'open',
        claimedBy: null,
        claimedAt: null,
        completedBy: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: tasks.id });

    if (!taskRow) {
      throw new AppError(
        500,
        'INTERNAL_ERROR',
        `Falha ao criar tarefa winback para contrato ${contract.contractId}`,
      );
    }

    const taskId = taskRow.id;

    await auditLog(txDb, {
      organizationId: contract.organizationId,
      actor: null,
      action: 'task.created',
      resource: { type: 'task', id: taskId },
      after: {
        task_id: taskId,
        type: TASK_TYPE,
        assignee_role: AGENTE_ROLE,
        city_id: contract.cityId,
        status: 'open',
        trigger: 'winback_renovation',
        contract_id: contract.contractId,
      },
    });

    // Evento contract.near_end via outbox (LGPD §8.5 — sem PII)
    const eventData: ContractNearEndData = {
      contract_id: contract.contractId,
      customer_id: contract.customerId,
      organization_id: contract.organizationId,
      installments_remaining: contract.installmentsRemaining,
    };

    await emit(txDb, {
      eventName: 'contract.near_end',
      aggregateType: 'contract',
      aggregateId: contract.contractId,
      organizationId: contract.organizationId,
      actor: { kind: 'worker', id: null, ip: null },
      idempotencyKey: `contract.near_end:${contract.contractId}`,
      data: eventData,
    });

    return taskId;
  });
}

// ---------------------------------------------------------------------------
// Scan 2 — Leads closed_lost (winback_lost)
// ---------------------------------------------------------------------------

/**
 * Encontra leads com status='closed_lost' há ≥ WINBACK_CLOSED_LOST_DAYS dias.
 *
 * Condições:
 *   1. leads.status = 'closed_lost'.
 *   2. leads.updated_at < threshold (updated_at é atualizado na mudança de status).
 *   3. leads.deleted_at IS NULL (leads ativos apenas).
 *   4. leads.city_id IS NOT NULL (obrigatório para escopo da tarefa).
 *
 * LGPD §8.5: retorna apenas IDs opacos. Sem PII.
 */
export async function findClosedLostLeads(
  database: Database,
  threshold: Date,
): Promise<ClosedLostLead[]> {
  const rows = await database
    .select({
      leadId: leads.id,
      organizationId: leads.organizationId,
      cityId: leads.cityId,
    })
    .from(leads)
    .where(
      and(
        eq(leads.status, 'closed_lost'),
        lt(leads.updatedAt, threshold),
        isNotNull(leads.cityId),
        // Leads deletados não são elegíveis para win-back
        sql`${leads.deletedAt} IS NULL`,
      ),
    );

  return rows
    .filter((row): row is ClosedLostLead & { cityId: string } => row.cityId !== null)
    .map((row) => ({
      leadId: row.leadId,
      organizationId: row.organizationId,
      cityId: row.cityId as string,
    }));
}

/**
 * Processa um lead closed_lost elegível:
 *   1. Cria tarefa winback para role='agente' na cidade do lead.
 *   2. Registra auditoria.
 *
 * @returns UUID da tarefa criada.
 */
export async function processClosedLostWinback(
  database: Database,
  lead: ClosedLostLead,
): Promise<string> {
  return database.transaction(async (tx) => {
    // `as` justificado: transação Drizzle implementa estruturalmente Database + DrizzleTx.
    const txDb = tx as unknown as ScanTx;
    const now = new Date();

    const [taskRow] = await txDb
      .insert(tasks)
      .values({
        organizationId: lead.organizationId,
        assigneeRole: AGENTE_ROLE,
        cityId: lead.cityId,
        type: TASK_TYPE,
        title: `Lead fechado como perdido há ${WINBACK_CLOSED_LOST_DAYS}+ dias — tentar reabordagem`,
        description: null,
        entityType: 'lead',
        entityId: lead.leadId,
        dueAt: null,
        status: 'open',
        claimedBy: null,
        claimedAt: null,
        completedBy: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: tasks.id });

    if (!taskRow) {
      throw new AppError(
        500,
        'INTERNAL_ERROR',
        `Falha ao criar tarefa winback para lead ${lead.leadId}`,
      );
    }

    const taskId = taskRow.id;

    await auditLog(txDb, {
      organizationId: lead.organizationId,
      actor: null,
      action: 'task.created',
      resource: { type: 'task', id: taskId },
      after: {
        task_id: taskId,
        type: TASK_TYPE,
        assignee_role: AGENTE_ROLE,
        city_id: lead.cityId,
        status: 'open',
        trigger: 'winback_lost',
        lead_id: lead.leadId,
      },
    });

    return taskId;
  });
}

// ---------------------------------------------------------------------------
// Scan 3 — Kanban estagnado (winback_stagnant)
// ---------------------------------------------------------------------------

/**
 * Encontra kanban cards sem mudança de stage há ≥ WINBACK_STAGNANT_DAYS dias.
 *
 * Condições:
 *   1. kanban_cards.entered_stage_at < threshold (sem movimento de stage).
 *   2. leads.status NOT IN ('closed_won', 'closed_lost', 'archived') — lead ativo.
 *   3. leads.deleted_at IS NULL.
 *   4. leads.city_id IS NOT NULL.
 *
 * NOTA: `entered_stage_at` é o campo atualizado em toda movimentação de card.
 * `kanban_cards.updated_at` pode ser atualizado por outras mudanças (notas, assignee)
 * — prefer `entered_stage_at` que reflete mudança de stage especificamente.
 *
 * LGPD §8.5: retorna apenas IDs opacos. Sem PII.
 */
export async function findStagnantKanbanCards(
  database: Database,
  threshold: Date,
): Promise<StagnantCard[]> {
  const rows = await database
    .select({
      leadId: kanbanCards.leadId,
      organizationId: kanbanCards.organizationId,
      cityId: leads.cityId,
      enteredStageAt: kanbanCards.enteredStageAt,
    })
    .from(kanbanCards)
    .innerJoin(leads, eq(kanbanCards.leadId, leads.id))
    .where(
      and(
        // Card sem mudança de stage há ≥ WINBACK_STAGNANT_DAYS dias
        lt(kanbanCards.enteredStageAt, threshold),
        // Lead ativo (não fechado/arquivado)
        notInArray(leads.status, ['closed_won', 'closed_lost', 'archived']),
        // Lead não deletado
        sql`${leads.deletedAt} IS NULL`,
        // Cidade obrigatória para escopo da tarefa
        isNotNull(leads.cityId),
      ),
    );

  const now = new Date();

  return rows
    .filter((row): row is typeof row & { cityId: string } => row.cityId !== null)
    .map((row) => ({
      leadId: row.leadId,
      organizationId: row.organizationId,
      cityId: row.cityId as string,
      daysSinceLastMove: Math.floor(
        (now.getTime() - row.enteredStageAt.getTime()) / (1000 * 60 * 60 * 24),
      ),
    }));
}

/**
 * Processa um kanban card estagnado:
 *   1. Cria tarefa winback para role='agente' na cidade do lead.
 *   2. Registra auditoria.
 *
 * @returns UUID da tarefa criada.
 */
export async function processStagnantWinback(
  database: Database,
  card: StagnantCard,
): Promise<string> {
  return database.transaction(async (tx) => {
    // `as` justificado: transação Drizzle implementa estruturalmente Database + DrizzleTx.
    const txDb = tx as unknown as ScanTx;
    const now = new Date();

    const [taskRow] = await txDb
      .insert(tasks)
      .values({
        organizationId: card.organizationId,
        assigneeRole: AGENTE_ROLE,
        cityId: card.cityId,
        type: TASK_TYPE,
        title: `Lead estagnado no kanban há ${card.daysSinceLastMove} dias — movimentar ou fechar`,
        description: null,
        entityType: 'lead',
        entityId: card.leadId,
        dueAt: null,
        status: 'open',
        claimedBy: null,
        claimedAt: null,
        completedBy: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: tasks.id });

    if (!taskRow) {
      throw new AppError(
        500,
        'INTERNAL_ERROR',
        `Falha ao criar tarefa winback para lead estagnado ${card.leadId}`,
      );
    }

    const taskId = taskRow.id;

    await auditLog(txDb, {
      organizationId: card.organizationId,
      actor: null,
      action: 'task.created',
      resource: { type: 'task', id: taskId },
      after: {
        task_id: taskId,
        type: TASK_TYPE,
        assignee_role: AGENTE_ROLE,
        city_id: card.cityId,
        status: 'open',
        trigger: 'winback_stagnant',
        lead_id: card.leadId,
        days_stagnant: card.daysSinceLastMove,
      },
    });

    return taskId;
  });
}

// ---------------------------------------------------------------------------
// Scan runner helpers
// ---------------------------------------------------------------------------

/**
 * Processa uma lista de itens elegíveis com idempotência e isolamento de erros.
 *
 * @param items          Lista de itens eligíveis para winback.
 * @param entityType     entityType do item para verificação de tarefa ativa.
 * @param getEntityId    Extrai o entityId do item.
 * @param getOrgId       Extrai o organizationId do item.
 * @param process        Função de processamento que cria a tarefa.
 * @param logger         Logger do worker.
 * @param scanName       Nome do scan para logs.
 */
async function runScanItems<T>(
  database: Database,
  items: T[],
  entityType: string,
  getEntityId: (item: T) => string,
  getOrgId: (item: T) => string,
  process: (db: Database, item: T) => Promise<string>,
  logger: WinbackLogger,
  scanName: string,
): Promise<{ processed: number; skipped: number }> {
  let processed = 0;
  let skipped = 0;

  for (const item of items) {
    const entityId = getEntityId(item);
    const organizationId = getOrgId(item);

    try {
      const hasActive = await hasActiveWinbackTask(database, organizationId, entityType, entityId);
      if (hasActive) {
        logger.debug(
          { event: `${scanName}.skipped.active_task_exists`, entity_id: entityId },
          `${scanName}: tarefa winback ativa já existe — ignorando`,
        );
        skipped++;
        continue;
      }

      const taskId = await process(database, item);

      logger.info(
        { event: `${scanName}.processed`, task_id: taskId },
        `${scanName}: tarefa criada`,
      );
      logger.debug(
        { event: `${scanName}.processed.detail`, entity_id: entityId, task_id: taskId },
        `${scanName}: detalhe — entity_id disponível apenas em debug`,
      );

      processed++;
    } catch (err: unknown) {
      logger.error(
        { event: `${scanName}.error`, entity_id: entityId, err },
        `${scanName}: erro ao processar — próximo item será processado normalmente`,
      );
    }
  }

  return { processed, skipped };
}

// ---------------------------------------------------------------------------
// Tick principal
// ---------------------------------------------------------------------------

/**
 * Executa um tick completo do winback-scan:
 *   1. Verifica flag winback.enabled → sai cedo se disabled.
 *   2. Verifica flag winback.scan.enabled → define dryRun.
 *   3. Roda 3 scans independentes: renovation, lost, stagnant.
 *   4. Loga resultados estruturados. Erros por item são isolados.
 *
 * @param database Instância Drizzle (injetável para testes).
 * @param logger   Logger do worker.
 */
export async function runWinbackScan(
  database: Database,
  logger: WinbackLogger,
): Promise<WinbackScanResult> {
  // -------------------------------------------------------------------------
  // Camada 1: winback.enabled — gate total.
  // -------------------------------------------------------------------------
  const { enabled: winbackEnabled } = await isFlagEnabled(database, 'winback.enabled');
  if (!winbackEnabled) {
    logger.debug(
      { event: 'winback_scan.skipped', flag: 'winback.enabled' },
      'winback.enabled=disabled — tick ignorado',
    );
    return {
      renovationEligible: 0,
      renovationProcessed: 0,
      renovationSkipped: 0,
      lostEligible: 0,
      lostProcessed: 0,
      lostSkipped: 0,
      stagnantEligible: 0,
      stagnantProcessed: 0,
      stagnantSkipped: 0,
      dryRun: false,
    };
  }

  // -------------------------------------------------------------------------
  // Camada 2: winback.scan.enabled — gate de escrita (dry-run).
  // -------------------------------------------------------------------------
  const { enabled: scanEnabled } = await isFlagEnabled(database, 'winback.scan.enabled');
  const dryRun = !scanEnabled;

  if (dryRun) {
    logger.info(
      { event: 'winback_scan.dry_run', flag: 'winback.scan.enabled' },
      'winback.scan.enabled=disabled — tick em dry-run (sem inserts)',
    );
  }

  const now = new Date();
  const closedLostThreshold = calcClosedLostThreshold(now);
  const stagnantThreshold = calcStagnantThreshold(now);

  // -------------------------------------------------------------------------
  // Scan 1: contratos perto do fim (winback_renovation)
  // -------------------------------------------------------------------------

  const contractsNearEnd = await findContractsNearEnd(database);
  const renovationEligible = contractsNearEnd.length;

  logger.info(
    {
      event: 'winback_scan.renovation.eligible',
      count: renovationEligible,
      threshold: WINBACK_INSTALLMENTS_THRESHOLD,
      dryRun,
    },
    `${renovationEligible} contrato(s) perto do fim encontrado(s)`,
  );

  let renovationProcessed = 0;
  let renovationSkipped = 0;

  if (!dryRun && renovationEligible > 0) {
    const result = await runScanItems(
      database,
      contractsNearEnd,
      'contract',
      (c) => c.contractId,
      (c) => c.organizationId,
      processContractWinback,
      logger,
      'winback_scan.renovation',
    );
    renovationProcessed = result.processed;
    renovationSkipped = result.skipped;
  }

  // -------------------------------------------------------------------------
  // Scan 2: leads closed_lost (winback_lost)
  // -------------------------------------------------------------------------

  const closedLostLeads = await findClosedLostLeads(database, closedLostThreshold);
  const lostEligible = closedLostLeads.length;

  logger.info(
    {
      event: 'winback_scan.lost.eligible',
      count: lostEligible,
      threshold_days: WINBACK_CLOSED_LOST_DAYS,
      dryRun,
    },
    `${lostEligible} lead(s) closed_lost há ${WINBACK_CLOSED_LOST_DAYS}+ dias encontrado(s)`,
  );

  let lostProcessed = 0;
  let lostSkipped = 0;

  if (!dryRun && lostEligible > 0) {
    const result = await runScanItems(
      database,
      closedLostLeads,
      'lead',
      (l) => l.leadId,
      (l) => l.organizationId,
      processClosedLostWinback,
      logger,
      'winback_scan.lost',
    );
    lostProcessed = result.processed;
    lostSkipped = result.skipped;
  }

  // -------------------------------------------------------------------------
  // Scan 3: kanban estagnado (winback_stagnant)
  // -------------------------------------------------------------------------

  const stagnantCards = await findStagnantKanbanCards(database, stagnantThreshold);
  const stagnantEligible = stagnantCards.length;

  logger.info(
    {
      event: 'winback_scan.stagnant.eligible',
      count: stagnantEligible,
      threshold_days: WINBACK_STAGNANT_DAYS,
      dryRun,
    },
    `${stagnantEligible} card(s) estagnado(s) há ${WINBACK_STAGNANT_DAYS}+ dias encontrado(s)`,
  );

  let stagnantProcessed = 0;
  let stagnantSkipped = 0;

  if (!dryRun && stagnantEligible > 0) {
    const result = await runScanItems(
      database,
      stagnantCards,
      'lead',
      (c) => c.leadId,
      (c) => c.organizationId,
      processStagnantWinback,
      logger,
      'winback_scan.stagnant',
    );
    stagnantProcessed = result.processed;
    stagnantSkipped = result.skipped;
  }

  // -------------------------------------------------------------------------
  // Resultado final
  // -------------------------------------------------------------------------

  const result: WinbackScanResult = {
    renovationEligible,
    renovationProcessed,
    renovationSkipped,
    lostEligible,
    lostProcessed,
    lostSkipped,
    stagnantEligible,
    stagnantProcessed,
    stagnantSkipped,
    dryRun,
  };

  logger.info({ event: 'winback_scan.tick_complete', ...result }, 'tick winback-scan concluído');

  return result;
}

// ---------------------------------------------------------------------------
// Entrypoint (processo separado)
// ---------------------------------------------------------------------------

const runtime = createWorkerRuntime(WORKER_NAME, 3);

export { runtime as _workerRuntime };

async function main(): Promise<void> {
  const tickMs = getTickMs();
  runtime.logger.info({ worker: WORKER_NAME, tick_ms: tickMs }, 'winback-scan iniciado');

  while (!runtime.isShuttingDown()) {
    try {
      await runWinbackScan(defaultDb, runtime.logger);
    } catch (err: unknown) {
      runtime.logger.error(
        { err: { message: err instanceof Error ? err.message : String(err) } },
        'winback-scan: erro inesperado no tick',
      );
    }
    await sleep(tickMs);
  }
}

// Guard: só executar main() quando rodado diretamente
if (process.argv[1] !== undefined && process.argv[1].includes('winback-scan')) {
  main().catch((err: unknown) => {
    runtime.logger.fatal(
      { err: { message: err instanceof Error ? err.message : String(err) } },
      'winback-scan: falha fatal',
    );
    process.exit(1);
  });
}
