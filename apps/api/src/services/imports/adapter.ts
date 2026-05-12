// =============================================================================
// services/imports/adapter.ts — Interface genérica do adapter de importação.
//
// Cada tipo de entidade (leads, customers, agents, ...) implementa ImportAdapter.
// O worker chama as 3 fases sequencialmente:
//   1. parseRow(raw)     → extrai campos estruturados da linha bruta.
//   2. validateRow(...)  → valida, normaliza, verifica dedupe.
//   3. persistRow(...)   → cria a entidade na base.
//
// ImportContext é injetado pelo worker e contém o contexto de segurança mínimo
// necessário para validar e persistir (org, user, batch, row index, IP).
// =============================================================================
import type { Database } from '../../db/client.js';

// ---------------------------------------------------------------------------
// Tipos compartilhados
// ---------------------------------------------------------------------------

/** Contexto injetado pelo worker em cada chamada de validateRow/persistRow. */
export interface ImportContext {
  organizationId: string;
  userId: string;
  batchId: string;
  rowIndex: number;
  ip: string | null;
}

/** Resultado de persistRow — contém o ID da entidade criada. */
export interface PersistResult {
  entityId: string;
}

/** Tipo da transação Drizzle (passada ao persistRow para atomicidade). */
export type Transaction = Database;

// ---------------------------------------------------------------------------
// Interface do adapter
// ---------------------------------------------------------------------------

/**
 * Adapter genérico para um tipo de entidade importável.
 *
 * @template TParsed  Tipo do objeto extraído por parseRow.
 * @template TInput   Tipo do input para criar a entidade (passado a persistRow).
 */
export interface ImportAdapter<TParsed, TInput> {
  readonly entityType: string;

  /**
   * Fase 1: extrai campos estruturados da linha bruta do CSV/XLSX.
   * Deve ser síncrono e sem efeitos colaterais.
   *
   * @returns TParsed com os campos extraídos, ou { error: string } se a linha
   *   está corrompida (campo obrigatório ausente, linha vazia, etc.).
   */
  parseRow(raw: Record<string, unknown>): TParsed | { error: string };

  /**
   * Fase 2: valida, normaliza e verifica dedupe.
   * Pode fazer queries de leitura no DB (resolução de city_id, dedupe de phone).
   *
   * @returns { input: TInput } se válido, ou { errors: string[] } com lista de
   *   erros granulares por campo.
   */
  validateRow(
    parsed: TParsed,
    ctx: ImportContext,
  ): Promise<{ input: TInput; errors?: never } | { errors: string[]; input?: never }>;

  /**
   * Fase 3: persiste a entidade na base (dentro da transação do worker).
   * Deve delegar ao service canônico do domínio.
   *
   * @param tx  Transação Drizzle ativa.
   * @returns PersistResult com o ID da entidade criada.
   * @throws AppError se falhar (worker marcará a linha como 'failed').
   */
  persistRow(input: TInput, ctx: ImportContext, tx: Transaction): Promise<PersistResult>;
}

// Alias para usar em maps sem parâmetros genéricos
// `as` justificado: type erasure intencional para o registry
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyAdapter = ImportAdapter<any, any>;

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

/** Verifica se o resultado de parseRow é um erro. */
export function isParseError(result: unknown): result is { error: string } {
  return typeof result === 'object' && result !== null && 'error' in result;
}
