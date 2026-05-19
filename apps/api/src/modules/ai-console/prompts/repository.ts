// =============================================================================
// ai-console/prompts/repository.ts — Queries Drizzle para prompt_versions (F9-S01).
//
// Notas de design:
//   - Prompts são globais (sem city scope) — não usa applyCityScope.
//   - Imutabilidade: insert-only para versões. Apenas active pode mudar (via activate).
//   - Ativação é sempre via transação gerenciada pelo service (não aqui).
//   - Organization scope não se aplica: prompts do agente são globais de plataforma.
//
// Funções exportadas:
//   listPromptKeys          — lista todos os keys com versão ativa (read)
//   listVersionsByKey       — histórico de versões de uma key (read)
//   findVersionByKeyAndNum  — busca versão específica (read)
//   getMaxVersionForKey     — versão máxima existente para um key (para incrementar)
//   insertPromptVersion     — insere nova versão (write, dentro de tx)
//   deactivateActiveVersion — desativa versão ativa de um key (write, dentro de tx)
//   activateVersion         — ativa uma versão específica por id (write, dentro de tx)
// =============================================================================
import { and, desc, eq, max, sql } from 'drizzle-orm';

import type { Database } from '../../../db/client.js';
import { promptVersions } from '../../../db/schema/promptVersions.js';
import type { NewPromptVersion, PromptVersion } from '../../../db/schema/promptVersions.js';

// ---------------------------------------------------------------------------
// Tipo mínimo de transação (compatível com db.transaction callback arg)
// Drizzle não exporta o tipo de tx publicamente.
// Justificativa do interface estrutural: evitar `any` — apenas as operações
// de insert/update necessárias para a ativação atômica são declaradas aqui.
// ---------------------------------------------------------------------------

export interface PromptsTx {
  update(table: typeof promptVersions): {
    set(values: Partial<typeof promptVersions.$inferInsert>): {
      where(condition: ReturnType<typeof and> | ReturnType<typeof eq>): Promise<unknown>;
    };
  };
  insert(table: typeof promptVersions): {
    values(row: NewPromptVersion): {
      returning(): Promise<PromptVersion[]>;
    };
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Lista todos os keys distintos com sua versão ativa (se houver).
 * Usada para a tela de listagem do Console de IA.
 *
 * Query: agrupa por key, traz dados da linha com active = true (via LEFT JOIN
 * emulado com Drizzle subquery).
 * Ordenado por key ASC para listagem estável.
 */
export async function listPromptKeys(db: Database) {
  // Busca todas as versões ativas (active = true), uma por key
  const activeVersions = await db
    .select({
      key: promptVersions.key,
      activeVersion: promptVersions.version,
      activeVersionId: promptVersions.id,
      modelRecommended: promptVersions.modelRecommended,
      contentHash: promptVersions.contentHash,
      createdAt: promptVersions.createdAt,
    })
    .from(promptVersions)
    .where(eq(promptVersions.active, true))
    .orderBy(promptVersions.key);

  return activeVersions;
}

/**
 * Lista todas as versões de um key, ordenadas por version DESC.
 * @returns Array de PromptVersion, vazio se key não existe.
 */
export async function listVersionsByKey(db: Database, key: string): Promise<PromptVersion[]> {
  return db
    .select()
    .from(promptVersions)
    .where(eq(promptVersions.key, key))
    .orderBy(desc(promptVersions.version));
}

/**
 * Busca versão específica por key + número de versão.
 * @returns PromptVersion | undefined
 */
export async function findVersionByKeyAndNum(
  db: Database,
  key: string,
  version: number,
): Promise<PromptVersion | undefined> {
  const [row] = await db
    .select()
    .from(promptVersions)
    .where(and(eq(promptVersions.key, key), eq(promptVersions.version, version)))
    .limit(1);

  return row;
}

/**
 * Retorna o número da versão mais alta existente para um key.
 * Retorna 0 se o key não existe ainda (primeira versão será 1).
 */
export async function getMaxVersionForKey(db: Database, key: string): Promise<number> {
  const [row] = await db
    .select({ maxVersion: max(promptVersions.version) })
    .from(promptVersions)
    .where(eq(promptVersions.key, key));

  return row?.maxVersion ?? 0;
}

// ---------------------------------------------------------------------------
// Writes (executados dentro de transação — tx passado pelo service)
// ---------------------------------------------------------------------------

/**
 * Insere nova versão de prompt dentro de uma transação ativa.
 * @param tx Transação Drizzle ativa (não commita).
 * @param data Dados da nova versão.
 * @returns PromptVersion inserida.
 */
export async function insertPromptVersion(
  tx: PromptsTx,
  data: NewPromptVersion,
): Promise<PromptVersion> {
  const [inserted] = await tx.insert(promptVersions).values(data).returning();

  // Justificativa do `!`: Postgres retorna exatamente 1 linha após insert com returning().
  // Se a inserção falhar por constraint, o Postgres lança erro antes de chegar aqui.
  return inserted!;
}

/**
 * Desativa a versão ativa atual de um key (SET active = false).
 * Executado dentro de transação — chamado antes de activateVersion.
 *
 * @param tx Transação Drizzle ativa.
 * @param key Chave do prompt.
 */
export async function deactivateActiveVersion(tx: PromptsTx, key: string): Promise<void> {
  await tx
    .update(promptVersions)
    .set({ active: false })
    .where(and(eq(promptVersions.key, key), eq(promptVersions.active, true)));
}

/**
 * Ativa uma versão específica por ID (SET active = true).
 * Executado dentro de transação — chamado APÓS deactivateActiveVersion.
 *
 * @param tx Transação Drizzle ativa.
 * @param id UUID da versão a ativar.
 */
export async function activateVersion(tx: PromptsTx, id: string): Promise<void> {
  await tx.update(promptVersions).set({ active: true }).where(eq(promptVersions.id, id));
}

/**
 * Busca uma versão por ID (para verificar existência antes de ativar).
 */
export async function findVersionById(
  db: Database,
  id: string,
): Promise<PromptVersion | undefined> {
  const [row] = await db.select().from(promptVersions).where(eq(promptVersions.id, id)).limit(1);

  return row;
}

/**
 * Busca a versão ativa de um key (para snapshot de audit before).
 */
export async function findActiveVersionByKey(
  db: Database,
  key: string,
): Promise<PromptVersion | undefined> {
  const [row] = await db
    .select()
    .from(promptVersions)
    .where(and(eq(promptVersions.key, key), eq(promptVersions.active, true)))
    .limit(1);

  return row;
}

// ---------------------------------------------------------------------------
// Utilitário: check de duplicata por content_hash para idempotência
// ---------------------------------------------------------------------------

/**
 * Busca versão existente de um key com o mesmo content_hash.
 * Usado para idempotência: se já existe versão com hash idêntico, retorna ela.
 */
export async function findVersionByKeyAndHash(
  db: Database,
  key: string,
  contentHash: string,
): Promise<PromptVersion | undefined> {
  const [row] = await db
    .select()
    .from(promptVersions)
    .where(and(eq(promptVersions.key, key), sql`${promptVersions.contentHash} = ${contentHash}`))
    .limit(1);

  return row;
}
