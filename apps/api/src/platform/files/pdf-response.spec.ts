import { StreamableFile } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { PDF_FILE_NAME_HEADER, pdfResponse } from './pdf-response';

describe('pdfResponse — FE-098', () => {
  const exported = {
    fileName: 'صورت‌حساب-۱۲.pdf',
    contentType: 'application/pdf' as const,
    content: Buffer.from('%PDF-1.4\n%%EOF\n', 'latin1'),
  };

  it('نام فایل را در X-File-Name (کدگذاری‌شده) می‌گذارد و Content-Disposition نمی‌سازد', () => {
    const headers = new Map<string, string>();
    const file = pdfResponse({ header: (name, value) => headers.set(name, value) }, exported);

    expect(headers.get(PDF_FILE_NAME_HEADER)).toBe(encodeURIComponent(exported.fileName));
    expect(decodeURIComponent(headers.get(PDF_FILE_NAME_HEADER)!)).toBe(exported.fileName);
    expect(file).toBeInstanceOf(StreamableFile);
    const options = file.getHeaders();
    expect(options.type).toBe('application/pdf');
    // فیلترهای امنیتی وب هر پاسخ دارای Content-Disposition را برای fetch خالی می‌کنند
    expect(options.disposition).toBeUndefined();
  });
});
