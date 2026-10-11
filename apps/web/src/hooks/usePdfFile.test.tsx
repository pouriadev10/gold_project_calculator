import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DownloadedFile } from '@/api/client';
import { usePdfFile } from './usePdfFile';

/** FE-077 — چرخه‌ی دریافت/پیش‌نمایش PDF. */

const PDF: DownloadedFile = { content: new Blob(['%PDF-1.4']), fileName: 'invoice-7.pdf' };
let urlCounter = 0;

beforeEach(() => {
  urlCounter = 0;
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => `blob:${++urlCounter}`),
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
  // unmount پیش از برداشتن stub تا آزادسازی URL به همان stub برسد.
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('usePdfFile', () => {
  it('reports loading, then previews; a second preview frees the first URL', async () => {
    const fetchFile = vi.fn(async () => PDF);
    const { result } = renderHook(() => usePdfFile({ fetchFile, fallbackFileName: 'invoice-7' }));

    let pending: Promise<void> | undefined;
    act(() => {
      pending = result.current.openPreview();
    });
    expect(result.current.pending).toBe('preview');
    await act(async () => pending);

    expect(result.current.pending).toBeNull();
    expect(result.current.preview).toEqual({ url: 'blob:1', fileName: 'invoice-7.pdf' });

    await act(async () => result.current.openPreview());
    expect(result.current.preview?.url).toBe('blob:2');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:1');
  });

  it('ignores a second click while a request is in flight', async () => {
    let resolve: (file: DownloadedFile) => void = () => {};
    const fetchFile = vi.fn(() => new Promise<DownloadedFile>((done) => (resolve = done)));
    const { result } = renderHook(() => usePdfFile({ fetchFile, fallbackFileName: 'x' }));

    act(() => {
      void result.current.download();
      void result.current.download();
    });
    expect(fetchFile).toHaveBeenCalledTimes(1);
    await act(async () => resolve(PDF));
    await waitFor(() => expect(result.current.pending).toBeNull());
  });

  it('keeps the error and clears it on the next attempt', async () => {
    const fetchFile = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(PDF);
    const { result } = renderHook(() => usePdfFile({ fetchFile, fallbackFileName: 'x' }));

    await act(async () => result.current.download());
    expect(result.current.error).toBeInstanceOf(Error);

    await act(async () => result.current.download());
    expect(result.current.error).toBeNull();
  });

  it('drops the preview when the reset key (invoice version) changes, and on unmount', async () => {
    const fetchFile = vi.fn(async () => PDF);
    const { result, rerender, unmount } = renderHook(
      ({ version }: { version: number }) => usePdfFile({ fetchFile, fallbackFileName: 'x', resetKey: version }),
      { initialProps: { version: 1 } },
    );
    await act(async () => result.current.openPreview());
    expect(result.current.preview?.url).toBe('blob:1');

    rerender({ version: 2 });
    expect(result.current.preview).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:1');

    await act(async () => result.current.openPreview());
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:2');
  });

  it('aborts the request on unmount and never creates a URL afterwards', async () => {
    let signal: AbortSignal | undefined;
    let resolve: (file: DownloadedFile) => void = () => {};
    const fetchFile = vi.fn((s: AbortSignal) => {
      signal = s;
      return new Promise<DownloadedFile>((done) => (resolve = done));
    });
    const { result, unmount } = renderHook(() => usePdfFile({ fetchFile, fallbackFileName: 'x' }));

    act(() => {
      void result.current.openPreview();
    });
    unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => resolve(PDF));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('saves the previewed file without fetching again', async () => {
    const fetchFile = vi.fn(async () => PDF);
    const { result } = renderHook(() => usePdfFile({ fetchFile, fallbackFileName: 'x' }));
    await act(async () => result.current.openPreview());

    act(() => result.current.savePreview());
    expect(fetchFile).toHaveBeenCalledTimes(1);
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
  });
});
