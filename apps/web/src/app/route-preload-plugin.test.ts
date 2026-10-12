import type { Rollup } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import { SESSION_STORAGE_KEY } from '@/stores/session-store';
import { toNonBlockingStylesheets } from '../../vite-plugins/non-blocking-css';
import { chunkClosure, parseLazyRoutes, preloadScript, routePattern } from '../../vite-plugins/route-preload';
import VITE_CONFIG from '../../vite.config.ts?raw';
import ROUTER_SOURCE from './router.tsx?raw';

/** FE-088 — افزونه‌های بیلدِ مسیر بحرانی (preload چانک مسیر، CSS غیرمسدودکننده). */

describe('parseLazyRoutes', () => {
  it('هر import() تنبل router.tsx را با مسیرش پیدا می‌کند — هیچ مسیری جا نمی‌ماند', () => {
    const routes = parseLazyRoutes(ROUTER_SOURCE);
    const lazyImports = ROUTER_SOURCE.match(/\bimport\(\s*'[^']+'\s*\)/gu) ?? [];

    expect(routes).toHaveLength(lazyImports.length);
    expect(routes).toContainEqual({ path: '/login', specifier: '@/features/auth/LoginPage' });
    expect(routes).toContainEqual({ path: '/sales/new', specifier: '@/features/sales/SaleWizardPage' });
    expect(routes).toContainEqual({ path: '/parties/$partyId/statement', specifier: '@/features/parties/PartyStatementPage' });
  });

  it('مسیر بدون import (هدایت، صفحه‌ی ایستا) را نادیده می‌گیرد', () => {
    const source = `
      createRoute({ path: '/', beforeLoad: () => { throw redirect({ to: '/dashboard' }); } });
      createRoute({ path: '/dashboard', component: HomePage });
      createRoute({ path: '/x', component: lazyRouteComponent(() => import('@/features/x/X')) });
    `;
    expect(parseLazyRoutes(source)).toEqual([{ path: '/x', specifier: '@/features/x/X' }]);
  });
});

describe('routePattern', () => {
  it('پارامتر یک بخش کامل مسیر است و اسلش پایانی اختیاری', () => {
    const pattern = new RegExp(routePattern('/parties/$partyId/statement'));
    expect(pattern.test('/parties/a1000000-0000-4000-8000-000000000001/statement')).toBe(true);
    expect(pattern.test('/parties/abc/statement/')).toBe(true);
    expect(pattern.test('/parties/abc/def/statement')).toBe(false);
    expect(pattern.test('/parties/abc')).toBe(false);
  });

  it('لنگر دارد: پیشوند یک مسیر دیگر را نمی‌گیرد', () => {
    const pattern = new RegExp(routePattern('/sales/new'));
    expect(pattern.test('/sales/new')).toBe(true);
    expect(pattern.test('/sales/new/extra')).toBe(false);
    expect(pattern.test('/x/sales/new')).toBe(false);
  });
});

function chunk(fileName: string, imports: string[], extra: Partial<Rollup.OutputChunk> = {}): Rollup.OutputChunk {
  return { type: 'chunk', fileName, imports, isEntry: false, facadeModuleId: null, ...extra } as Rollup.OutputChunk;
}

describe('chunkClosure', () => {
  it('importهای ایستای تو در تو را می‌آورد و بسته‌ی اولیه را کنار می‌گذارد', () => {
    const bundle: Rollup.OutputBundle = {
      'assets/index.js': chunk('assets/index.js', [], { isEntry: true }),
      'assets/Page.js': chunk('assets/Page.js', ['assets/index.js', 'assets/Shared.js']),
      'assets/Shared.js': chunk('assets/Shared.js', ['assets/index.js', 'assets/Icon.js']),
      'assets/Icon.js': chunk('assets/Icon.js', ['assets/Shared.js']),
    };
    const files = chunkClosure(bundle, bundle['assets/Page.js'] as Rollup.OutputChunk, new Set(['assets/index.js']));
    expect(files).toEqual(['assets/Page.js', 'assets/Shared.js', 'assets/Icon.js']);
  });
});

describe('preloadScript', () => {
  const ROUTES = [
    [routePattern('/login'), ['assets/Login.js', 'assets/form.js']],
    [routePattern('/sales/new'), ['assets/Sale.js', 'assets/form.js']],
  ] as const;

  function run(pathname: string, session: unknown): string[] {
    document.head.querySelectorAll('link[rel="modulepreload"]').forEach((link) => link.remove());
    localStorage.clear();
    if (session !== undefined) localStorage.setItem('gold-ui-session', JSON.stringify({ state: { session }, version: 0 }));
    window.history.replaceState(null, '', pathname);
    new Function(preloadScript(ROUTES, '/', 'gold-ui-session'))();
    return Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[rel="modulepreload"]')).map((link) =>
      link.getAttribute('href') ?? '',
    );
  }

  afterEach(() => {
    window.history.replaceState(null, '', '/');
    localStorage.clear();
  });

  it('با نشست، چانک‌های همان مسیر را preload می‌کند (فایل مشترک یک بار در فهرست)', () => {
    expect(run('/sales/new', { accessToken: 't' })).toEqual(['/assets/Sale.js', '/assets/form.js']);
  });

  it('بی‌نشست، مثل محافظ مسیر، چانک ورود را می‌خواهد', () => {
    expect(run('/sales/new', undefined)).toEqual(['/assets/Login.js', '/assets/form.js']);
    expect(run('/dashboard', null)).toEqual(['/assets/Login.js', '/assets/form.js']);
  });

  it('مسیر بی‌چانک (داشبورد ایستا) چیزی preload نمی‌کند', () => {
    expect(run('/dashboard', { accessToken: 't' })).toEqual([]);
  });

  it('نشست خراب در localStorage برنامه را نمی‌شکند', () => {
    window.history.replaceState(null, '', '/sales/new');
    localStorage.setItem('gold-ui-session', '{not json');
    expect(() => new Function(preloadScript(ROUTES, '/', 'gold-ui-session'))()).not.toThrow();
  });

  it('کلید نشست vite.config.ts همان کلید persist استور نشست است', () => {
    expect(VITE_CONFIG).toContain(`sessionStorageKey: '${SESSION_STORAGE_KEY}'`);
  });
});

describe('toNonBlockingStylesheets', () => {
  it('stylesheet را غیرمسدودکننده و هم‌زمان با اولویت بالا preload می‌کند', () => {
    const html = '<link rel="stylesheet" crossorigin href="/assets/index-abc.css">';
    expect(toNonBlockingStylesheets(html)).toBe(
      '<link rel="preload" as="style" crossorigin href="/assets/index-abc.css">' +
        `<link rel="stylesheet" crossorigin href="/assets/index-abc.css" media="print" onload="this.media='all'">`,
    );
  });

  it('stylesheetی که خودش media دارد دست نمی‌خورد', () => {
    const html = '<link rel="stylesheet" href="/print.css" media="print">';
    expect(toNonBlockingStylesheets(html)).toBe(html);
  });
});
