import { describe, expect, it } from 'vitest';
import { isPublicPath, resolveRequestPath } from './request-path';
import type { MountedRequest } from './request-path';

function requestWith(parts: { url?: string; originalUrl?: string }): MountedRequest {
  return parts as unknown as MountedRequest;
}

describe('resolveRequestPath', () => {
  /*
   * این دقیقاً همان چیزی است که یک بار شکست: `middie` پیشوند نصب را از
   * `req.url` حذف می‌کند و `/` می‌گذارد، پس تکیه بر `url` باعث می‌شد
   * مسیرهای عمومی هم هدر مستأجر بخواهند.
   */
  it('وقتی middie مسیر را برداشته، از originalUrl می‌خواند', () => {
    expect(
      resolveRequestPath(requestWith({ url: '/', originalUrl: '/internal/dev/tenants' })),
    ).toBe('/internal/dev/tenants');
  });

  it('query string را حذف می‌کند', () => {
    expect(resolveRequestPath(requestWith({ originalUrl: '/parties?limit=10' }))).toBe('/parties');
  });

  it('در نبود originalUrl به url برمی‌گردد', () => {
    expect(resolveRequestPath(requestWith({ url: '/health' }))).toBe('/health');
  });

  it('در نبود هر دو، مسیر ریشه می‌دهد — که عمومی نیست، یعنی خرابی بسته است', () => {
    const path = resolveRequestPath(requestWith({}));

    expect(path).toBe('/');
    expect(isPublicPath(path)).toBe(false);
  });
});

describe('isPublicPath', () => {
  it.each(['/health', '/internal/dev/tenants', '/internal/dev/tenants/abc'])(
    '%s عمومی است',
    (path) => {
      expect(isPublicPath(path)).toBe(true);
    },
  );

  it.each([
    '/internal/dev/context',
    '/parties',
    '/',
    '/healthz',
    '/internal/dev/tenants-secret',
    '/sales/invoices',
  ])('%s مستأجر لازم دارد', (path) => {
    expect(isPublicPath(path)).toBe(false);
  });
});
