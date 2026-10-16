import PDFDocument from 'pdfkit';
import { resolve } from 'node:path';

// Standard PDF fonts have no ₦, so documents embed Noto Sans (OFL). Same relative path from src/ and dist/.
const FONTS = resolve(__dirname, '../../../assets/fonts');

/**
 * `subject` goes into the PDF info dictionary, which stays plain text when `compress: false` and the
 * string is ASCII (pdfkit writes anything else as UTF-16). Embedded TrueType text is glyph ids, so the
 * subject is what tests can search.
 */
export function renderPdf(
  draw: (doc: PDFKit.PDFDocument) => void,
  opts: { compress?: boolean; subject?: string; createdAt?: Date } = {},
): Promise<Buffer> {
  return new Promise((ok, fail) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 48,
      compress: opts.compress ?? true,
      // A fixed CreationDate (pdfkit otherwise stamps "now" and derives the file ID from it) makes a document
      // render to the same bytes every time, so an email retry sends an identical payload.
      info: {
        Producer: 'Boogbe',
        ...(opts.subject && { Subject: opts.subject }),
        ...(opts.createdAt && { CreationDate: opts.createdAt }),
      },
    });
    doc.registerFont('body', `${FONTS}/NotoSans-Regular.ttf`);
    doc.registerFont('bold', `${FONTS}/NotoSans-Bold.ttf`);
    doc.font('body');
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => ok(Buffer.concat(chunks)));
    doc.on('error', fail);
    draw(doc);
    doc.end();
  });
}
