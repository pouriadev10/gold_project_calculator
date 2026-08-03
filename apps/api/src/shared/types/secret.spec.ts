import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { Secret } from './secret';

const RAW = 'super-secret-signing-key-value';

describe('Secret', () => {
  it('مقدار واقعی فقط با reveal بیرون می‌آید', () => {
    expect(new Secret(RAW).reveal()).toBe(RAW);
  });

  it('تبدیل به رشته مقدار را نشان نمی‌دهد', () => {
    expect(String(new Secret(RAW))).toBe('[REDACTED]');
    expect(`${new Secret(RAW)}`).toBe('[REDACTED]');
  });

  it('JSON.stringify مقدار را نشان نمی‌دهد', () => {
    const serialized = JSON.stringify({ jwtAccessSecret: new Secret(RAW) });

    expect(serialized).not.toContain(RAW);
    expect(serialized).toBe('{"jwtAccessSecret":"[REDACTED]"}');
  });

  it('util.inspect — همان مسیری که console.log می‌رود — مقدار را نشان نمی‌دهد', () => {
    const output = inspect({ databaseUrl: new Secret(RAW) });

    expect(output).not.toContain(RAW);
    expect(output).toContain('[REDACTED]');
  });

  it('مقدار در کلیدهای شیء یا spread نشت نمی‌کند', () => {
    const secret = new Secret(RAW);

    expect(Object.keys(secret)).toEqual([]);
    expect(JSON.stringify({ ...secret })).not.toContain(RAW);
  });
});
