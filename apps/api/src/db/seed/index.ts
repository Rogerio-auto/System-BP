// =============================================================================
// seed/index.ts — Orquestrador de seeds modulares (dados canônicos de sistema).
//
// Este arquivo é o entry point para seeds de dados operacionais não-pessoais:
// configurações, tabelas de referência, pricing de LLM, etc.
//
// Para dados sintéticos de dev/staging, usar src/db/seed-fake.ts.
//
// Idempotente: cada seedXxx() verifica existência antes de inserir.
// Re-rodar não duplica dados.
//
// Para rodar standalone: tsx apps/api/src/db/seed/index.ts
// =============================================================================
/* eslint-disable no-console */

import { pool } from '../client.js';

import { seedModelPricing } from './modelPricing.js';

async function runAllSeeds(): Promise<void> {
  console.log('[seed/index] Iniciando seeds modulares...');

  await seedModelPricing();

  console.log('[seed/index] Todos os seeds modulares concluídos.');
}

runAllSeeds()
  .catch((err: unknown) => {
    console.error('[seed/index] ERRO:', err);
    process.exit(1);
  })
  .finally(() => {
    void pool.end();
  });
