// =============================================================================
// lib/featureFlags.ts — Helper de worker para feature flags (F1-S23).
//
// Uso em workers/jobs:
//   if (await requireFlag(db, 'followup.enabled', logger)) {
//     // executa job
//   }
//   // ou como guard no início do loop:
//   await requireFlag(db, 'followup.enabled', logger);
//
// Comportamento:
//   - Flag 'enabled'  → retorna true (job pode rodar).
//   - Flag não-enabled → loga evento 'job.skipped_feature_disabled' e retorna false.
//   - O worker decide se cancela ou pula — não lança erro.
//
// Schedulers que criam novos jobs devem checar a flag ANTES de inserir:
//   const { enabled } = await isFlagEnabled(db, 'followup.enabled');
//   if (!enabled) return; // não agenda
// =============================================================================
import type pino from 'pino';

import type { Database } from '../db/client.js';
import { isFlagEnabled } from '../modules/featureFlags/service.js';

/**
 * Verifica se uma feature flag está habilitada para um worker/job.
 *
 * @param db       Instância do banco (db do worker runtime ou transação).
 * @param flagKey  Chave da flag. Ex: 'followup.enabled'.
 * @param logger   Logger Pino do worker (para estrutura de log canônica).
 * @param jobId    ID do job sendo verificado (opcional, para rastreabilidade).
 *
 * @returns true se o job deve prosseguir, false se deve ser pulado/cancelado.
 *
 * @example
 * // No início de cada job:
 * if (!await requireFlag(db, 'followup.enabled', logger, job.id)) {
 *   await markJobCancelled(db, job.id, 'feature_disabled');
 *   return;
 * }
 */
export async function requireFlag(
  db: Database,
  flagKey: string,
  logger: pino.Logger,
  jobId?: string,
): Promise<boolean> {
  const { enabled, status } = await isFlagEnabled(db, flagKey);

  if (!enabled) {
    logger.info(
      {
        event: 'job.skipped_feature_disabled',
        flag: flagKey,
        flag_status: status,
        job_id: jobId ?? null,
      },
      `Job pulado: feature flag '${flagKey}' está ${status}`,
    );
    return false;
  }

  return true;
}
