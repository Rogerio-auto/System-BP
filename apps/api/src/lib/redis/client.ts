// =============================================================================
// redis/client.ts - Cliente Redis (ioredis) + distributed lock (F16-S01).
//
// Redlock single-instance via SET NX PX (suficiente para MVP com 1 Redis).
// Nao introduzir cluster Redis ou multi-instance Redlock aqui — decisao
// consciente (D1 do planejamento: 1 Redis no MVP).
//
// runWithDistributedLock(key, ttlMs, fn):
//   - Tenta adquirir o lock com SET NX PX.
//   - Se nao conseguir em maxWaitMs, lanca DistributedLockError.
//   - Libera o lock (DEL) apos fn() — apenas se ainda for o dono (comparando o valor).
// =============================================================================
import Redis from 'ioredis';

import { env } from '../../config/env.js';
import { logger } from '../logger.js';

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _redis: Redis | null = null;

/** Inicializa o cliente Redis. Chame no bootstrap da API. */
export function connectRedis(): Redis {
  if (_redis) return _redis;
  _redis = new Redis(env.REDIS_URL, {
    lazyConnect: false,
    retryStrategy: (times: number) => {
      if (times > 10) {
        logger.error('Redis: limite de tentativas atingido — encerrando.');
        process.exit(1);
      }
      return Math.min(times * 100, 3_000);
    },
    maxRetriesPerRequest: 3,
  });

  _redis.on('connect', () => logger.info('Redis conectado.'));
  _redis.on('error', (err: Error) => logger.error({ err }, 'Erro no Redis'));

  return _redis;
}

/** Retorna o cliente Redis ou lanca se nao inicializado. */
export function getRedis(): Redis {
  if (!_redis) throw new Error('Redis nao conectado. Chame connectRedis() no bootstrap.');
  return _redis;
}

/** Fecha a conexao graciosamente (shutdown hook). */
export async function closeRedis(): Promise<void> {
  await _redis?.quit();
  _redis = null;
}

// ---------------------------------------------------------------------------
// Distributed lock (Redlock single-instance)
// ---------------------------------------------------------------------------

export class DistributedLockError extends Error {
  constructor(key: string) {
    super(`Lock nao adquirido: ${key}`);
    this.name = 'DistributedLockError';
  }
}

/**
 * Executa fn() com lock distribuido na key especificada.
 *
 * @param key     - Chave unica do lock (ex: "livechat:media:wamid.xxx").
 * @param ttlMs   - TTL do lock em ms (auto-expirar se o processo morrer).
 * @param fn      - Funcao a executar enquanto o lock esta ativo.
 * @param opts.maxWaitMs - Tempo maximo esperando pelo lock (default: 5 000 ms).
 * @param opts.retryDelayMs - Intervalo entre tentativas (default: 100 ms).
 * @throws DistributedLockError se o lock nao puder ser adquirido.
 */
/** @internal Tipo minimo do cliente Redis necessario para o lock. */
export type RedisLockClient = {
  set(key: string, val: string, mode: string, ttl: number, flag: string): Promise<string | null>;
  get(key: string): Promise<string | null>;
  eval(script: string, numkeys: number, ...args: string[]): Promise<unknown>;
};

export async function runWithDistributedLock<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
  opts: { maxWaitMs?: number; retryDelayMs?: number; _redisOverride?: RedisLockClient } = {},
): Promise<T> {
  const redis = opts._redisOverride ?? getRedis();
  const { maxWaitMs = 5_000, retryDelayMs = 100 } = opts;

  const lockValue = `lock:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const lockKey = `lock:${key}`;

  const deadline = Date.now() + maxWaitMs;

  // Tenta adquirir o lock com polling
  while (Date.now() < deadline) {
    const acquired = await redis.set(lockKey, lockValue, 'PX', ttlMs, 'NX');
    if (acquired === 'OK') break;
    await new Promise<void>((r) => setTimeout(r, retryDelayMs));
  }

  // Verifica se realmente adquirimos (pode ter expirado o deadline)
  const current = await redis.get(lockKey);
  if (current !== lockValue) {
    throw new DistributedLockError(key);
  }

  try {
    return await fn();
  } finally {
    // Libera apenas se ainda somos os donos (Lua script para atomicidade)
    const luaRelease = `
      if redis.call('get', KEYS[1]) == ARGV[1] then
        return redis.call('del', KEYS[1])
      else
        return 0
      end
    `;
    await redis.eval(luaRelease, 1, lockKey, lockValue);
  }
}
