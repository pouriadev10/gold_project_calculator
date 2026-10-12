import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SKIP_WAITING_MESSAGE,
  applyUpdate,
  registerServiceWorker,
  watchForUpdates,
} from './pwa-update';

/** شیء ساده‌ای با addEventListener برای جعل registration و worker. */
function eventTarget<T extends object>(props: T) {
  const listeners = new Map<string, Array<() => void>>();
  return Object.assign(props, {
    addEventListener: (type: string, listener: () => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    emit: (type: string) => listeners.get(type)?.forEach((listener) => listener()),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('registerServiceWorker', () => {
  it('sw.js را زیر base ثبت می‌کند و شکست ثبت را بی‌صدا می‌بلعد', async () => {
    const register = vi.fn().mockRejectedValue(new Error('insecure context'));
    vi.stubGlobal('navigator', { serviceWorker: { register } });
    registerServiceWorker('/', vi.fn());
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
    await Promise.resolve();
  });

  it('مرورگر بی‌سرویس‌ورکر خطا نمی‌دهد', () => {
    vi.stubGlobal('navigator', {});
    expect(() => registerServiceWorker('/', vi.fn())).not.toThrow();
  });
});

describe('watchForUpdates', () => {
  it('نصب اول (بدون کنترل‌کننده) به‌روزرسانی نیست', () => {
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { serviceWorker: { controller: null } });
    const onUpdateReady = vi.fn();
    const waiting = {} as ServiceWorker;
    watchForUpdates(
      eventTarget({
        waiting,
        installing: null,
        update: vi.fn(),
      }) as unknown as ServiceWorkerRegistration,
      onUpdateReady,
    );
    expect(onUpdateReady).not.toHaveBeenCalled();
  });

  it('نسخه‌ی منتظرِ از پیش نصب‌شده را فوراً گزارش می‌کند', () => {
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { serviceWorker: { controller: {} } });
    const onUpdateReady = vi.fn();
    const waiting = {} as ServiceWorker;
    watchForUpdates(
      eventTarget({
        waiting,
        installing: null,
        update: vi.fn(),
      }) as unknown as ServiceWorkerRegistration,
      onUpdateReady,
    );
    expect(onUpdateReady).toHaveBeenCalledWith(waiting);
  });

  it('نسخه‌ای که بعداً پیدا و نصب شود را گزارش می‌کند، و هر ساعت دوباره بررسی می‌کند', () => {
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { serviceWorker: { controller: {} } });
    const onUpdateReady = vi.fn();
    const update = vi.fn().mockResolvedValue(undefined);
    const installing = eventTarget({ state: 'installing' as ServiceWorkerState });
    const registration = eventTarget({ waiting: null as ServiceWorker | null, installing, update });
    watchForUpdates(registration as unknown as ServiceWorkerRegistration, onUpdateReady);
    expect(onUpdateReady).not.toHaveBeenCalled();

    registration.emit('updatefound');
    installing.state = 'installed';
    registration.waiting = installing as unknown as ServiceWorker;
    installing.emit('statechange');
    expect(onUpdateReady).toHaveBeenCalledWith(installing);

    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(update).toHaveBeenCalledTimes(1);
  });
});

describe('applyUpdate', () => {
  it('SKIP_WAITING می‌فرستد و فقط یک بار، پس از گرفتن کنترل، بارگذاری می‌کند', () => {
    const serviceWorker = eventTarget({});
    const reload = vi.fn();
    vi.stubGlobal('navigator', { serviceWorker });
    vi.stubGlobal('location', { reload });
    const postMessage = vi.fn();

    applyUpdate({ postMessage } as unknown as ServiceWorker);
    expect(postMessage).toHaveBeenCalledWith(SKIP_WAITING_MESSAGE);
    expect(reload).not.toHaveBeenCalled();

    serviceWorker.emit('controllerchange');
    serviceWorker.emit('controllerchange');
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
