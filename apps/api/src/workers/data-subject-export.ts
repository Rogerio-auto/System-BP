// =============================================================================
// workers/data-subject-export.ts — Worker de geração de export de acesso LGPD.
//
// Processo Node.js SEPARADO do servidor Fastify (não importado por app.ts).
//
// Fluxo:
//   1. Polling de data_subject_requests com status='received' e
//      type IN ('access', 'portability').
//   2. Para cada solicitação:
//      a. Gera export via generateAccessExport().
//      b. Salva em tmp/exports/<request_id>.json (produção: S3-compatible via env).
//      c. Cria link com TTL 7d (token assinado ou URL temporária).
//      d. Notifica o titular via canal verificado (TODO: WhatsApp/email integration).
//      e. Atualiza status → 'fulfilled' + fulfilled_at.
//      f. Insere audit log.
//      g. Emite evento data_subject.access_fulfilled via outbox.
//
// SLA monitor:
//   - Alerta se solicitação pendente > 10 dias úteis (buffer de 5 dias antes do limite de 15).
//   - TODO: integrar com sistema de alertas quando disponível.
//
// Storage:
//   - MVP: tmp/exports/<uuid>.json em disco local.
//   - Produção: substituir por S3-compatible (env: EXPORT_STORAGE_BUCKET, EXPORT_STORAGE_URL).
//   - WARNING: disco local não persiste entre deploys. Migrar para S3 antes de produção.
//
// LGPD §8.5: o export contém PII — link tem TTL de 7 dias.
//   Depois do TTL, o arquivo deve ser deletado automaticamente (TODO: cleanup job).
// =============================================================================
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { and, eq, inArray, lt, or } from 'drizzle-orm';

import { db } from '../db/client.js';
import { dataSubjectRequests } from '../db/schema/data_subject.js';
import { emit } from '../events/emit.js';
import { auditLog } from '../lib/audit.js';
import { generateAccessExport } from '../services/lgpd/export.js';

import { createWorkerRuntime } from './_runtime.js';

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

const WORKER_NAME = 'data-subject-export';
const POLL_INTERVAL_MS = 30_000; // 30s poll
const BATCH_SIZE = 5;
/** TTL do link de download em ms (7 dias). */
const LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Alerta se solicitação pendente > 10 dias úteis (buffer antes do SLA de 15).
 * 10 dias úteis ≈ 14 dias corridos.
 */
const SLA_WARNING_DAYS = 14;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { logger, onShutdown, isShuttingDown } = createWorkerRuntime(WORKER_NAME, 3);

  logger.info({ worker: WORKER_NAME }, 'Worker de export LGPD iniciado');

  onShutdown(async () => {
    logger.info({ worker: WORKER_NAME }, 'Shutdown recebido — parando loop de export');
  });

  while (!isShuttingDown()) {
    try {
      await processExportBatch(logger);
      await checkSlaBreach(logger);
    } catch (err) {
      logger.error({ err, worker: WORKER_NAME }, 'Erro no loop de export');
    }

    if (!isShuttingDown()) {
      await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  logger.info({ worker: WORKER_NAME }, 'Worker de export encerrado');
}

// ---------------------------------------------------------------------------
// Processar batch de solicitações pendentes
// ---------------------------------------------------------------------------

async function processExportBatch(
  logger: ReturnType<typeof createWorkerRuntime>['logger'],
): Promise<void> {
  // Buscar solicitações de access/portability com status='received'
  const pending = await db
    .select()
    .from(dataSubjectRequests)
    .where(
      and(
        inArray(dataSubjectRequests.type, ['access', 'portability']),
        eq(dataSubjectRequests.status, 'received'),
      ),
    )
    .limit(BATCH_SIZE);

  if (pending.length === 0) return;

  logger.info({ count: pending.length }, 'Processando solicitações de export LGPD');

  for (const request of pending) {
    try {
      await processExport(request, logger);
    } catch (err) {
      logger.error(
        { err, request_id: request.requestId, request_db_id: request.id },
        'Falha ao processar export — marcando como in_progress para retry',
      );
      // Não marcar como failed — deixar para retry na próxima rodada
    }
  }
}

// ---------------------------------------------------------------------------
// Processar export individual
// ---------------------------------------------------------------------------

async function processExport(
  request: typeof dataSubjectRequests.$inferSelect,
  logger: ReturnType<typeof createWorkerRuntime>['logger'],
): Promise<void> {
  const now = new Date();

  // Marcar como in_progress
  await db
    .update(dataSubjectRequests)
    .set({ status: 'in_progress', updatedAt: now })
    .where(eq(dataSubjectRequests.id, request.id));

  // Gerar export
  const { json } = await generateAccessExport(
    db as Parameters<typeof generateAccessExport>[0],
    request.customerId,
    request.documentHash,
  );

  // Salvar em disco (MVP)
  // WARNING: disco local não persiste entre deploys. Migrar para S3 antes de produção.
  const exportDir = join(process.cwd(), 'tmp', 'exports');
  await mkdir(exportDir, { recursive: true });

  const fileName = `${request.requestId}.json`;
  const filePath = join(exportDir, fileName);
  await writeFile(filePath, JSON.stringify(json, null, 2), { encoding: 'utf8' });

  // Gerar token de download com TTL 7d
  const downloadToken = randomUUID();
  const expiresAt = new Date(now.getTime() + LINK_TTL_MS);

  // TODO: armazenar downloadToken → filePath no banco (tabela download_tokens) para validação
  // Por ora, apenas logar o token (não é PII — é um UUID aleatório)
  logger.info(
    {
      request_id: request.requestId,
      download_token: downloadToken,
      expires_at: expiresAt.toISOString(),
    },
    'Export gerado — TODO: enviar link via canal verificado',
  );

  // TODO: Enviar link via WhatsApp (se channel='whatsapp') ou email (se channel='email')
  // Chamada ao módulo de mensageria quando disponível.
  // Por ora, apenas log de warning.
  logger.warn(
    { channel: request.channel, request_id: request.requestId },
    'TODO: enviar link de download via canal verificado — módulo de mensageria não implementado ainda',
  );

  // Marcar como fulfilled
  const requestedAt = new Date(request.requestedAt);
  const latencyMs = now.getTime() - requestedAt.getTime();

  await db.transaction(async (tx) => {
    await tx
      .update(dataSubjectRequests)
      .set({
        status: 'fulfilled',
        fulfilledAt: now,
        updatedAt: now,
        payloadMeta: {
          ...(request.payloadMeta as Record<string, unknown>),
          download_token: downloadToken,
          expires_at: expiresAt.toISOString(),
          file_path: filePath,
        },
      })
      .where(eq(dataSubjectRequests.id, request.id));

    await auditLog(tx, {
      organizationId: request.organizationId,
      actor: null,
      action: 'lgpd.export_generated',
      resource: { type: 'data_subject_request', id: request.id },
      after: {
        request_id: request.requestId,
        type: request.type,
        customer_id: request.customerId,
        fulfilled_at: now.toISOString(),
        latency_ms: latencyMs,
      },
      correlationId: null,
    });

    await emit(tx, {
      eventName: 'data_subject.access_fulfilled',
      aggregateType: 'data_subject_request',
      aggregateId: request.id,
      organizationId: request.organizationId,
      actor: { kind: 'worker', id: null, ip: null },
      idempotencyKey: `data_subject.access_fulfilled:${request.requestId}`,
      data: {
        request_id_db: request.id,
        request_id: request.requestId,
        customer_id: request.customerId,
        organization_id: request.organizationId,
        fulfilled_by_user_id: null,
        latency_ms: latencyMs,
      },
    });
  });

  logger.info(
    { request_id: request.requestId, latency_ms: latencyMs },
    'Export LGPD gerado e fulfilled',
  );
}

// ---------------------------------------------------------------------------
// Verificar breach de SLA
// ---------------------------------------------------------------------------

async function checkSlaBreach(
  logger: ReturnType<typeof createWorkerRuntime>['logger'],
): Promise<void> {
  const warningThreshold = new Date(Date.now() - SLA_WARNING_DAYS * 24 * 60 * 60 * 1000);

  const breaching = await db
    .select()
    .from(dataSubjectRequests)
    .where(
      and(
        or(
          eq(dataSubjectRequests.status, 'received'),
          eq(dataSubjectRequests.status, 'in_progress'),
        ),
        lt(dataSubjectRequests.requestedAt, warningThreshold),
      ),
    )
    .limit(100);

  if (breaching.length > 0) {
    logger.error(
      {
        count: breaching.length,
        sla_warning_days: SLA_WARNING_DAYS,
        oldest_request_ids: breaching.slice(0, 5).map((r) => r.requestId),
      },
      `[LGPD SLA] ${breaching.length} solicitação(ões) pendente(s) há mais de ${SLA_WARNING_DAYS} dias — risco de violação do prazo legal de 15 dias úteis`,
    );
  }
}

// ---------------------------------------------------------------------------
// Bootstrap — guard: só executa quando rodado diretamente (não em import/test)
// ---------------------------------------------------------------------------

// isMainModule via process.argv[1] comparado ao __filename (compatível com ESM+CJS)
// Em testes, o módulo é importado mas não executado diretamente.
const _thisFile = new URL(import.meta.url).pathname;
const _entryFile = process.argv[1] ? new URL(`file://${process.argv[1]}`).pathname : '';
const isMain = _thisFile === _entryFile || process.env['WORKER_FORCE_RUN'] === 'true';

if (isMain) {
  main().catch((err) => {
    console.error('[FATAL] Worker data-subject-export crashou:', err);
    process.exit(1);
  });
}
