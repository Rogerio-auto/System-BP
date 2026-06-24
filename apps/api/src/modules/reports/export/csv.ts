// =============================================================================
// reports/export/csv.ts — Geração de CSV sem dependência externa (F23-S09).
//
// LGPD: esta camada só recebe agregados (sem PII). A validação de escopo/RBAC
// ocorre no service antes de chamar essas funções.
// =============================================================================

/**
 * Escapa um valor para CSV RFC 4180:
 * - Envolve com aspas duplas se contiver vírgula, aspas ou quebra de linha.
 * - Duplica aspas duplas internas.
 */
function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Serializa um array de objetos planos como CSV UTF-8 com BOM.
 * O BOM (EF BB BF) garante que o Excel abre corretamente no Windows.
 *
 * @param rows  Array de objetos — todas as chaves são usadas como cabeçalho.
 * @returns     Buffer contendo o CSV (UTF-8 com BOM).
 */
export function serializeToCsv(rows: Record<string, unknown>[]): Buffer {
  if (rows.length === 0) {
    const bom = '﻿';
    return Buffer.from(bom + '\r\n', 'utf8');
  }

  const headers = Object.keys(rows[0]!);
  const lines: string[] = [];

  // BOM + cabeçalho
  lines.push('﻿' + headers.map(escapeCsvValue).join(','));

  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsvValue(row[h])).join(','));
  }

  return Buffer.from(lines.join('\r\n'), 'utf8');
}
