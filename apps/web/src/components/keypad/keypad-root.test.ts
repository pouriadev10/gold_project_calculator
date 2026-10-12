import { afterEach, describe, expect, it } from 'vitest';
import { releaseKeypadSpace, reserveKeypadSpace } from './keypad-root';

/** FE-085 — جای اضافه‌ی ته ظرف اسکرول تا کیپد باز است. */

afterEach(() => {
  document.body.innerHTML = '';
});

describe('reserveKeypadSpace / releaseKeypadSpace', () => {
  it('به ته ظرف به اندازه‌ی کیپد جا اضافه و با بسته شدن کیپد دقیقاً همان مقدار قبلی را برمی‌گرداند', () => {
    const sheet = document.createElement('div');
    sheet.style.paddingBottom = '12px';
    document.body.append(sheet);

    reserveKeypadSpace(sheet, 334);
    // مرورگر (و jsdom) calc را ساده می‌کند: ۱۲ + ۳۳۴ = ۳۴۶.
    expect(sheet.style.paddingBottom).toMatch(/^calc\((12px \+ 334px|346px)\)$/u);

    releaseKeypadSpace();
    expect(sheet.style.paddingBottom).toBe('12px');
    expect(sheet.hasAttribute('data-keypad-space')).toBe(false);
  });

  it('دو بار رزرو جا را دو برابر نمی‌کند', () => {
    const sheet = document.createElement('div');
    document.body.append(sheet);

    reserveKeypadSpace(sheet, 300);
    const once = sheet.style.paddingBottom;
    reserveKeypadSpace(sheet, 300);

    expect(sheet.style.paddingBottom).toBe(once);
    releaseKeypadSpace();
    expect(sheet.style.paddingBottom).toBe('');
  });
});
