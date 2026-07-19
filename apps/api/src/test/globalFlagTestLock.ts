// =============================================================================
// test/globalFlagTestLock.ts — advisory lock para serializar testes de
// integração que manipulam a MESMA flag global em `feature_flags`
// (ex.: `assistant.history.enabled`, sem escopo por organização).
//
// Por quê: vitest roda cada arquivo de teste em um processo (fork) isolado,
// mas todos compartilham o MESMO Postgres de teste. Quando 2+ arquivos
// (hydration/persistence/retention.integration.test.ts) fazem
// enable/disableHistoryFlag() concorrentemente sobre a MESMA linha global,
// o toggle de um arquivo pisa no do outro — falso-vermelho não relacionado
// ao código em si (achado ao investigar CI vermelho pré-existente).
//
// Uso: no beforeAll do arquivo (ANTES de qualquer enable/disableFlag), obtenha
// o lock; no afterAll (ANTES de pool.end()), libere. pg_advisory_lock é
// session-scoped — por isso usamos um client dedicado (pool.connect()), não
// o `db`/pool compartilhado, e sempre lock/unlock na MESMA conexão.
// =============================================================================
import type pg from 'pg';

const LOCK_KEY = 'assistant_history_flag_test_lock';

/**
 * Adquire o advisory lock global (bloqueia até liberado por outro processo).
 * Retorna o client dedicado — guarde-o para chamar `releaseGlobalFlagTestLock`.
 */
export async function acquireGlobalFlagTestLock(pool: pg.Pool): Promise<pg.PoolClient> {
  const client = await pool.connect();
  await client.query('SELECT pg_advisory_lock(hashtext($1))', [LOCK_KEY]);
  return client;
}

/** Libera o advisory lock e devolve o client dedicado ao pool. */
export async function releaseGlobalFlagTestLock(client: pg.PoolClient): Promise<void> {
  try {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_KEY]);
  } finally {
    client.release();
  }
}
