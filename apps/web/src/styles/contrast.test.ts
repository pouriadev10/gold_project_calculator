import { describe, expect, it } from 'vitest';
import globalsCss from './globals.css?raw';

/**
 * کنتراست توکن‌های رنگ — FE-084.
 *
 * jsdom رنگ محاسبه‌شده ندارد و axe نمی‌تواند کنتراست را بسنجد؛ پس همین‌جا
 * مستقیماً از توکن‌های `globals.css` (روشن `:root` و تیره `.dark`) حساب
 * می‌شود. هر تغییر پالت که جفت متن/زمینه‌ای را زیر حد ببرد، این تست را
 * می‌شکند. فرمول: WCAG 2.x relative luminance.
 *
 * (شناور اینجا مجاز است: نسبت کنتراست عدد مالی نیست.)
 */

type Hsl = readonly [number, number, number];

function tokens(selector: ':root' | '.dark'): Map<string, Hsl> {
  const start = globalsCss.indexOf(`${selector} {`);
  const end = globalsCss.indexOf('}', start);
  const block = globalsCss.slice(start, end);
  const map = new Map<string, Hsl>();
  for (const match of block.matchAll(/--([a-z-]+):\s*(\d+)\s+(\d+)%\s+(\d+)%;/gu)) {
    map.set(match[1]!, [Number.parseInt(match[2]!, 10), Number.parseInt(match[3]!, 10), Number.parseInt(match[4]!, 10)]);
  }
  return map;
}

function luminance([h, s, l]: Hsl): number {
  const sat = s / 100;
  const light = l / 100;
  const a = sat * Math.min(light, 1 - light);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const value = light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(8) + 0.0722 * channel(4);
}

function ratio(a: Hsl, b: Hsl): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** [رنگ متن, زمینه] — جفت‌هایی که واقعاً در کامپوننت‌ها کنار هم می‌آیند. */
const TEXT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['foreground', 'background'],
  ['card-foreground', 'card'],
  ['popover-foreground', 'popover'],
  ['muted-foreground', 'background'],
  ['muted-foreground', 'card'],
  ['muted-foreground', 'muted'],
  ['primary-foreground', 'primary'],
  ['primary', 'background'],
  ['primary', 'card'],
  ['secondary-foreground', 'secondary'],
  ['accent-foreground', 'accent'],
  ['destructive', 'background'],
  ['destructive', 'card'],
  ['destructive-foreground', 'destructive'],
  ['credit', 'background'],
  ['credit', 'card'],
  ['debit', 'background'],
  ['debit', 'card'],
  ['warning', 'background'],
  ['warning', 'card'],
  ['warning-foreground', 'warning'],
];

describe.each([':root', '.dark'] as const)('contrast — %s', (selector) => {
  const palette = tokens(selector);

  it.each(TEXT_PAIRS)('%s on %s ≥ 4.5:1', (text, background) => {
    const fg = palette.get(text);
    const bg = palette.get(background);
    expect(fg, `--${text}`).toBeDefined();
    expect(bg, `--${background}`).toBeDefined();
    expect(ratio(fg!, bg!)).toBeGreaterThanOrEqual(4.5);
  });

  it('form field border ≥ 3:1 against the page and cards (WCAG 1.4.11)', () => {
    expect(ratio(palette.get('input')!, palette.get('background')!)).toBeGreaterThanOrEqual(3);
    expect(ratio(palette.get('input')!, palette.get('card')!)).toBeGreaterThanOrEqual(3);
  });

  it('focus ring ≥ 3:1 against the page and cards (WCAG 1.4.11)', () => {
    expect(ratio(palette.get('ring')!, palette.get('background')!)).toBeGreaterThanOrEqual(3);
    expect(ratio(palette.get('ring')!, palette.get('card')!)).toBeGreaterThanOrEqual(3);
  });
});
