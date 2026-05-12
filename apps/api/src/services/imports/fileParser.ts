// =============================================================================
// services/imports/fileParser.ts — Parser de arquivos CSV e XLSX.
//
// Suporte:
//   - CSV: streaming via csv-parse (auto-detect BOM, UTF-8/Latin-1 via BOM strip).
//   - XLSX: memória via xlsx (primeira aba, raw: false para datas como string).
//
// Retorna: Array<Record<string, unknown>> (linhas) + totalRows.
//
// LGPD §8.5: O resultado pode conter PII nas colunas. Nunca logar sem redact.
// =============================================================================
import { readFile } from 'node:fs/promises';

import { parse } from 'csv-parse';
import * as XLSX from 'xlsx';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface ParseResult {
  rows: Array<Record<string, unknown>>;
  totalRows: number;
}

export const SUPPORTED_MIME_TYPES = [
  'text/csv',
  'application/csv',
  'text/comma-separated-values',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
] as const;

export type SupportedMimeType = (typeof SUPPORTED_MIME_TYPES)[number];

export function isSupportedMimeType(mime: string): mime is SupportedMimeType {
  return (SUPPORTED_MIME_TYPES as ReadonlyArray<string>).includes(mime);
}

// ---------------------------------------------------------------------------
// CSV parser (streaming)
// ---------------------------------------------------------------------------

async function parseCSV(filePath: string): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    const rows: Array<Record<string, unknown>> = [];

    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      bom: true,
      trim: true,
      relax_column_count: true,
    });

    parser.on('readable', () => {
      // csv-parse.read() returns null at end of stream — loop until no record
      for (;;) {
        const record = parser.read() as Record<string, unknown> | undefined;
        if (record === undefined || record === null) break;
        rows.push(record);
      }
    });

    parser.on('error', reject);
    parser.on('end', () => resolve({ rows, totalRows: rows.length }));

    readFile(filePath)
      .then((buffer) => {
        parser.write(buffer);
        parser.end();
      })
      .catch(reject);
  });
}

// ---------------------------------------------------------------------------
// XLSX parser
// ---------------------------------------------------------------------------

async function parseXLSX(filePath: string): Promise<ParseResult> {
  const buffer = await readFile(filePath);
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });

  const firstSheetName = workbook.SheetNames[0];
  if (firstSheetName === undefined) {
    return { rows: [], totalRows: 0 };
  }

  const worksheet = workbook.Sheets[firstSheetName];
  if (worksheet === undefined) {
    return { rows: [], totalRows: 0 };
  }

  // raw: false → datas como string ISO, números como string (mais seguro para imports)
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { raw: false });

  return { rows, totalRows: rows.length };
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * Parseia um arquivo CSV ou XLSX e retorna as linhas como objetos.
 * @throws Error se o MIME type não for suportado.
 */
export async function parseFile(filePath: string, mimeType: string): Promise<ParseResult> {
  if (
    mimeType === 'text/csv' ||
    mimeType === 'application/csv' ||
    mimeType === 'text/comma-separated-values'
  ) {
    return parseCSV(filePath);
  }

  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimeType === 'application/vnd.ms-excel'
  ) {
    return parseXLSX(filePath);
  }

  throw new Error(`MIME type não suportado: "${mimeType}"`);
}
