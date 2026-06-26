// =============================================================================
// workers/supervisor.ts — Process manager dos workers em produção.
//
// Roda um GRUPO de workers (definido por WORKER_GROUP) como processos-filho,
// cada um reusando seu próprio entrypoint compilado (node dist/workers/<nome>.js).
// Reinicia worker que cair (backoff exponencial, reset após rodar estável),
// repassa SIGTERM/SIGINT para shutdown gracioso. Isolamento real por processo:
// um worker que quebra não derruba os irmãos do grupo.
//
// Equivalente em produção ao `concurrently` do `pnpm dev`.
//
// Uso (container): WORKER_GROUP=outbox|livechat|periodic node dist/workers/supervisor.js
//
// Grupos (ver docs/sessions/2026-06-25-plano-finalizacao-deploy.md):
//   - outbox   → outbox-publisher (crítico: propagação de eventos)
//   - livechat → consumers RabbitMQ do live chat
//   - periodic → schedulers (reports-refresh ON; demais gated por flag, idle)
// =============================================================================
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pino from 'pino';

const log = pino({ level: process.env['LOG_LEVEL'] ?? 'info', name: 'workers-supervisor' });

const GROUPS: Record<string, readonly string[]> = {
  outbox: ['outbox-publisher'],
  // NB: livechat-socket-relay NÃO entra aqui — não é worker standalone; precisa do
  // Socket.io server e roda DENTRO do processo do api (server.ts, após app.listen()).
  livechat: ['livechat-inbound', 'livechat-media', 'livechat-outbound', 'livechat-ai'],
  periodic: [
    'reports-refresh',
    'followup-scheduler',
    'followup-sender',
    'collection-scheduler',
    'collection-sender',
    'spc-overdue-scan',
    'winback-scan',
    'import-processor',
    'cron-retention',
  ],
};

const MAX_BACKOFF_MS = 30_000;
const STABLE_MS = 60_000; // processo estável (>STABLE_MS) reseta o contador de backoff

const group = process.env['WORKER_GROUP'];
if (group === undefined || !(group in GROUPS)) {
  log.fatal(
    { group, valid: Object.keys(GROUPS) },
    'WORKER_GROUP inválido — defina outbox|livechat|periodic',
  );
  process.exit(1);
}
const workers = GROUPS[group] ?? [];
const baseDir = path.dirname(fileURLToPath(import.meta.url)); // dist/workers
const children = new Map<string, ChildProcess>();
let shuttingDown = false;

function startWorker(name: string, attempt: number): void {
  if (shuttingDown) return;
  const file = path.join(baseDir, `${name}.js`);
  const startedAt = Date.now();
  const child = spawn(process.execPath, [file], { stdio: 'inherit', env: process.env });
  children.set(name, child);
  log.info({ worker: name, pid: child.pid, attempt }, 'worker iniciado');

  child.on('exit', (code, signal) => {
    children.delete(name);
    if (shuttingDown) {
      log.info({ worker: name, code, signal }, 'worker encerrado (shutdown)');
      return;
    }
    // Saída limpa (code 0, sem sinal) = o worker decidiu parar (ex: gated por flag).
    // Não reinicia — evitaria loop de restart de um worker que terminou de propósito.
    if (code === 0 && signal === null) {
      log.warn({ worker: name }, 'worker terminou limpo (code 0) — não reiniciando');
      return;
    }
    const ranMs = Date.now() - startedAt;
    const nextAttempt = ranMs > STABLE_MS ? 0 : attempt + 1;
    const delay = Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** Math.min(nextAttempt, 5));
    log.error(
      { worker: name, code, signal, ranMs, nextAttempt, delayMs: delay },
      'worker caiu — reiniciando',
    );
    const t = setTimeout(() => startWorker(name, nextAttempt), delay);
    t.unref();
  });

  child.on('error', (err: Error) => {
    log.error({ worker: name, err: { message: err.message } }, 'falha ao spawnar worker');
  });
}

function shutdown(sig: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(
    { sig, workers: children.size },
    'encerrando supervisor — propagando SIGTERM aos workers',
  );
  for (const child of children.values()) child.kill('SIGTERM');
  const force = setTimeout(() => {
    log.warn('timeout de shutdown — forçando saída');
    process.exit(0);
  }, 15_000);
  force.unref();
  const poll = setInterval(() => {
    if (children.size === 0) {
      clearInterval(poll);
      clearTimeout(force);
      log.info('todos os workers encerraram — saindo');
      process.exit(0);
    }
  }, 500);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

log.info({ group, workers }, 'supervisor iniciando workers do grupo');
for (const name of workers) startWorker(name, 0);
