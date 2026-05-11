// =============================================================================
// Cliente Drizzle/Postgres compartilhado.
// Use `db` em todos os repositories.
// =============================================================================
import { drizzle } from 'drizzle-orm/node-postgres';
// `pg` é um módulo CJS. Em ESM strict, named imports de CJS só funcionam via
// interop do bundler — não em Node.js nativo. O default import retorna o módulo
// inteiro com Pool disponível como propriedade.
import pg from 'pg';

import { env } from '../config/env.js';

import * as schema from './schema/index.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});

export const db = drizzle(pool, { schema, logger: env.NODE_ENV === 'development' });

export type Database = typeof db;
