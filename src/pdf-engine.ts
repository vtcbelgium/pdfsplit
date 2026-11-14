/**
 * Parse page range expressions like "1-3, 5, 8-10" into 1-based page numbers.
 * Bounds to maxPages if provided, ignores invalid tokens, deduplicates, and sorts.
 */
export function parsePageRange(rangeStr: string, maxPages?: number): number[] {
  if (!rangeStr || !rangeStr.trim()) return [];

  const pages = new Set<number>();
  // Normalize whitespace around hyphens e.g. "1 - 3" -> "1-3"
  const normalized = rangeStr.replace(/\s*-\s*/g, '-');
  const tokens = normalized.split(/[,;\s]+/);

  for (const token of tokens) {
    const trimmed = token.trim();
    if (!trimmed) continue;

    if (trimmed.includes('-')) {
      const parts = trimmed.split('-');
      if (parts.length === 2) {
        const start = parseInt(parts[0], 10);
        const end = parseInt(parts[1], 10);
        if (!isNaN(start) && !isNaN(end) && start > 0 && end >= start) {
          const limit = maxPages ? Math.min(end, maxPages) : end;
          for (let p = start; p <= limit; p++) {
            pages.add(p);
          }
        }
      }
    } else {
      const num = parseInt(trimmed, 10);
      if (!isNaN(num) && num > 0) {
        if (!maxPages || num <= maxPages) {
          pages.add(num);
        }
      }
    }
  }

  return Array.from(pages).sort((a, b) => a - b);
}

/**
 * Resolve page selection when a blank range intentionally means "all pages 1..pageCount".
 */
export function resolveEffectivePages(rangeStr: string, pageCount: number): number[] {
  if (pageCount <= 0) return [];
  if (!rangeStr || !rangeStr.trim()) {
    return Array.from({ length: pageCount }, (_, idx) => idx + 1);
  }
  return parsePageRange(rangeStr, pageCount);
}

/**
 * Split a PDF ArrayBuffer into a new PDF with only the specified 1-based page numbers.
 */
export async function splitPdf(
  pdfBytes: ArrayBuffer,
  pageNumbers: number[]
): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const srcDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const totalPages = srcDoc.getPageCount();

  const newDoc = await PDFDocument.create();

  // Convert 1-based page numbers to 0-based indices, bounded to source pages
  const validIndices = pageNumbers
    .filter((p) => p >= 1 && p <= totalPages)
    .map((p) => p - 1);

  if (validIndices.length === 0) {
    throw new Error('No valid pages selected for extraction.');
  }

  const copiedPages = await newDoc.copyPages(srcDoc, validIndices);
  for (const page of copiedPages) {
    newDoc.addPage(page);
  }

  return await newDoc.save();
}

/**
 * Split requested 1-based pages (or all pages if omitted) into separate single-page PDFs.
 */
export async function splitIntoIndividualPdfs(
  pdfBytes: ArrayBuffer,
  pageNumbers?: number[]
): Promise<{ pageNumber: number; bytes: Uint8Array }[]> {
  const { PDFDocument } = await import('pdf-lib');
  const srcDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const totalPages = srcDoc.getPageCount();

  const targetPages =
    pageNumbers && pageNumbers.length > 0
      ? pageNumbers.filter((p) => p >= 1 && p <= totalPages)
      : Array.from({ length: totalPages }, (_, idx) => idx + 1);

  if (targetPages.length === 0) {
    throw new Error('No valid pages selected to split into individual PDFs.');
  }

  const results: { pageNumber: number; bytes: Uint8Array }[] = [];
  for (const pageNumber of targetPages) {
    const singleDoc = await PDFDocument.create();
    const [copiedPage] = await singleDoc.copyPages(srcDoc, [pageNumber - 1]);
    singleDoc.addPage(copiedPage);
    results.push({
      pageNumber,
      bytes: await singleDoc.save(),
    });
  }

  return results;
}

/**
 * Merge multiple PDF ArrayBuffers into a single unified PDF.
 */
export async function mergePdfs(pdfBuffers: ArrayBuffer[]): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const mergedDoc = await PDFDocument.create();

  for (const buf of pdfBuffers) {
    const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
    const copiedPages = await mergedDoc.copyPages(doc, doc.getPageIndices());
    for (const page of copiedPages) {
      mergedDoc.addPage(page);
    }
  }

  return await mergedDoc.save();
}

/**
 * Reorder/rotate pages in a PDF document.
 */
export async function reorderAndRotatePdf(
  pdfBytes: ArrayBuffer,
  pageOrder: { pageIndex: number; rotationDegrees?: number }[]
): Promise<Uint8Array> {
  const { PDFDocument, degrees } = await import('pdf-lib');
  const srcDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const totalPages = srcDoc.getPageCount();
  const validSpecs = pageOrder.filter((p) => p.pageIndex >= 0 && p.pageIndex < totalPages);

  if (validSpecs.length === 0) {
    throw new Error('Select at least one valid page to export.');
  }

  const newDoc = await PDFDocument.create();
  const indices = validSpecs.map((p) => p.pageIndex);
  const copiedPages = await newDoc.copyPages(srcDoc, indices);

  for (let i = 0; i < copiedPages.length; i++) {
    const page = copiedPages[i];
    const rot = validSpecs[i].rotationDegrees || 0;
    if (rot) {
      page.setRotation(degrees((page.getRotation().angle + rot) % 360));
    }
    newDoc.addPage(page);
  }

  return await newDoc.save();
}

/**
 * Generate a 4-page sample PDF purely in client memory for zero-upload interactive testing.
 */
export async function generateSamplePdf(): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);

  const sections = [
    {
      heading: 'Page 1 — Executive Summary',
      subtitle: 'Sovereign Fleet Reference Packet (ISO 32000-1 Client Test Document)',
      body: 'Use Split & Extract to pull specific page ranges (for example: 1, 3-4) or export every page individually.',
    },
    {
      heading: 'Page 2 — Financial Ledger',
      subtitle: 'Quarterly Operational Cost Audit: EUR 0.00 Cloud Relay Overhead',
      body: 'Every PDF transformation executes directly inside local browser RAM with zero network uploads.',
    },
    {
      heading: 'Page 3 — Technical Annex',
      subtitle: 'Client-Side Page Tree Normalization & Rotation Test Sheet',
      body: 'Switch to Reorder & Rotate Pages to move this page forward or rotate orientation by 90 degrees.',
    },
    {
      heading: 'Page 4 — Signature & Audit Page',
      subtitle: 'OTHRYS Sovereign Utility Verification Stamp',
      body: 'Zero tracking cookies, strict CSP connect-src self, and volatile ArrayBuffer disposal upon reset.',
    },
  ];

  sections.forEach((sec, idx) => {
    const page = doc.addPage([595.28, 841.89]);
    page.drawRectangle({
      x: 42,
      y: 740,
      width: 511,
      height: 56,
      color: rgb(0.055, 0.086, 0.149),
    });
    page.drawText('OTHRYS PDFSPLIT SAMPLE DOCUMENT', {
      x: 58,
      y: 774,
      size: 10,
      font: bold,
      color: rgb(0.851, 0.682, 0.384),
    });
    page.drawText(`Page ${idx + 1} of 4`, {
      x: 485,
      y: 774,
      size: 10,
      font: bold,
      color: rgb(0.97, 0.98, 0.99),
    });
    page.drawText(sec.heading, {
      x: 42,
      y: 690,
      size: 20,
      font: bold,
      color: rgb(0.06, 0.09, 0.16),
    });
    page.drawText(sec.subtitle, {
      x: 42,
      y: 660,
      size: 12,
      font: bold,
      color: rgb(0.28, 0.34, 0.41),
    });
    page.drawText(sec.body, {
      x: 42,
      y: 622,
      size: 11,
      font: regular,
      color: rgb(0.2, 0.25, 0.33),
      maxWidth: 500,
    });
  });

  return await doc.save();
}
