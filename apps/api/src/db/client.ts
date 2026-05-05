// =============================================================================
// Cliente Drizzle/Postgres compartilhado.
// Use `db` em todos os repositories.
// =============================================================================
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { env } from '../config/env.js';

import * as schema from './schema/index.js';

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});

export const db = drizzle(pool, { schema, logger: env.NODE_ENV === 'development' });

export type Database = typeof db;
