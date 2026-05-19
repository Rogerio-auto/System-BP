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
//   listPromptKeys                — lista todos os keys com versão ativa (read)
//   listVersionsByKey             — histórico de versões de uma key (read)
//   findVersionByKeyAndNum        — busca versão específica (read)
//   findVersionByKeyAndNumForUpdate — busca versão com SELECT FOR UPDATE (tx only)
//   findActiveVersionByKeyForUpdate — busca versão ativa com SELECT FOR UPDATE (tx only)
//   findVersionByKeyAndHashInTx   — verifica duplicata de hash dentro de tx
//   getMaxVersionForKeyForUpdate  — versão máxima com lock exclusivo (tx only)
//   insertPromptVersion           — insere nova versão (write, dentro de tx)
//   deactivateActiveVersion       — desativa versão ativa de um key (write, dentro de tx)
//   activateVersion               — ativa uma versão específica por id (write, dentro de tx)
// =============================================================================
import { and, desc, eq, max, sql } from 'drizzle-orm';

import type { Database } from '../../../db/client.js';
import { promptVersions } from '../../../db/schema/promptVersions.js';
import type { NewPromptVersion, PromptVersion } from '../../../db/schema/promptVersions.js';

// ---------------------------------------------------------------------------
// Tipos de transação (compatível com db.transaction callback arg)
// Drizzle não exporta o tipo de tx publicamente — NodePgTransaction não está
// disponível para import externo sem deep import não-estável.
//
// Justificativa das interfaces estruturais: evitar `any` — declaramos apenas
// os métodos necessários para cada operação.
// ---------------------------------------------------------------------------

/** Interface para operações de insert/update dentro de transação. */
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
 *
 * @deprecated Prefira getMaxVersionForKeyForUpdate dentro de transações para evitar race condition.
 */
export async function getMaxVersionForKey(db: Database, key: string): Promise<number> {
  const [row] = await db
    .select({ maxVersion: max(promptVersions.version) })
    .from(promptVersions)
    .where(eq(promptVersions.key, key));

  return row?.maxVersion ?? 0;
}

/**
 * Retorna o número da versão mais alta para um key com lock exclusivo (SELECT FOR UPDATE).
 *
 * Deve ser chamado DENTRO de uma transação ativa (db.transaction callback).
 * O FOR UPDATE bloqueia outras transações de ler/modificar linhas com o mesmo key
 * até o commit, prevenindo race condition em criação concorrente.
 *
 * Justificativa do sql raw: Drizzle ORM 0.34 não expõe .for('update') na API de select
 * com aggregate (MAX). Usamos sql`` para emitir a cláusula de lock explicitamente.
 *
 * Justificativa do cast `as unknown as Database`: o callback de db.transaction recebe
 * NodePgTransaction, que não é exportado de forma estável pelo Drizzle. NodePgTransaction
 * herda de PgDatabase e PgSession, sendo estruturalmente compatível com Database para
 * todas as operações de query — o cast é seguro.
 *
 * @param tx Transação Drizzle ativa (passada como `tx as unknown as Database` no caller).
 * @param key Chave do prompt.
 * @returns Número máximo de versão ou 0 se key não existe.
 */
export async function getMaxVersionForKeyForUpdate(tx: Database, key: string): Promise<number> {
  // SELECT MAX(version) FROM prompt_versions WHERE key = $1 FOR UPDATE
  // FOR UPDATE: garante lock exclusivo — transações concorrentes bloqueiam
  // até o commit desta transação, eliminando a race condition de versão duplicada.
  //
  // Justificativa do cast no resultado: PgRaw retorna QueryResult<T> do pg.
  // Anotamos T = { max_version: number } mas o cast via unknown é necessário
  // porque Drizzle's PgRaw não é diretamente indexável sem generic explícito.
  const rawResult = await tx.execute(
    sql`SELECT COALESCE(MAX(${promptVersions.version}), 0)::int AS max_version
        FROM ${promptVersions}
        WHERE ${promptVersions.key} = ${key}
        FOR UPDATE`,
  );
  const result = rawResult as unknown as { rows: Array<{ max_version: number }> };
  return result.rows[0]?.max_version ?? 0;
}

/**
 * Busca versão existente de um key com o mesmo content_hash dentro de uma transação.
 * Versão transacional de findVersionByKeyAndHash — para uso em tx onde o lock já
 * foi adquirido por getMaxVersionForKeyForUpdate.
 *
 * @param tx Transação Drizzle ativa (passada como `tx as unknown as Database` no caller).
 * @param key Chave do prompt.
 * @param contentHash SHA-256 hex do body.
 */
export async function findVersionByKeyAndHashInTx(
  tx: Database,
  key: string,
  contentHash: string,
): Promise<PromptVersion | undefined> {
  const [row] = await tx
    .select()
    .from(promptVersions)
    .where(and(eq(promptVersions.key, key), eq(promptVersions.contentHash, contentHash)))
    .limit(1);

  return row;
}

/**
 * Busca versão específica por key + número com lock FOR UPDATE.
 * Deve ser chamado DENTRO de transação. Previne leitura inconsistente
 * entre o check e o UPDATE de ativação.
 *
 * @param tx Transação Drizzle ativa (passada como `tx as unknown as Database` no caller).
 * @param key Chave do prompt.
 * @param version Número da versão.
 */
export async function findVersionByKeyAndNumForUpdate(
  tx: Database,
  key: string,
  version: number,
): Promise<PromptVersion | undefined> {
  // Justificativa do sql raw + cast: necessário para emitir FOR UPDATE.
  // PgRaw retorna QueryResult<Record<string,unknown>>; mapeamos via mapRawRow.
  const rawResult = await tx.execute(
    sql`SELECT * FROM ${promptVersions}
        WHERE ${promptVersions.key} = ${key}
          AND ${promptVersions.version} = ${version}
        LIMIT 1
        FOR UPDATE`,
  );
  const result = rawResult as unknown as { rows: Array<Record<string, unknown>> };
  const row = result.rows[0];
  if (!row) return undefined;

  return mapRawRowToPromptVersion(row);
}

/**
 * Busca a versão ativa de um key com lock FOR UPDATE dentro de uma transação.
 * Previne race condition na ativação: garante snapshot consistente de qual
 * versão estava ativa no início da transação.
 *
 * @param tx Transação Drizzle ativa (passada como `tx as unknown as Database` no caller).
 * @param key Chave do prompt.
 */
export async function findActiveVersionByKeyForUpdate(
  tx: Database,
  key: string,
): Promise<PromptVersion | undefined> {
  const rawResult = await tx.execute(
    sql`SELECT * FROM ${promptVersions}
        WHERE ${promptVersions.key} = ${key}
          AND ${promptVersions.active} = true
        LIMIT 1
        FOR UPDATE`,
  );
  const result = rawResult as unknown as { rows: Array<Record<string, unknown>> };
  const row = result.rows[0];
  if (!row) return undefined;

  return mapRawRowToPromptVersion(row);
}

// ---------------------------------------------------------------------------
// Helper interno: mapeia linha sql raw (snake_case) → PromptVersion (camelCase)
// ---------------------------------------------------------------------------

/**
 * Mapeia uma linha retornada por sql raw para o tipo PromptVersion.
 * Necessário porque tx.execute retorna snake_case (nomenclatura do Postgres)
 * enquanto o schema Drizzle usa camelCase.
 *
 * Justificativa dos casts individuais: resultado de sql raw é Record<string,unknown>.
 * Conhecemos a estrutura da tabela; o satisfies PromptVersion valida em compile time.
 */
function mapRawRowToPromptVersion(row: Record<string, unknown>): PromptVersion {
  return {
    id: row['id'] as string,
    key: row['key'] as string,
    version: row['version'] as number,
    modelRecommended: (row['model_recommended'] as string | null) ?? null,
    contentHash: row['content_hash'] as string,
    active: row['active'] as boolean,
    body: row['body'] as string,
    notes: (row['notes'] as string | null) ?? null,
    createdBy: (row['created_by'] as string | null) ?? null,
    createdAt: new Date(row['created_at'] as string),
  } satisfies PromptVersion;
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
