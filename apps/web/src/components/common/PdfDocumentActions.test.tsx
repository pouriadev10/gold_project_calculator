import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DownloadedFile } from '@/api/client';
import { PdfDocumentActions } from './PdfDocumentActions';

/** FE-078 — اقدامات PDF مشترک: دانلود، پیش‌نمایش و اشتراک فایل. */

const PDF: DownloadedFile = { content: new Blob(['%PDF-1.4 doc']), fileName: 'invoice-0a1b2c3d-uuid.pdf' };

function renderActions(props: Partial<Parameters<typeof PdfDocumentActions>[0]> = {}) {
  const fetchFile = vi.fn(async () => PDF);
  render(
    <PdfDocumentActions
      idPrefix="doc"
      fetchFile={fetchFile}
      fallbackFileName="fallback"
      preferredFileName="purchase-receipt-0a1b2c3d"
      shareTitle="رسید خرید"
      previewTitle="پیش‌نمایش رسید"
      description="رسید از سرور ساخته می‌شود."
      {...props}
    />,
  );
  return fetchFile;
}

function stubShare(share: (data: ShareData) => Promise<void>) {
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: vi.fn(() => true) });
  Object.defineProperty(navigator, 'share', { configurable: true, value: vi.fn(share) });
}

let clickSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:doc'), revokeObjectURL: vi.fn() });
  clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'canShare');
  Reflect.deleteProperty(navigator, 'share');
});

describe('PdfDocumentActions — FE-078', () => {
  it('without file sharing support shows only download and preview', () => {
    renderActions();
    expect(screen.getByRole('button', { name: 'دریافت PDF' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'پیش‌نمایش' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'اشتراک' })).not.toBeInTheDocument();
    expect(screen.getByText('رسید از سرور ساخته می‌شود.')).toBeInTheDocument();
  });

  it('saves with the client name, which wins over the uninformative server name', async () => {
    renderActions();
    await userEvent.click(screen.getByRole('button', { name: 'دریافت PDF' }));
    await waitFor(() => expect(clickSpy).toHaveBeenCalledOnce());
    expect((clickSpy.mock.contexts[0] as HTMLAnchorElement).download).toBe('purchase-receipt-0a1b2c3d.pdf');
  });

  it('shares the PDF file itself (never a URL) when the browser supports it', async () => {
    stubShare(async () => {});
    renderActions();

    await userEvent.click(screen.getByRole('button', { name: 'اشتراک' }));

    await waitFor(() => expect(navigator.share).toHaveBeenCalledOnce());
    const data = vi.mocked(navigator.share).mock.calls[0]![0]!;
    expect(data.title).toBe('رسید خرید');
    expect(data.url).toBeUndefined();
    expect(data.files?.[0]?.name).toBe('purchase-receipt-0a1b2c3d.pdf');
    expect(data.files?.[0]?.type).toBe('application/pdf');
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('treats a cancelled share sheet as no error', async () => {
    stubShare(async () => {
      throw new DOMException('cancelled', 'AbortError');
    });
    renderActions();
    await userEvent.click(screen.getByRole('button', { name: 'اشتراک' }));
    await waitFor(() => expect(navigator.share).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: 'اشتراک' })).toBeEnabled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('falls back to saving when the share permission expired during a slow download', async () => {
    stubShare(async () => {
      throw new DOMException('no activation', 'NotAllowedError');
    });
    renderActions();
    await userEvent.click(screen.getByRole('button', { name: 'اشتراک' }));
    await waitFor(() => expect(clickSpy).toHaveBeenCalledOnce());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows an unavailable reason and never fetches', () => {
    const fetchFile = renderActions({ available: false, unavailableReason: 'هنوز نهایی نشده.' });
    expect(screen.getByRole('button', { name: 'دریافت PDF' })).toBeDisabled();
    expect(screen.getByText('هنوز نهایی نشده.')).toBeInTheDocument();
    expect(fetchFile).not.toHaveBeenCalled();
  });
});

describe('PdfDocumentActions — share text (FE-079)', () => {
  it('with receipt text, offers share even without Web Share and falls back to saving', async () => {
    renderActions({ shareText: 'رسید فروش\nفاکتور شماره ۱' });

    await userEvent.click(screen.getByRole('button', { name: 'اشتراک' }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalledOnce());
    expect(await screen.findByText(/اشتراک در این مرورگر پشتیبانی نمی‌شود؛ PDF ذخیره شد/)).toBeInTheDocument();
  });
});
