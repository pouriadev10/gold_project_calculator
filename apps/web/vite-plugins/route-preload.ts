import { readFileSync } from 'node:fs';
import type { HtmlTagDescriptor, Plugin, Rollup } from 'vite';

type OutputBundle = Rollup.OutputBundle;
type OutputChunk = Rollup.OutputChunk;

/**
 * پیش‌بارگذاری چانک مسیرِ همان آدرسی که باز شده — FE-088.
 *
 * مسیرها تنبل‌اند (FE-087) و این برای بسته‌ی اولیه درست است، ولی باز کردن سرد یک
 * مسیر تنبل (ورود، `/sales/new` از میان‌بر صفحه‌ی خانه‌ی گوشی، لینک فاکتور) یک رفت‌وبرگشت
 * سریالی می‌سازد: تا بسته‌ی اصلی دانلود و اجرا نشود، روتر نمی‌داند چه چانکی بخواهد. روی
 * 3G همان یک رفت‌وبرگشت (+ زنجیره‌ی importهای خودِ چانک) بخش بزرگی از LCP است.
 *
 * این افزونه هنگام بیلد نقشه‌ی «الگوی مسیر → فایل‌های چانک» را از `router.tsx` و
 * bundle واقعی Rollup می‌سازد و یک اسکریپت inline کوچک در `<head>` می‌گذارد که
 * `location.pathname` را می‌خواند و برای همان مسیر `<link rel="modulepreload">` اضافه
 * می‌کند — یعنی چانک مسیر **هم‌زمان** با بسته‌ی اصلی دانلود می‌شود، نه بعد از آن.
 *
 * بدون نشست، محافظ `requireAuth` همه‌ی مسیرهای پوسته‌دار را به ورود می‌برد؛ اسکریپت
 * همین را تکرار می‌کند و چانک ورود را می‌خواهد. هیچ چیز دیگری (نقش، داده) حدس زده
 * نمی‌شود: اشتباه این اسکریپت فقط یک پیش‌بارگذاری بی‌مصرف است، نه رفتار متفاوت.
 */

export interface LazyRoute {
  /** الگوی مسیر TanStack (`/parties/$partyId`). */
  readonly path: string;
  /** مشخصه‌ی import پویا (`@/features/sales/SaleWizardPage`). */
  readonly specifier: string;
}

/**
 * مسیرهای تنبل را از متن `router.tsx` بیرون می‌کشد: هر `createRoute({...})` که
 * `path` و `import()` دارد. مسیرهای فقط-توسعه هم پیدا می‌شوند ولی در بیلد production
 * چانکی ندارند و کنار می‌روند.
 */
export function parseLazyRoutes(source: string): LazyRoute[] {
  const routes: LazyRoute[] = [];
  for (const block of source.split(/\bcreateRoute\(/u).slice(1)) {
    const path = /\bpath:\s*'([^']+)'/u.exec(block)?.[1];
    const specifier = /\bimport\(\s*'([^']+)'\s*\)/u.exec(block)?.[1];
    if (path !== undefined && specifier !== undefined) routes.push({ path, specifier });
  }
  return routes;
}

/** الگوی TanStack → RegExp لنگرگرفته؛ پارامتر `$x` یک بخش کامل مسیر است. */
export function routePattern(path: string): string {
  const body = path
    .split('/')
    .map((segment) => (segment.startsWith('$') ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')))
    .join('\\/');
  return `^${body}\\/?$`;
}

const normalizeId = (id: string): string => id.replace(/\\/gu, '/').replace(/\?.*$/u, '');

/** فایل‌های یک چانک + هر چه ایستا import می‌کند، منهای آنچه از قبل در بسته‌ی اولیه است. */
export function chunkClosure(bundle: OutputBundle, entry: OutputChunk, initial: ReadonlySet<string>): string[] {
  const files: string[] = [];
  const visit = (fileName: string) => {
    if (initial.has(fileName) || files.includes(fileName)) return;
    const chunk = bundle[fileName];
    if (chunk?.type !== 'chunk') return;
    files.push(fileName);
    chunk.imports.forEach(visit);
  };
  visit(entry.fileName);
  return files;
}

/** بسته‌ی اولیه: چانک ورودی و هر چه ایستا از آن import می‌شود. */
function initialFiles(bundle: OutputBundle): Set<string> {
  const files = new Set<string>();
  const visit = (fileName: string) => {
    const chunk = bundle[fileName];
    if (files.has(fileName) || chunk?.type !== 'chunk') return;
    files.add(fileName);
    chunk.imports.forEach(visit);
  };
  for (const chunk of Object.values(bundle)) if (chunk.type === 'chunk' && chunk.isEntry) visit(chunk.fileName);
  return files;
}

/**
 * متن اسکریپت inline. ES5 ساده، بدون وابستگی، و هر خطایی بی‌صدا بلعیده می‌شود — این
 * اسکریپت فقط سرعت می‌دهد و هرگز نباید بالا آمدن برنامه را بشکند. فایل‌های مشترک
 * (PageHeader، NumericField…) یک بار در فهرست `f` می‌آیند و مسیرها با اندیس به آن‌ها
 * اشاره می‌کنند تا HTML سبک بماند.
 */
export function preloadScript(
  routes: ReadonlyArray<readonly [pattern: string, files: readonly string[]]>,
  base: string,
  sessionStorageKey: string,
): string {
  const files = [...new Set(routes.flatMap(([, list]) => list))];
  const indexed = routes.map(([pattern, list]) => [pattern, list.map((file) => files.indexOf(file))]);
  return `(function(){try{var f=${JSON.stringify(files)},r=${JSON.stringify(indexed)},p=location.pathname,s=null;try{var v=localStorage.getItem(${JSON.stringify(sessionStorageKey)});s=v&&JSON.parse(v).state.session}catch(e){}if(!s)p='/login';for(var i=0;i<r.length;i++)if(new RegExp(r[i][0]).test(p)){for(var j=0;j<r[i][1].length;j++){var l=document.createElement('link');l.rel='modulepreload';l.crossOrigin='';l.href=${JSON.stringify(base)}+f[r[i][1][j]];document.head.appendChild(l)}break}}catch(e){}})();`;
}

export interface RoutePreloadOptions {
  /** مسیر مطلق `router.tsx`. */
  readonly routerFile: string;
  /** همان کلید `persist` استور نشست (`SESSION_STORAGE_KEY`). */
  readonly sessionStorageKey: string;
  /** `@/x` → مسیر مطلق `src/x`. */
  readonly resolveSpecifier: (specifier: string) => string;
}

export function routePreload(options: RoutePreloadOptions): Plugin {
  let base = '/';
  return {
    name: 'gold:route-preload',
    apply: 'build',
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx): HtmlTagDescriptor[] {
        const bundle = ctx.bundle;
        if (!bundle) return [];
        const initial = initialFiles(bundle);
        const byFacade = new Map<string, OutputChunk>();
        for (const chunk of Object.values(bundle)) {
          if (chunk.type === 'chunk' && chunk.facadeModuleId) byFacade.set(normalizeId(chunk.facadeModuleId), chunk);
        }

        const routes: Array<readonly [string, readonly string[]]> = [];
        for (const route of parseLazyRoutes(readFileSync(options.routerFile, 'utf8'))) {
          const target = normalizeId(options.resolveSpecifier(route.specifier));
          const chunk = [...byFacade.entries()].find(([id]) => id === target || id.startsWith(`${target}.`))?.[1];
          if (chunk) routes.push([routePattern(route.path), chunkClosure(bundle, chunk, initial)]);
        }
        if (routes.length === 0) return [];
        return [
          {
            tag: 'script',
            injectTo: 'head',
            children: preloadScript(routes, base, options.sessionStorageKey),
          },
        ];
      },
    },
  };
}
