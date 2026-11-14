import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  parsePageRange,
  resolveEffectivePages,
  splitPdf,
  splitIntoIndividualPdfs,
  mergePdfs,
  reorderAndRotatePdf,
  generateSamplePdf,
} from '../src/pdf-engine.ts';

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe('PDF Engine Page Range Parser & PDF Manipulation', () => {
  it('parses comma-separated single pages', () => {
    expect(parsePageRange('1, 3, 5')).toEqual([1, 3, 5]);
  });

  it('parses hyphenated ranges', () => {
    expect(parsePageRange('1-4, 7-9')).toEqual([1, 2, 3, 4, 7, 8, 9]);
  });

  it('deduplicates and sorts overlapping and unordered inputs', () => {
    expect(parsePageRange('5, 1-3, 2, 4')).toEqual([1, 2, 3, 4, 5]);
  });

  it('bounds to maxPages parameter when provided', () => {
    expect(parsePageRange('1-10', 5)).toEqual([1, 2, 3, 4, 5]);
    expect(parsePageRange('2, 6, 8', 6)).toEqual([2, 6]);
  });

  it('handles irregular whitespace and invalid characters gracefully', () => {
    expect(parsePageRange('  1 - 3 ,  foo, 5; 8 - 10 ')).toEqual([1, 2, 3, 5, 8, 9, 10]);
  });

  it('resolves empty ranges to all pages when pageCount is positive', () => {
    expect(parsePageRange('')).toEqual([]);
    expect(resolveEffectivePages('', 4)).toEqual([1, 2, 3, 4]);
    expect(resolveEffectivePages('2, 4', 4)).toEqual([2, 4]);
  });

  it('generates a valid 4-page sample PDF and splits specific pages', async () => {
    const sampleBytes = await generateSamplePdf();
    const sampleDoc = await PDFDocument.load(sampleBytes);
    expect(sampleDoc.getPageCount()).toBe(4);

    const extracted = await splitPdf(toArrayBuffer(sampleBytes), [2, 4]);
    const extractedDoc = await PDFDocument.load(extracted);
    expect(extractedDoc.getPageCount()).toBe(2);
  });

  it('splits selected pages into individual single-page PDFs', async () => {
    const sampleBytes = await generateSamplePdf();
    const singles = await splitIntoIndividualPdfs(toArrayBuffer(sampleBytes), [1, 3]);
    expect(singles).toHaveLength(2);
    expect(singles.map((s) => s.pageNumber)).toEqual([1, 3]);

    for (const entry of singles) {
      const doc = await PDFDocument.load(entry.bytes);
      expect(doc.getPageCount()).toBe(1);
    }
  });

  it('merges multiple PDFs sequentially', async () => {
    const sampleBytes = await generateSamplePdf();
    const buf = toArrayBuffer(sampleBytes);
    const merged = await mergePdfs([buf, buf]);
    const mergedDoc = await PDFDocument.load(merged);
    expect(mergedDoc.getPageCount()).toBe(8);
  });

  it('reorders and rotates pages cleanly', async () => {
    const sampleBytes = await generateSamplePdf();
    const reordered = await reorderAndRotatePdf(toArrayBuffer(sampleBytes), [
      { pageIndex: 3, rotationDegrees: 90 },
      { pageIndex: 0, rotationDegrees: 180 },
    ]);
    const doc = await PDFDocument.load(reordered);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getRotation().angle).toBe(90);
    expect(doc.getPage(1).getRotation().angle).toBe(180);
  });
});
