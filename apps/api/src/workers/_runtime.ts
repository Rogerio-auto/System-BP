// =============================================================================
// workers/_runtime.ts — Bootstrap mínimo compartilhado pelos workers Node.
//
// Responsabilidades:
//   1. Criar logger Pino com a mesma configuração de redact do server (doc 17 §8.3).
//   2. Criar pool de conexão Postgres dedicado para o worker.
//   3. Registrar SIGTERM/SIGINT para graceful shutdown.
//   4. Expor função `onShutdown` para o loop principal registrar cleanup.
//
// Uso:
//   import { createWorkerRuntime } from './_runtime.js';
//   const { logger, pool, db, onShutdown } = createWorkerRuntime('outbox-publisher');
//   onShutdown(async () => { /* limpar recursos */ });
// =============================================================================
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import pino from 'pino';

import { env } from '../config/env.js';
import * as schema from '../db/schema/index.js';

const { Pool } = pg;

// ---------------------------------------------------------------------------
// Logger com redact canônico (doc 17 §8.3)
// ---------------------------------------------------------------------------

/**
 * Lista canônica de campos PII a serem redacted nos logs de worker.
 * Mesma lista do server (app.ts). Mantida aqui para independência do processo.
 */
const REDACT_PATHS = [
  '*.cpf',
  '*.cpf_hash',
  '*.email',
  '*.telefone',
  '*.phone',
  '*.password',
  '*.password_hash',
  '*.senha',
  '*.refresh_token',
  '*.access_token',
  '*.token',
  '*.totp_secret',
  '*.document_number',
  '*.birth_date',
  '*.address',
];

function createWorkerLogger(workerName: string): pino.Logger {
  return pino({
    name: workerName,
    level: env.LOG_LEVEL,
    redact: {
      paths: REDACT_PATHS,
      censor: '[REDACTED]',
    },
    ...(env.NODE_ENV === 'development'
      ? {
          transport: {
            target: 'pino-pretty',
            options: { translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
          },
        }
      : {}),
  });
}

// ---------------------------------------------------------------------------
// Tipo do runtime do worker
// ---------------------------------------------------------------------------

export interface WorkerRuntime {
  logger: pino.Logger;
  pool: pg.Pool;
  db: ReturnType<typeof drizzle<typeof schema>>;
  /**
   * Registra um callback chamado no shutdown gracioso (SIGTERM/SIGINT).
   * Múltiplos callbacks são chamados em ordem de registro.
   */
  onShutdown: (cb: () => Promise<void>) => void;
  /**
   * Promise que resolve quando o processo receber sinal de shutdown.
   * Use `await shutdownSignal` para parar o loop principal.
   */
  shutdownSignal: Promise<void>;
  /**
   * true após receber sinal de shutdown.
   * Alternativa a `await shutdownSignal` para loops com flag de controle.
   */
  isShuttingDown: () => boolean;
}

// ---------------------------------------------------------------------------
// createWorkerRuntime()
// ---------------------------------------------------------------------------

/**
 * Inicializa o runtime de um worker Node.js separado.
 *
 * @param workerName Nome do worker (para logs). Ex: 'outbox-publisher'.
 * @param poolSize   Tamanho máximo do pool de conexões (default: 5).
 */
export function createWorkerRuntime(workerName: string, poolSize = 5): WorkerRuntime {
  const logger = createWorkerLogger(workerName);

  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: poolSize,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  const db = drizzle(pool, { schema, logger: env.NODE_ENV === 'development' });

  // -------------------------------------------------------------------------
  // Graceful shutdown
  // -------------------------------------------------------------------------

  const shutdownCallbacks: Array<() => Promise<void>> = [];
  let shuttingDown = false;

  let resolveShutdown!: () => void;
  const shutdownSignal = new Promise<void>((resolve) => {
    resolveShutdown = resolve;
  });

  const handleSignal = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutdown signal received — draining gracefully');

    resolveShutdown();

    void (async () => {
      for (const cb of shutdownCallbacks) {
        try {
          await cb();
        } catch (err) {
          logger.error({ err }, 'error in shutdown callback');
        }
      }

      try {
        await pool.end();
        logger.info('database pool closed');
      } catch (err) {
        logger.error({ err }, 'error closing database pool');
      }

      logger.info('worker shutdown complete');
      process.exit(0);
    })();
  };

  process.once('SIGTERM', handleSignal);
  process.once('SIGINT', handleSignal);

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'unhandledRejection — encerrando worker');
    process.exit(1);
  });

  function onShutdown(cb: () => Promise<void>): void {
    shutdownCallbacks.push(cb);
  }

  function isShuttingDown(): boolean {
    return shuttingDown;
  }

  logger.info({ workerName, poolSize }, 'worker runtime initialized');

  return { logger, pool, db, onShutdown, shutdownSignal, isShuttingDown };
}
