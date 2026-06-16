// redis/index.ts - Re-exports do modulo Redis (F16-S01).
export {
  connectRedis,
  closeRedis,
  getRedis,
  runWithDistributedLock,
  DistributedLockError,
} from './client.js';
