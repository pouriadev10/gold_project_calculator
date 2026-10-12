import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { afterContentPaint, registerServiceWorker, whenStartupQueriesSettle } from './startup';

/** FE-088 — زمان‌بندی کارهای پس از بالا آمدن. */

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** یک فریم (rAF) + macrotask بعدش را جلو می‌برد. */
async function nextFrame(): Promise<void> {
  await vi.advanceTimersByTimeAsync(20);
  await vi.advanceTimersByTimeAsync(1);
}

describe('whenStartupQueriesSettle', () => {
  it('تا وقتی query صفحه‌ی اول در حال دریافت است صبر می‌کند', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame'] });
    const client = new QueryClient();
    let respond: (value: string) => void = () => undefined;
    void client.prefetchQuery({
      queryKey: ['mazneh'],
      queryFn: () =>
        new Promise<string>((resolve) => {
          respond = resolve;
        }),
    });

    let settled = false;
    void whenStartupQueriesSettle(client, 10_000).then(() => {
      settled = true;
    });
    await nextFrame();
    expect(settled).toBe(false);

    respond('ok');
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
  });

  it('صفحه‌ی بی‌query (ورود) پس از یک فریم تمام می‌شود', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame'] });
    let settled = false;
    void whenStartupQueriesSettle(new QueryClient(), 10_000).then(() => {
      settled = true;
    });
    await nextFrame();
    expect(settled).toBe(true);
  });

  it('درخواست گیرکرده کارهای جانبی را تا ابد عقب نمی‌اندازد', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame'] });
    const client = new QueryClient();
    void client.prefetchQuery({ queryKey: ['stuck'], queryFn: () => new Promise<string>(() => undefined) });

    let settled = false;
    void whenStartupQueriesSettle(client, 4000).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(3999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
  });
});

describe('afterContentPaint', () => {
  it('بی‌پشتیبانی LCP (Safari) به یک فریم بسنده می‌کند', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame'] });
    vi.stubGlobal('PerformanceObserver', undefined);
    let done = false;
    void afterContentPaint(0).then(() => {
      done = true;
    });
    await nextFrame();
    expect(done).toBe(true);
  });

  it('با گزارش رنگ‌آمیزیِ تازه تمام می‌شود، نه با گزارش‌های پیش از since', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let report: ((entries: Array<{ startTime: number }>) => void) | undefined;
    class FakeObserver {
      static supportedEntryTypes = ['largest-contentful-paint'];
      constructor(callback: (list: { getEntries: () => Array<{ startTime: number }> }) => void) {
        report = (entries) => callback({ getEntries: () => entries });
      }
      observe(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal('PerformanceObserver', FakeObserver);

    let done = false;
    void afterContentPaint(100, 600).then(() => {
      done = true;
    });
    report?.([{ startTime: 40 }]); // پوسته‌ی inline، پیش از داده
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(false);

    report?.([{ startTime: 180 }]); // داده‌ی صفحه کشیده شد
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });

  it('اگر داده عنصر بزرگ‌تری نساخت، پس از سقف زمانی ادامه می‌دهد', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    class SilentObserver {
      static supportedEntryTypes = ['largest-contentful-paint'];
      observe(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal('PerformanceObserver', SilentObserver);
    let done = false;
    void afterContentPaint(100, 600).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(599);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });
});

describe('registerServiceWorker', () => {
  it('sw.js را زیر base ثبت می‌کند و شکست ثبت را بی‌صدا می‌بلعد', async () => {
    const register = vi.fn().mockRejectedValue(new Error('insecure context'));
    vi.stubGlobal('navigator', { serviceWorker: { register } });
    registerServiceWorker('/');
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
    await Promise.resolve();
  });

  it('مرورگر بی‌سرویس‌ورکر خطا نمی‌دهد', () => {
    vi.stubGlobal('navigator', {});
    expect(() => registerServiceWorker('/')).not.toThrow();
  });
});
