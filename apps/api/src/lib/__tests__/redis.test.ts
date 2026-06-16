import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { DistributedLockError, runWithDistributedLock } from '../redis/client.js';
import type { RedisLockClient } from '../redis/client.js';

// Usa _redisOverride para injecao de dependencia — sem mock de modulo ESM.
function makeFakeRedis(): RedisLockClient & {
  set: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  eval: ReturnType<typeof vi.fn>;
} {
  return {
    set: vi.fn(),
    get: vi.fn(),
    eval: vi.fn().mockResolvedValue(1),
  };
}

describe('runWithDistributedLock', () => {
  let fakeRedis: ReturnType<typeof makeFakeRedis>;

  beforeEach(() => {
    fakeRedis = makeFakeRedis();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('executa fn() quando lock adquirido', async () => {
    fakeRedis.set.mockResolvedValue('OK');
    fakeRedis.get.mockImplementation(async () => {
      const calls = fakeRedis.set.mock.calls as Array<unknown[]>;
      return calls.length > 0 ? ((calls[0]?.[1] as string | null) ?? null) : null;
    });
    const fn = vi.fn().mockResolvedValue(42);
    const result = await runWithDistributedLock('test-key', 5000, fn, {
      _redisOverride: fakeRedis,
    });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result).toBe(42);
  });

  it('lanca DistributedLockError se lock nao adquirido', async () => {
    fakeRedis.set.mockResolvedValue(null);
    fakeRedis.get.mockResolvedValue('outro-dono');
    const fn = vi.fn();
    await expect(
      runWithDistributedLock('busy-key', 5000, fn, { maxWaitMs: 50, _redisOverride: fakeRedis }),
    ).rejects.toThrow(DistributedLockError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('libera o lock apos fn() mesmo se fn() lancou', async () => {
    fakeRedis.set.mockResolvedValue('OK');
    fakeRedis.get.mockImplementation(async () => {
      const calls = fakeRedis.set.mock.calls as Array<unknown[]>;
      return calls.length > 0 ? ((calls[0]?.[1] as string | null) ?? null) : null;
    });
    const fn = vi.fn().mockRejectedValue(new Error('fn-error'));
    await expect(
      runWithDistributedLock('err-key', 5000, fn, { _redisOverride: fakeRedis }),
    ).rejects.toThrow();
    expect(fakeRedis.eval).toHaveBeenCalledTimes(1);
  });

  it('DistributedLockError tem nome correto', () => {
    const err = new DistributedLockError('my-key');
    expect(err.name).toBe('DistributedLockError');
    expect(err).toBeInstanceOf(Error);
  });
});
