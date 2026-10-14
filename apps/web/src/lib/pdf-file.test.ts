import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  InvalidPdfError,
  assertPdf,
  fileNameFromContentDisposition,
  safePdfFileName,
  saveBlob,
} from './pdf-file';

/** FE-077 — ابزار فایل PDF. */

describe('fileNameFromContentDisposition', () => {
  it('reads quoted, bare and RFC 5987 names, preferring filename*', () => {
    expect(fileNameFromContentDisposition('attachment; filename="invoice-S-1405-00001.pdf"')).toBe(
      'invoice-S-1405-00001.pdf',
    );
    expect(fileNameFromContentDisposition('attachment; filename=invoice-12.pdf')).toBe('invoice-12.pdf');
    expect(fileNameFromContentDisposition('inline; filename="invoice-S-1405-00001.pdf"')).toBe('invoice-S-1405-00001.pdf');
    expect(
      fileNameFromContentDisposition(
        `attachment; filename="fallback.pdf"; filename*=UTF-8''${encodeURIComponent('فاکتور-۱۲.pdf')}`,
      ),
    ).toBe('فاکتور-۱۲.pdf');
  });

  it('falls back from a broken filename* and handles missing headers', () => {
    expect(fileNameFromContentDisposition(`attachment; filename*=UTF-8''%E0%A4%A; filename="ok.pdf"`)).toBe('ok.pdf');
    expect(fileNameFromContentDisposition('attachment')).toBeNull();
    expect(fileNameFromContentDisposition(null)).toBeNull();
    expect(fileNameFromContentDisposition('')).toBeNull();
  });
});

describe('safePdfFileName', () => {
  it('keeps only a clean base name with a .pdf extension', () => {
    expect(safePdfFileName('invoice-12.pdf', 'x')).toBe('invoice-12.pdf');
    expect(safePdfFileName('invoice-12', 'x')).toBe('invoice-12.pdf');
    expect(safePdfFileName('INVOICE.PDF', 'x')).toBe('INVOICE.pdf');
    expect(safePdfFileName('../../etc/passwd', 'x')).toBe('passwd.pdf');
    expect(safePdfFileName('C:\\temp\\a:b*c?.pdf', 'x')).toBe('a-b-c.pdf');
    expect(safePdfFileName('فاکتور ۱۲.pdf', 'x')).toBe('فاکتور ۱۲.pdf');
  });

  it('uses the (cleaned) fallback when nothing usable remains', () => {
    expect(safePdfFileName(null, 'invoice-122')).toBe('invoice-122.pdf');
    expect(safePdfFileName('...', 'invoice/122')).toBe('122.pdf');
    expect(safePdfFileName('', '')).toBe('document.pdf');
  });
});

describe('assertPdf', () => {
  it('accepts the %PDF- signature regardless of declared type', async () => {
    await expect(assertPdf(new Blob(['%PDF-1.7 body']))).resolves.toBeUndefined();
  });

  it('rejects HTML, JSON or too-short bodies even when typed as PDF', async () => {
    await expect(assertPdf(new Blob(['<html>'], { type: 'application/pdf' }))).rejects.toBeInstanceOf(InvalidPdfError);
    await expect(assertPdf(new Blob(['{"error":1}']))).rejects.toBeInstanceOf(InvalidPdfError);
    await expect(assertPdf(new Blob(['%PD']))).rejects.toBeInstanceOf(InvalidPdfError);
  });
});

describe('saveBlob', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('clicks a temporary link and revokes the URL only after a delay', () => {
    vi.useFakeTimers();
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    saveBlob(new Blob(['%PDF-']), 'invoice-1.pdf');

    expect(click).toHaveBeenCalledOnce();
    const clicked = click.mock.contexts[0] as HTMLAnchorElement;
    expect(clicked.download).toBe('invoice-1.pdf');
    expect(document.body.contains(clicked)).toBe(false);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(revoke).toHaveBeenCalledWith('blob:x');
  });
});
