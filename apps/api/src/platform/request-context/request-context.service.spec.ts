import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { MissingRequestContextError } from './request-context.errors';
import { RequestContextService } from './request-context.service';
import type { RequestContextStore } from './request-context.service';

function storeFor(tenantId: string): RequestContextStore {
  return { requestId: `request-${tenantId}`, tenantId, tenantSlug: `slug-${tenantId}`, userId: undefined };
}

describe('RequestContextService — خارج از درخواست', () => {
  it.each([
    ['getTenantId', (c: RequestContextService) => c.getTenantId()],
    ['getTenantSlug', (c: RequestContextService) => c.getTenantSlug()],
    ['getRequestId', (c: RequestContextService) => c.getRequestId()],
    ['getUserId', (c: RequestContextService) => c.getUserId()],
  ])('%s خطا می‌دهد به‌جای برگرداندن undefined', (_name, read) => {
    expect(() => read(new RequestContextService())).toThrow(MissingRequestContextError);
  });

  it('hasContext مقدار false می‌دهد', () => {
    expect(new RequestContextService().hasContext()).toBe(false);
  });
});

describe('RequestContextService — داخل درخواست', () => {
  it('مقدارهای store را برمی‌گرداند', () => {
    const context = new RequestContextService();

    context.run({ requestId: 'request-a', tenantId: 'a', tenantSlug: 'shop-a', userId: 'u1' }, () => {
      expect(context.getTenantId()).toBe('a');
      expect(context.getTenantSlug()).toBe('shop-a');
      expect(context.getRequestId()).toBe('request-a');
      expect(context.getUserId()).toBe('u1');
      expect(context.hasContext()).toBe(true);
    });
  });

  it('پس از پایان run، context بسته می‌شود و نشت نمی‌کند', () => {
    const context = new RequestContextService();

    context.run(storeFor('a'), () => context.getTenantId());

    expect(context.hasContext()).toBe(false);
  });

  it('از مرز await رد می‌شود', async () => {
    const context = new RequestContextService();

    await context.run(storeFor('a'), async () => {
      await delay(5);
      expect(context.getTenantId()).toBe('a');
    });
  });
});

describe('RequestContextService — جداسازی هم‌زمانی', () => {
  it('دو زنجیره‌ی async درهم‌بافته context یکدیگر را نمی‌بینند', async () => {
    const context = new RequestContextService();

    /** عمداً با تأخیر معکوس، تا ترتیب پایان با ترتیب شروع فرق کند. */
    const observe = (tenantId: string, ms: number): Promise<string> =>
      context.run(storeFor(tenantId), async () => {
        await delay(ms);
        return context.getTenantId();
      });

    const [first, second, third] = await Promise.all([
      observe('tenant-1', 20),
      observe('tenant-2', 5),
      observe('tenant-3', 12),
    ]);

    expect(first).toBe('tenant-1');
    expect(second).toBe('tenant-2');
    expect(third).toBe('tenant-3');
  });

  it('پنجاه زنجیره‌ی هم‌زمان هیچ‌کدام مقدار هم را نمی‌گیرند', async () => {
    const context = new RequestContextService();

    const results = await Promise.all(
      Array.from({ length: 50 }, (_unused, index) =>
        context.run(storeFor(`tenant-${index}`), async () => {
          // تأخیر عمداً غیریکنواخت است تا ترتیب پایان با ترتیب شروع یکی
          // نباشد؛ ثابت نگه داشتنش تست را قابل تکرار می‌کند.
          await delay((index * 7) % 11);
          return context.getTenantId();
        }),
      ),
    );

    expect(results).toEqual(Array.from({ length: 50 }, (_unused, index) => `tenant-${index}`));
  });
});
