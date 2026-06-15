// =============================================================================
// workers/spc-overdue-scan.ts — Worker periódico de varredura de inadimplência (F15-S08).
//
// Processo Node.js SEPARADO. Iniciado via: pnpm --filter @elemento/api worker:spc:scan
//
// Responsabilidade:
//   Para cada tick, encontra clientes com spc_status='none' que possuam pelo menos
//   1 parcela com due_date <= NOW() - 15 dias (15+ dias de atraso).
//   Para cada cliente elegível:
//     1. Verifica idempotência via idempotency_keys (chave: `spc-overdue-15d:<customerId>`).
//        Se a chave já existe, o cliente já foi processado neste ciclo — pula.
//     2. Insere tarefa tipo='spc_inclusion' para role='cobranca' na cidade do cliente.
//     3. Emite evento payment_due.overdue_15d no outbox (sem PII bruta).
//     4. Persiste a chave de idempotência para evitar reprocessamento em execuções seguintes.
//   Erros por cliente são isolados (1 falha não interrompe os demais).
//
// Flag-gating (2 camadas, alinhado com collection-scheduler):
//   spc.enabled (camada 1):
//     Se disabled, o worker sai cedo sem nenhuma query adicional.
//   spc.scan.enabled (camada 2):
//     Se disabled, as queries rodam (diagnóstico) mas nenhum insert é feito (dry-run).
//
// Idempotência:
//   Chave canônica: `spc-overdue-15d:<customerId>`
//   Armazenada em idempotency_keys (mesma tabela usada pelo task service).
//   Retenção: job de limpeza de idempotency_keys remove registros > 24h.
//   IMPORTANTE: a chave garante 1 tarefa/evento por cliente por ciclo diário.
//   Se a chave expirar (> 24h), o ciclo seguinte poderá criar nova tarefa/evento —
//   isso é intencional: o worker de cobrança é re-executado periodicamente e
//   o operador é re-alertado enquanto o cliente continua inadimplente.
//   Para evitar duplicidade de tarefas abertas multi-ciclo, o worker também verifica
//   se já existe tarefa 'spc_inclusion' com status='open' para o cliente antes de criar.
//
// Regra dos 15 dias:
//   due_date <= current_date - 15 dias
//   => Parcela vencida há pelo menos 15 dias.
//   Inclui status 'pending' e 'overdue' — 'pending' pode estar com due_date no passado
//   se o status não foi atualizado pelo collection-scheduler.
//
// LGPD §8.5:
//   Worker manipula apenas IDs opacos (UUIDs) + timestamps + contagens.
//   Nenhum PII (nome, telefone, CPF) é lido ou logado.
//   customer_id e payment_due_id são IDs opacos (não identificam pessoa diretamente).
//   city_id é dado geográfico público (não PII).
// =============================================================================
import crypto from 'node:crypto';

import { and, eq, isNotNull, lte, or, sql } from 'drizzle-orm';

import { db as defaultDb, type Database } from '../db/client.js';
import { customers, idempotencyKeys, leads, paymentDues, tasks } from '../db/schema/index.js';
import { emit } from '../events/emit.js';
import type { DrizzleTx } from '../events/emit.js';
import type { PaymentDueOverdue15dData } from '../events/types.js';
import { auditLog } from '../lib/audit.js';
import { isFlagEnabled } from '../modules/featureFlags/service.js';
import { AppError } from '../shared/errors.js';

import { createWorkerRuntime } from './_runtime.js';

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

const WORKER_NAME = 'spc-overdue-scan';

/** Intervalo padrão do tick em ms (1 hora). */
const DEFAULT_TICK_MS = 60 * 60 * 1_000;

/** Número de dias de atraso para elegibilidade. */
const OVERDUE_THRESHOLD_DAYS = 15;

/** Role key do operador de cobrança (decisão D14 + seed F15-S01). */
const COBRANCA_ROLE = 'cobranca';

/** Tipo de tarefa criada por este worker (alinhado com db/schema/tasks.ts). */
const TASK_TYPE = 'spc_inclusion' as const;

function getTickMs(): number {
  // Reusa a env do followup-scheduler (intervalo periódico genérico).
  // Em produção, o systemd/cron controla a frequência do processo.
  return DEFAULT_TICK_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

export interface OverdueCustomer {
  customerId: string;
  organizationId: string;
  /** UUID da cidade do customer, via customers → leads.city_id. */
  cityId: string;
  /** Contagem de parcelas com 15+ dias de atraso para este cliente. */
  overdueCount: number;
}

export interface ScanTickResult {
  eligibleCount: number;
  processedCount: number;
  skippedCount: number;
  dryRun: boolean;
}

// ---------------------------------------------------------------------------
// Logger interface mínima (injetável em testes)
// ---------------------------------------------------------------------------

export interface ScanLogger {
  info(obj: object, msg?: string): void;
  debug(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

// ---------------------------------------------------------------------------
// Idempotência
// ---------------------------------------------------------------------------

/**
 * Monta a chave canônica de idempotência para um cliente no ciclo de varredura.
 * Formato: "spc-overdue-15d:<customerId>"
 * Expiração: 24h (job de limpeza de idempotency_keys).
 */
export function buildScanIdempotencyKey(customerId: string): string {
  return `spc-overdue-15d:${customerId}`;
}

// ---------------------------------------------------------------------------
// Cálculo do threshold de data
// ---------------------------------------------------------------------------

/**
 * Calcula a data limite (YYYY-MM-DD) para elegibilidade de 15 dias de atraso.
 * Uma parcela é elegível se due_date <= threshold.
 * Ex: hoje = 2026-06-15 → threshold = 2026-05-31.
 *
 * @param now Data de referência (default: hoje). Injetável para testes.
 */
export function calcOverdueThreshold(now: Date = new Date()): string {
  const threshold = new Date(now);
  threshold.setDate(threshold.getDate() - OVERDUE_THRESHOLD_DAYS);
  return threshold.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Query — encontrar clientes elegíveis
// ---------------------------------------------------------------------------

/**
 * Encontra clientes com pelo menos 1 parcela 15+ dias em atraso e spc_status='none'.
 *
 * JOIN: payment_dues → customers → leads (para obter city_id).
 *
 * Condições:
 *   1. customers.spc_status = 'none'      — ainda não iniciou processo SPC.
 *   2. payment_dues.status IN ('pending', 'overdue') — parcela ainda não quitada.
 *   3. payment_dues.due_date <= threshold  — 15+ dias de atraso.
 *   4. leads.city_id IS NOT NULL           — necessário para escopo de cidade da tarefa.
 *
 * Agrupado por customer: retorna 1 linha por cliente com COUNT das parcelas elegíveis.
 *
 * LGPD §8.5: retorna apenas IDs opacos + count. Sem PII bruta.
 *
 * @param database Instância Drizzle (injetável para testes).
 * @param threshold Data limite no formato 'YYYY-MM-DD'.
 */
export async function findOverdueCustomers(
  database: Database,
  threshold: string,
): Promise<OverdueCustomer[]> {
  // Drizzle não suporta GROUP BY com COUNT em select encadeado da mesma forma que raw SQL.
  // Usamos sql`` para COUNT e um subselect para garantir 1 linha por customer.
  const rows = await database
    .select({
      customerId: customers.id,
      organizationId: customers.organizationId,
      cityId: leads.cityId,
      overdueCount: sql<number>`COUNT(${paymentDues.id})::int`,
    })
    .from(paymentDues)
    .innerJoin(customers, eq(paymentDues.customerId, customers.id))
    .innerJoin(leads, eq(customers.primaryLeadId, leads.id))
    .where(
      and(
        // Cliente ainda não iniciou processo SPC
        eq(customers.spcStatus, 'none'),
        // Parcela não quitada (pending ou overdue)
        or(eq(paymentDues.status, 'pending'), eq(paymentDues.status, 'overdue')),
        // 15+ dias de atraso: due_date <= threshold
        lte(paymentDues.dueDate, threshold),
        // Cidade do lead é obrigatória para escopo da tarefa
        isNotNull(leads.cityId),
      ),
    )
    .groupBy(customers.id, customers.organizationId, leads.cityId);

  // Filtra registros sem city_id (null) — leads sem cidade identificada são ignorados.
  // Tipo de cityId após o JOIN pode ser null (leads.cityId é nullable no schema).
  return rows
    .filter((row): row is OverdueCustomer & { cityId: string } => row.cityId !== null)
    .map((row) => ({
      customerId: row.customerId,
      organizationId: row.organizationId,
      cityId: row.cityId as string,
      overdueCount: row.overdueCount,
    }));
}

// ---------------------------------------------------------------------------
// Verificação de tarefa duplicada (segunda camada de idempotência)
// ---------------------------------------------------------------------------

/**
 * Verifica se já existe tarefa spc_inclusion com status='open' para o cliente.
 * Segunda camada de idempotência além da chave em idempotency_keys —
 * evita duplicar tarefas abertas em caso de expiração da chave (> 24h).
 *
 * @returns true se já existe tarefa aberta para o cliente.
 */
export async function hasOpenSpcTask(
  database: Database,
  organizationId: string,
  customerId: string,
): Promise<boolean> {
  const rows = await database
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.organizationId, organizationId),
        eq(tasks.type, TASK_TYPE),
        eq(tasks.status, 'open'),
        eq(tasks.entityType, 'customer'),
        eq(tasks.entityId, customerId),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Verificação de chave de idempotência
// ---------------------------------------------------------------------------

/**
 * Verifica se a chave de idempotência já existe para este cliente.
 * Previne reprocessamento dentro da janela de 24h da mesma execução diária.
 */
async function hasIdempotencyKey(database: Database, key: string): Promise<boolean> {
  const rows = await database
    .select({ key: idempotencyKeys.key })
    .from(idempotencyKeys)
    .where(eq(idempotencyKeys.key, key))
    .limit(1);

  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Tipo de transação unificado (DrizzleTx + insert direto)
// ---------------------------------------------------------------------------

type ScanTx = DrizzleTx & Database;

// ---------------------------------------------------------------------------
// Processamento de um cliente
// ---------------------------------------------------------------------------

/**
 * Processa um cliente elegível em uma transação atômica:
 *   1. Insere tarefa spc_inclusion para role='cobranca'.
 *   2. Emite evento payment_due.overdue_15d no outbox.
 *   3. Persiste chave de idempotência.
 *
 * Se o insert da tarefa retornar 0 linhas (edge case de race condition), lança AppError.
 *
 * @param database Instância Drizzle.
 * @param customer Cliente elegível.
 * @param idempotencyKey Chave canônica de idempotência.
 * @returns UUID da tarefa criada.
 */
export async function processOverdueCustomer(
  database: Database,
  customer: OverdueCustomer,
  idempotencyKey: string,
): Promise<string> {
  return database.transaction(async (tx) => {
    // `as` justificado: transação Drizzle implementa estruturalmente Database + DrizzleTx.
    const txDb = tx as unknown as ScanTx;

    const now = new Date();

    // 1. Criar tarefa spc_inclusion diretamente (role='cobranca' não está no
    //    enum Zod do task service — inserção direta é necessária para este worker).
    const [taskRow] = await txDb
      .insert(tasks)
      .values({
        organizationId: customer.organizationId,
        assigneeRole: COBRANCA_ROLE,
        cityId: customer.cityId,
        type: TASK_TYPE,
        title: 'Cliente com parcela 15+ dias em atraso — verificar inclusão SPC',
        description: null,
        entityType: 'customer',
        entityId: customer.customerId,
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
        `Falha ao criar tarefa para customer ${customer.customerId}`,
      );
    }

    const taskId = taskRow.id;

    // 1b. Registrar auditoria da criação da tarefa (M3 — F15-S08).
    //     actor: null — ação de sistema (worker), sem usuário autenticado.
    //     after: apenas IDs opacos e classificação — sem PII (LGPD §8.5).
    await auditLog(txDb, {
      organizationId: customer.organizationId,
      actor: null,
      action: 'task.created',
      resource: { type: 'task', id: taskId },
      after: {
        task_id: taskId,
        type: TASK_TYPE,
        assignee_role: COBRANCA_ROLE,
        city_id: customer.cityId,
        status: 'open',
      },
    });

    // 2. Emitir evento payment_due.overdue_15d no outbox (sem PII bruta).
    const eventData: PaymentDueOverdue15dData = {
      customer_id: customer.customerId,
      city_id: customer.cityId,
      task_id: taskId,
      overdue_count: customer.overdueCount,
    };

    await emit(txDb, {
      eventName: 'payment_due.overdue_15d',
      aggregateType: 'customer',
      aggregateId: customer.customerId,
      organizationId: customer.organizationId,
      actor: { kind: 'worker', id: null, ip: null },
      idempotencyKey: `payment_due.overdue_15d:${customer.customerId}`,
      data: eventData,
    });

    // 3. Persistir chave de idempotência (previne reprocessamento no mesmo ciclo diário).
    // requestHash: SHA-256 da chave (suficiente — o "request" é determinístico).
    const requestHash = crypto.createHash('sha256').update(idempotencyKey).digest('hex');

    await txDb.insert(idempotencyKeys).values({
      key: idempotencyKey,
      endpoint: 'worker:spc-overdue-scan',
      requestHash,
      responseStatus: 201,
      // LGPD: apenas task_id — sem customer_id para minimizar dados em repouso (B1 — F15-S08).
      responseBody: { task_id: taskId },
    });

    return taskId;
  });
}

// ---------------------------------------------------------------------------
// Tick principal
// ---------------------------------------------------------------------------

/**
 * Executa um tick do spc-overdue-scan:
 *   1. Verifica flag spc.enabled → sai cedo se disabled.
 *   2. Verifica flag spc.scan.enabled → define dryRun.
 *   3. Calcula threshold de 15 dias.
 *   4. Busca clientes elegíveis (spc_status='none' + parcela 15+ dias em atraso).
 *   5. Para cada cliente, verifica idempotência (chave + tarefa aberta existente).
 *   6. Cria tarefa + emite evento em transação atômica.
 *   7. Loga resultado estruturado. Erros por cliente são isolados.
 *
 * @param database Instância Drizzle (injetável para testes).
 * @param logger   Logger do worker.
 */
export async function runSpcOverdueScanTick(
  database: Database,
  logger: ScanLogger,
): Promise<ScanTickResult> {
  // -------------------------------------------------------------------------
  // Camada 1: spc.enabled — gate total.
  // -------------------------------------------------------------------------
  const { enabled: spcEnabled } = await isFlagEnabled(database, 'spc.enabled');
  if (!spcEnabled) {
    logger.debug(
      { event: 'spc_overdue_scan.skipped', flag: 'spc.enabled' },
      'spc.enabled=disabled — tick ignorado',
    );
    return { eligibleCount: 0, processedCount: 0, skippedCount: 0, dryRun: false };
  }

  // -------------------------------------------------------------------------
  // Camada 2: spc.scan.enabled — gate de escrita (dry-run).
  // -------------------------------------------------------------------------
  const { enabled: scanEnabled } = await isFlagEnabled(database, 'spc.scan.enabled');
  const dryRun = !scanEnabled;

  if (dryRun) {
    logger.info(
      { event: 'spc_overdue_scan.dry_run', flag: 'spc.scan.enabled' },
      'spc.scan.enabled=disabled — tick em dry-run (sem inserts)',
    );
  }

  // -------------------------------------------------------------------------
  // Buscar clientes elegíveis
  // -------------------------------------------------------------------------
  const threshold = calcOverdueThreshold();
  const overdueCustomers = await findOverdueCustomers(database, threshold);

  const eligibleCount = overdueCustomers.length;

  if (eligibleCount === 0) {
    logger.info(
      { event: 'spc_overdue_scan.no_eligible', threshold },
      'nenhum cliente com 15+ dias de atraso e spc_status=none',
    );
    return { eligibleCount: 0, processedCount: 0, skippedCount: 0, dryRun };
  }

  logger.info(
    { event: 'spc_overdue_scan.eligible_found', count: eligibleCount, threshold, dryRun },
    `${eligibleCount} clientes elegíveis encontrados`,
  );

  // -------------------------------------------------------------------------
  // Processar cada cliente
  // -------------------------------------------------------------------------
  let processedCount = 0;
  let skippedCount = 0;

  for (const customer of overdueCustomers) {
    const idempotencyKey = buildScanIdempotencyKey(customer.customerId);

    try {
      // Verificar chave de idempotência (ciclo diário)
      const alreadyProcessed = await hasIdempotencyKey(database, idempotencyKey);
      if (alreadyProcessed) {
        logger.debug(
          {
            event: 'spc_overdue_scan.customer_skipped.idempotency_key',
            customer_id: customer.customerId,
          },
          'cliente já processado neste ciclo — chave de idempotência existente',
        );
        skippedCount++;
        continue;
      }

      // Verificar se já existe tarefa spc_inclusion aberta (segunda camada)
      const hasExistingTask = await hasOpenSpcTask(
        database,
        customer.organizationId,
        customer.customerId,
      );
      if (hasExistingTask) {
        logger.debug(
          {
            event: 'spc_overdue_scan.customer_skipped.open_task_exists',
            customer_id: customer.customerId,
          },
          'cliente já tem tarefa spc_inclusion aberta — ignorando',
        );
        skippedCount++;
        continue;
      }

      if (dryRun) {
        logger.info(
          {
            event: 'spc_overdue_scan.dry_run.would_process',
            customer_id: customer.customerId,
            overdue_count: customer.overdueCount,
          },
          'dry-run: cliente seria processado',
        );
        continue;
      }

      // Criar tarefa + emitir evento em transação atômica
      const taskId = await processOverdueCustomer(database, customer, idempotencyKey);

      // B2 (F15-S08): nível info sem customer_id (PII por correlação). Correlação em debug.
      logger.info(
        {
          event: 'spc_overdue_scan.customer_processed',
          task_id: taskId,
          city_id: customer.cityId,
        },
        'tarefa spc_inclusion criada e evento emitido',
      );
      logger.debug(
        {
          event: 'spc_overdue_scan.customer_processed.detail',
          customer_id: customer.customerId,
          task_id: taskId,
        },
        'detalhe spc-overdue-scan — customer_id disponível apenas em debug',
      );

      processedCount++;
    } catch (err: unknown) {
      // Isola falha por cliente — outros clientes continuam sendo processados.
      logger.error(
        {
          event: 'spc_overdue_scan.customer_error',
          customer_id: customer.customerId,
          err,
        },
        'erro ao processar cliente inadimplente — próximo cliente será processado normalmente',
      );
    }
  }

  logger.info(
    {
      event: 'spc_overdue_scan.tick_complete',
      eligibleCount,
      processedCount,
      skippedCount,
      dryRun,
    },
    'tick spc-overdue-scan concluído',
  );

  return { eligibleCount, processedCount, skippedCount, dryRun };
}

// ---------------------------------------------------------------------------
// Entrypoint (processo separado)
// ---------------------------------------------------------------------------

const runtime = createWorkerRuntime(WORKER_NAME, 3);

export { runtime as _workerRuntime };

async function main(): Promise<void> {
  const tickMs = getTickMs();
  runtime.logger.info({ worker: WORKER_NAME, tick_ms: tickMs }, 'spc-overdue-scan iniciado');

  while (!runtime.isShuttingDown()) {
    try {
      await runSpcOverdueScanTick(defaultDb, runtime.logger);
    } catch (err: unknown) {
      runtime.logger.error(
        { err: { message: err instanceof Error ? err.message : String(err) } },
        'spc-overdue-scan: erro inesperado no tick',
      );
    }
    await sleep(tickMs);
  }
}

// Guard: só executar main() quando rodado diretamente
if (process.argv[1] !== undefined && process.argv[1].includes('spc-overdue-scan')) {
  main().catch((err: unknown) => {
    runtime.logger.fatal(
      { err: { message: err instanceof Error ? err.message : String(err) } },
      'spc-overdue-scan: falha fatal',
    );
    process.exit(1);
  });
}
