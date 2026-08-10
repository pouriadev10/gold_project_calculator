import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useIdempotencyKey, useIdempotentSubmit } from './useIdempotentSubmit';

describe('useIdempotencyKey', () => {
  it('روی mount یک‌بار ساخته می‌شود و با rerender عوض نمی‌شود', () => {
    const { result, rerender } = renderHook(() => useIdempotencyKey());
    const first = result.current.key;

    rerender();
    rerender();

    expect(result.current.key).toBe(first);
  });

  it('reset() کلید تازه می‌سازد', () => {
    const { result } = renderHook(() => useIdempotencyKey());
    const first = result.current.key;

    act(() => result.current.reset());

    expect(result.current.key).not.toBe(first);
  });
});

describe('useIdempotentSubmit', () => {
  it('کلید پایدار را به action پاس می‌دهد', async () => {
    const action = vi.fn(async (_key: string, payload: number) => payload * 2);
    const { result } = renderHook(() => useIdempotentSubmit(action));

    await act(async () => {
      await result.current.submit(5);
    });

    expect(action).toHaveBeenCalledWith(result.current.key, 5);
  });

  it('ضربه‌ی دوم هم‌زمان فقط یک بار action را صدا می‌زند — نه دو سند', async () => {
    let resolveAction: (value: string) => void = () => {};
    const action = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveAction = resolve;
        }),
    );
    const { result } = renderHook(() => useIdempotentSubmit(action));

    let first: Promise<string | undefined> | undefined;
    let second: Promise<string | undefined> | undefined;
    act(() => {
      first = result.current.submit('a');
      second = result.current.submit('a'); // ضربه‌ی دوم پیش از پایان اولی
    });

    // ضربه‌ی دوم اصلاً به action نرسیده — قفل سنکرون است، نه وابسته به رندر
    expect(action).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveAction('done');
      await Promise.all([first, second]);
    });

    await expect(second).resolves.toBeUndefined();
    await expect(first).resolves.toBe('done');
  });

  it('تلاش مجدد پس از شکست همان کلید را می‌فرستد، نه کلید تازه', async () => {
    const action = vi
      .fn<(key: string, payload: string) => Promise<string>>()
      .mockRejectedValueOnce(new Error('شبکه قطع شد'))
      .mockResolvedValueOnce('ok');
    const { result } = renderHook(() => useIdempotentSubmit(action));
    const keyBeforeRetry = result.current.key;

    await act(async () => {
      await result.current.submit('x').catch(() => {});
    });

    await act(async () => {
      await result.current.submit('x');
    });

    expect(action).toHaveBeenCalledTimes(2);
    expect(action.mock.calls[0]?.[0]).toBe(keyBeforeRetry);
    expect(action.mock.calls[1]?.[0]).toBe(keyBeforeRetry);
  });

  it('پس از reset صریح، تلاش بعدی کلید تازه می‌فرستد', async () => {
    const action = vi.fn(async (key: string) => key);
    const { result } = renderHook(() => useIdempotentSubmit(action));
    const keyBefore = result.current.key;

    await act(async () => {
      await result.current.submit('x');
    });

    act(() => result.current.reset());

    await act(async () => {
      await result.current.submit('x');
    });

    expect(action.mock.calls[0]?.[0]).toBe(keyBefore);
    expect(action.mock.calls[1]?.[0]).not.toBe(keyBefore);
  });

  it('isSubmitting در طول عملیات true و بعد از پایان false است', async () => {
    let resolveAction: (value: string) => void = () => {};
    const action = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveAction = resolve;
        }),
    );
    const { result } = renderHook(() => useIdempotentSubmit(action));

    expect(result.current.isSubmitting).toBe(false);

    let submitPromise: Promise<string | undefined> | undefined;
    act(() => {
      submitPromise = result.current.submit('x');
    });

    expect(result.current.isSubmitting).toBe(true);

    await act(async () => {
      resolveAction('done');
      await submitPromise;
    });

    expect(result.current.isSubmitting).toBe(false);
  });
});
