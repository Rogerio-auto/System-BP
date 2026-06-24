// =============================================================================
// reports/export/pdf.ts — Geração de PDF com pdfkit (F23-S09).
//
// Justificativa da dependência (PROTOCOL §1.3):
//   `pdfkit` é a opção MVP (D4 resolvida no plano §10): zero infra extra,
//   geração programática, sem render headless. Reabrir se layout exigir
//   fidelidade visual alta em versões futuras.
//
// LGPD: recebe apenas agregados (sem PII). RBAC/escopo validados no service.
// =============================================================================
import PDFDocument from 'pdfkit';

export interface PdfSection {
  title: string;
  rows: Record<string, unknown>[];
}

const BRAND_BLUE = '#003366'; // Paleta SEDEC-RO
const BRAND_LIGHT = '#D6E4F0';
const TEXT_DARK = '#1A1A2E';
const TEXT_MUTED = '#6B7280';

/**
 * Serializa um array de seções em um PDF formatado (branding Banco do Povo/SEDEC-RO).
 * Cada seção tem um título + tabela de agregados.
 *
 * @param sections      Seções com título e linhas de dados.
 * @param exportedAt    Timestamp da exportação (ISO string).
 * @param scopeLabel    Rótulo do escopo (ex: "Global", "Cidade X", "Meus dados").
 * @returns             Buffer contendo o PDF.
 */
export async function serializeToPdf(
  sections: PdfSection[],
  exportedAt: string,
  scopeLabel: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: 40, size: 'A4' });

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // --- Cabeçalho ---
    doc.rect(0, 0, doc.page.width, 60).fill(BRAND_BLUE);
    doc
      .fillColor('white')
      .fontSize(16)
      .font('Helvetica-Bold')
      .text('Banco do Povo / SEDEC-RO', 40, 18, { lineBreak: false });
    doc
      .fillColor('#A3C4E0')
      .fontSize(9)
      .font('Helvetica')
      .text('Relatório de Métricas — Elemento', 40, 38, { lineBreak: false });

    doc.moveDown(2.5);

    // Metadados do export
    doc
      .fillColor(TEXT_MUTED)
      .fontSize(8)
      .text(
        `Exportado em: ${new Date(exportedAt).toLocaleString('pt-BR', { timeZone: 'America/Porto_Velho' })}   |   Escopo: ${scopeLabel}   |   Dados: apenas agregados (LGPD §3.3 finalidade 8)`,
        { align: 'right' },
      );

    doc.moveDown(0.5);
    doc.strokeColor(BRAND_BLUE).lineWidth(1).moveTo(40, doc.y).lineTo(555, doc.y).stroke();
    doc.moveDown(0.8);

    // --- Seções ---
    for (const section of sections) {
      // Título da seção
      doc.fillColor(BRAND_BLUE).fontSize(12).font('Helvetica-Bold').text(section.title);
      doc.moveDown(0.3);

      if (section.rows.length === 0) {
        doc
          .fillColor(TEXT_MUTED)
          .fontSize(9)
          .font('Helvetica-Oblique')
          .text('Sem dados para o período/filtro selecionado.');
        doc.moveDown(1);
        continue;
      }

      const headers = Object.keys(section.rows[0]!);
      const colWidth = Math.min(Math.floor((doc.page.width - 80) / headers.length), 140);
      const tableX = 40;

      // Cabeçalho da tabela
      const headerY = doc.y;
      doc.rect(tableX, headerY, colWidth * headers.length, 16).fill(BRAND_LIGHT);
      doc.fillColor(TEXT_DARK).fontSize(8).font('Helvetica-Bold');
      headers.forEach((h, i) => {
        doc.text(h, tableX + i * colWidth + 4, headerY + 4, {
          width: colWidth - 6,
          lineBreak: false,
        });
      });
      doc.moveDown(0.1);
      doc.y = headerY + 18;

      // Linhas
      let rowY = doc.y;
      section.rows.forEach((row, rowIdx) => {
        // Nova página se necessário
        if (rowY + 14 > doc.page.height - 60) {
          doc.addPage();
          rowY = 60;
        }

        const fillColor = rowIdx % 2 === 0 ? '#FFFFFF' : '#F7FAFC';
        doc.rect(tableX, rowY, colWidth * headers.length, 14).fill(fillColor);
        doc.fillColor(TEXT_DARK).fontSize(8).font('Helvetica');
        headers.forEach((h, i) => {
          const val = row[h];
          const display = val === null || val === undefined ? '' : String(val);
          doc.text(display, tableX + i * colWidth + 4, rowY + 3, {
            width: colWidth - 6,
            lineBreak: false,
          });
        });
        rowY += 14;
      });

      doc.y = rowY + 8;
      doc.moveDown(0.8);

      // Linha separadora entre seções
      if (doc.y < doc.page.height - 80) {
        doc.strokeColor('#E5E7EB').lineWidth(0.5).moveTo(40, doc.y).lineTo(555, doc.y).stroke();
        doc.moveDown(0.8);
      }
    }

    // Rodapé com numeração de página
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc
        .fillColor(TEXT_MUTED)
        .fontSize(7)
        .text(
          `Página ${i + 1} de ${range.count}   |   Documento gerado pelo sistema Elemento   |   Confidencial`,
          40,
          doc.page.height - 30,
          { align: 'center', width: doc.page.width - 80 },
        );
    }

    doc.end();
  });
}
