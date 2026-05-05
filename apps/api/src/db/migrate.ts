// =============================================================================
// Runner de migrations Drizzle. Rodado em CI antes do deploy da API.
// =============================================================================
import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { db, pool } from './client.js';

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('🗄️  Aplicando migrations...');
  await migrate(db, { migrationsFolder: './src/db/migrations' });
  // eslint-disable-next-line no-console
  console.log('✅ Migrations aplicadas');
  await pool.end();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('❌ Falha ao migrar:', err);
  process.exit(1);
});
