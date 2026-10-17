import { describe, expect, it } from 'vitest';
import clientSource from '../api/client.ts?raw';
import mainSource from '../main.tsx?raw';
import { resolveApiMode, shouldStartMockWorker } from './api-mode';

describe('api-mode — FE-106a', () => {
  it('production هرگز MSW را بالا نمی‌آورد، هر چه VITE_API_MODE باشد', () => {
    for (const mode of [undefined, '', 'mock', 'MOCK', 'real', 'anything']) {
      expect(shouldStartMockWorker({ DEV: false, VITE_API_MODE: mode })).toBe(false);
    }
  });

  it('توسعه: پیش‌فرض MSW؛ فقط `real` آن را خاموش می‌کند', () => {
    expect(shouldStartMockWorker({ DEV: true })).toBe(true);
    expect(shouldStartMockWorker({ DEV: true, VITE_API_MODE: 'mock' })).toBe(true);
    expect(shouldStartMockWorker({ DEV: true, VITE_API_MODE: 'real' })).toBe(false);
    expect(shouldStartMockWorker({ DEV: true, VITE_API_MODE: ' Real ' })).toBe(false);
  });

  it('مقدار ناشناخته mock است، نه سرور ناموجود', () => {
    expect(resolveApiMode('rael')).toBe('mock');
    expect(resolveApiMode(undefined)).toBe('mock');
    expect(resolveApiMode('real')).toBe('real');
  });

  it('main.tsx تصمیم را فقط از همین تابع می‌گیرد — شاخه‌ی mock دیگری ندارد', () => {
    const main = mainSource;
    expect(main).toContain('shouldStartMockWorker(import.meta.env)');
    expect(main.match(/import\(['"]@\/mocks/gu)).toHaveLength(1);
  });

  it('کلاینت API هیچ fallback ِ ساختگی ندارد', () => {
    expect(clientSource).not.toMatch(/mocks|fixtures|msw/u);
  });
});
