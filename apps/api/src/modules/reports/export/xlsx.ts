// =============================================================================
// reports/export/xlsx.ts — Geração de XLSX com exceljs (F23-S09).
//
// Justificativa da dependência (PROTOCOL §1.3):
//   Usamos `exceljs` (não `xlsx`/SheetJS) pois o SheetJS possui CVE de
//   prototype pollution documentado na auditoria de segurança de 2026-06-22.
//   O exceljs não tem esse CVE e é mantido ativamente.
//
// LGPD: recebe apenas agregados (sem PII). RBAC/escopo validados no service.
// =============================================================================
import ExcelJS from 'exceljs';

export interface XlsxSheet {
  name: string;
  rows: Record<string, unknown>[];
}

/**
 * Serializa um ou mais sheets em um workbook XLSX.
 * Cada sheet tem um cabeçalho bold + dados.
 *
 * @param sheets  Array de sheets (name + rows).
 * @returns       Buffer contendo o XLSX.
 */
export async function serializeToXlsx(sheets: XlsxSheet[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Elemento — Banco do Povo / SEDEC-RO';
  workbook.created = new Date();

  for (const sheet of sheets) {
    const ws = workbook.addWorksheet(sheet.name.slice(0, 31)); // Excel: max 31 chars

    if (sheet.rows.length === 0) {
      ws.addRow(['Sem dados para o período/filtro selecionado']);
      continue;
    }

    const headers = Object.keys(sheet.rows[0]!);

    // Cabeçalho bold
    const headerRow = ws.addRow(headers);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD6E4F0' },
      };
    });

    // Auto-largura mínima
    headers.forEach((header, idx) => {
      const col = ws.getColumn(idx + 1);
      col.width = Math.max(header.length + 2, 14);
    });

    // Dados
    for (const row of sheet.rows) {
      ws.addRow(headers.map((h) => row[h] ?? ''));
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
