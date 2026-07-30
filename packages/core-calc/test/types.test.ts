import { describe, expect, it } from 'vitest';
import {
  CalcError,
  KARAT_BASE,
  coinCount,
  coinDimension,
  grossMg,
  karat,
  pureMg,
  rial,
} from '../src/types.js';

describe('سازنده‌های نوع', () => {
  it('ریال هر مقدار صحیحی را می‌پذیرد، مثبت یا منفی', () => {
    expect(rial(-5n)).toBe(-5n);
    expect(rial(0n)).toBe(0n);
  });

  it('وزن منفی رد می‌شود', () => {
    expect(() => grossMg(-1n)).toThrow(CalcError);
    expect(() => pureMg(-1n)).toThrow('وزن خالص نمی‌تواند منفی باشد');
    expect(grossMg(0n)).toBe(0n);
    expect(pureMg(0n)).toBe(0n);
  });

  it('عیار باید صحیح و بین ۱ تا ۱۰۰۰ باشد', () => {
    expect(karat(750)).toBe(750);
    expect(karat(1)).toBe(1);
    expect(karat(KARAT_BASE)).toBe(1000);
    expect(() => karat(0)).toThrow(CalcError);
    expect(() => karat(1001)).toThrow(CalcError);
    expect(() => karat(750.5)).toThrow(CalcError);
  });

  it('تعداد سکه باید صحیح باشد — سکه نصفه وجود ندارد', () => {
    expect(coinCount(5)).toBe(5);
    expect(coinCount(-2)).toBe(-2); // موقعیت فروش استقراضی مجاز است
    expect(() => coinCount(1.5)).toThrow('تعداد سکه باید عدد صحیح باشد');
  });

  it('هر نوع سکه بُعد مستقل خود را می‌سازد', () => {
    expect(coinDimension('nim')).toBe('coin:nim');
  });

  it('CalcError نام درست دارد', () => {
    expect(new CalcError('x').name).toBe('CalcError');
  });
});
