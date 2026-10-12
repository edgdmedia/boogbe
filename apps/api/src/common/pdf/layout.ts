import { formatNaira } from '@boogbe/shared';

export interface Brand {
  name: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  logo?: Buffer | null;
}

export function brandHeader(doc: PDFKit.PDFDocument, b: Brand) {
  if (b.logo) {
    try {
      doc.image(b.logo, 48, 40, { fit: [64, 64] });
    } catch {
      /* unsupported image format: skip the logo rather than fail the document */
    }
  }
  const x = b.logo ? 124 : 48;
  doc.font('bold').fontSize(16).text(b.name, x, 44);
  doc
    .font('body')
    .fontSize(9)
    .fillColor('#5b6d72')
    .text([b.address, b.phone, b.email].filter(Boolean).join('  ·  '), x, 66);
  doc.fillColor('#182d32').moveDown(3);
}

export function row(doc: PDFKit.PDFDocument, label: string, value: string, opts: { bold?: boolean } = {}) {
  const y = doc.y;
  doc
    .font(opts.bold ? 'bold' : 'body')
    .fontSize(11)
    .text(label, 48, y, { width: 300 });
  doc.text(value, 348, y, { width: 199, align: 'right' });
  doc.moveDown(0.4);
}

export const naira = formatNaira;

export function footer(doc: PDFKit.PDFDocument, text: string) {
  doc.font('body').fontSize(8).fillColor('#5b6d72').text(text, 48, 780, { width: 499, align: 'center' });
}
