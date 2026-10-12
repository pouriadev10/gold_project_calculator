import { afterEach, describe, expect, it, vi } from 'vitest';
import { afterNextPaint } from './after-next-paint';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('afterNextPaint', () => {
  it('کار را پس از فریم بعدی و یک task جدا اجرا می‌کند، نه همگام', () => {
    vi.useFakeTimers();
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const callback = vi.fn();

    afterNextPaint(callback);
    expect(callback).not.toHaveBeenCalled();

    frames.forEach((frame) => frame(0));
    expect(callback).not.toHaveBeenCalled(); // هنوز پیش از رنگ

    vi.runAllTimers();
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('لغو پیش از فریم یا پیش از task، کار را اجرا نمی‌کند', () => {
    vi.useFakeTimers();
    const frames = new Map<number, FrameRequestCallback>();
    let nextId = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      nextId += 1;
      frames.set(nextId, cb);
      return nextId;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));

    const first = vi.fn();
    afterNextPaint(first)();
    expect(frames.size).toBe(0);

    const second = vi.fn();
    const cancelSecond = afterNextPaint(second);
    frames.forEach((frame) => frame(0));
    cancelSecond();
    vi.runAllTimers();
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });

  it('بدون requestAnimationFrame به setTimeout برمی‌گردد', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', undefined);
    const callback = vi.fn();
    afterNextPaint(callback);
    vi.runAllTimers();
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
