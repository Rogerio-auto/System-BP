// =============================================================================
// internal/prompts/repository.ts — Acesso ao banco para prompt_versions (F9-S09).
//
// Responsabilidade única: buscar a versão ativa de um prompt por chave canônica.
//
// Regras:
//   - Filtra active = true. Apenas uma versão por key pode ter active = true.
//   - O índice parcial idx_prompt_versions_active_key torna a query O(log n).
//   - Retorna null quando não há versão ativa para a key.
//   - temperature e top_p são NUMERIC no DB — chegam como string no Drizzle
//     e devem ser convertidas para number (parseFloat) antes de retornar.
//
// LGPD: prompt_versions não contém PII. Sem redact necessário.
// =============================================================================
import { eq, and } from 'drizzle-orm';

import { db } from '../../../db/client.js';
import { promptVersions } from '../../../db/schema/index.js';

// ---------------------------------------------------------------------------
// Tipo de retorno
// ---------------------------------------------------------------------------

export interface ActivePromptRow {
  key: string;
  version: number;
  body: string;
  contentHash: string;
  modelRecommended: string | null;
  /** null = usar default do gateway. */
  temperature: number | null;
  /** null = usar default do gateway. */
  maxTokens: number | null;
  /** null = usar default do gateway. */
  topP: number | null;
}

// ---------------------------------------------------------------------------
// Função principal
// ---------------------------------------------------------------------------

/**
 * Busca a versão ativa de um prompt pela chave canônica.
 *
 * @param promptKey Chave canônica snake_case (ex: "pre_attendance_classify").
 * @returns Dados da versão ativa, ou null se não existir.
 */
export async function findActivePromptByKey(promptKey: string): Promise<ActivePromptRow | null> {
  const rows = await db
    .select({
      key: promptVersions.key,
      version: promptVersions.version,
      body: promptVersions.body,
      contentHash: promptVersions.contentHash,
      modelRecommended: promptVersions.modelRecommended,
      temperature: promptVersions.temperature,
      maxTokens: promptVersions.maxTokens,
      topP: promptVersions.topP,
    })
    .from(promptVersions)
    .where(and(eq(promptVersions.key, promptKey), eq(promptVersions.active, true)))
    .limit(1);

  const row = rows[0];
  if (row === undefined) return null;

  return {
    key: row.key,
    version: row.version,
    body: row.body,
    contentHash: row.contentHash,
    modelRecommended: row.modelRecommended ?? null,
    // NUMERIC → string no Drizzle → converter para number | null
    temperature:
      row.temperature !== null && row.temperature !== undefined
        ? parseFloat(row.temperature)
        : null,
    maxTokens: row.maxTokens ?? null,
    topP: row.topP !== null && row.topP !== undefined ? parseFloat(row.topP) : null,
  };
}
