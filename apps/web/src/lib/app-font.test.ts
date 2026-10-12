import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APP_FONT_CACHED_KEY,
  APP_FONT_FAMILY,
  APP_FONT_URL,
  applyAppFontNow,
  applyAppFontOnNextPage,
  isAppFontLikelyCached,
} from './app-font';

/** FE-088 — بار و اعمال وزیرمتن بدون جابه‌جایی متنِ در حال نمایش. */

class FakeFontFace {
  static instances: FakeFontFace[] = [];
  static failNext = false;
  constructor(
    readonly family: string,
    readonly source: string,
    readonly descriptors: FontFaceDescriptors,
  ) {
    FakeFontFace.instances.push(this);
  }
  load(): Promise<this> {
    if (FakeFontFace.failNext) return Promise.reject(new Error('network'));
    return Promise.resolve(this);
  }
}

const added: unknown[] = [];

beforeEach(() => {
  FakeFontFace.instances = [];
  FakeFontFace.failNext = false;
  added.length = 0;
  localStorage.clear();
  vi.stubGlobal('FontFace', FakeFontFace);
  Object.defineProperty(document, 'fonts', { configurable: true, value: { add: (face: unknown) => added.push(face) } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'fonts');
});

describe('applyAppFontNow (بارهای بعد، از کش)', () => {
  it('فونت را با همان مشخصات قبلی @font-face ثبت و فوراً اعمال می‌کند', async () => {
    await applyAppFontNow();
    const [face] = FakeFontFace.instances;
    expect(face?.family).toBe(APP_FONT_FAMILY);
    expect(face?.source).toBe(`url(${APP_FONT_URL}) format('woff2-variations')`);
    expect(face?.descriptors).toMatchObject({ weight: '100 900', display: 'swap' });
    expect(face?.descriptors.unicodeRange).toContain('U+0600-06FF');
    expect(added).toEqual([face]);
    expect(isAppFontLikelyCached()).toBe(true);
  });

  it('شکست دانلود بی‌صداست و پرچم کش را نمی‌گذارد', async () => {
    FakeFontFace.failNext = true;
    await expect(applyAppFontNow()).resolves.toBeUndefined();
    expect(localStorage.getItem(APP_FONT_CACHED_KEY)).toBeNull();
  });
});

describe('applyAppFontOnNextPage (بار اول)', () => {
  it('دانلود می‌کند ولی تا ناوبری بعدی روی صفحه‌ی فعلی اعمال نمی‌کند', async () => {
    let nextPage: (() => void) | undefined;
    const unsubscribe = vi.fn();
    await applyAppFontOnNextPage((callback) => {
      nextPage = callback;
      return unsubscribe;
    });

    expect(FakeFontFace.instances).toHaveLength(1);
    expect(added).toEqual([]);
    expect(isAppFontLikelyCached()).toBe(true);

    nextPage?.();
    expect(added).toEqual([FakeFontFace.instances[0]]);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('بی‌پشتیبانی FontFace کاری نمی‌کند و خطا نمی‌دهد', async () => {
    vi.stubGlobal('FontFace', undefined);
    const subscribe = vi.fn();
    await expect(applyAppFontOnNextPage(subscribe)).resolves.toBeUndefined();
    expect(subscribe).not.toHaveBeenCalled();
  });
});
